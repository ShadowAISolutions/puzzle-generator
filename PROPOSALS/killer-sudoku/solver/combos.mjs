// Cage arithmetic: which sets of distinct digits can fill a cage, and which of
// those sets are still possible given the cells' current candidates.
//
// This is the part of killer sudoku that classic sudoku has no analogue for,
// so none of it is imported. Everything here is exact: no heuristic prunes a
// combination that might still be placeable, because a band measured from a
// solver that misses deductions is a band that will move the moment the solver
// gets better.

import { bitCount } from './geometry.mjs';

const comboCache = new Map();

// Every set of `n` distinct digits from 1..size summing to `sum`, as bitmasks.
export function cageCombos(size, n, sum) {
  const key = `${size}:${n}:${sum}`;
  const hit = comboCache.get(key);
  if (hit) return hit;
  const out = [];
  const pick = (start, left, need, mask) => {
    if (left === 0) { if (need === 0) out.push(mask); return; }
    // Prune on what the remaining picks can possibly add up to.
    const lo = ((left) * (2 * start + left + 1)) / 2;               // start+1 .. start+left
    const hi = ((left) * (2 * size - left + 1)) / 2;                // size-left+1 .. size
    if (need < lo || need > hi) return;
    for (let d = start + 1; d <= size; d++) {
      if (d > need) break;
      pick(d, left - 1, need - d, mask | (1 << (d - 1)));
    }
  };
  pick(0, n, sum, 0);
  const frozen = Int32Array.from(out);
  comboCache.set(key, frozen);
  return frozen;
}

// The union of every digit that appears in any combination for this cage size
// and sum, ignoring the board. Cheap, and enough for the first-pass restrict.
const unionCache = new Map();
export function comboUnion(size, n, sum) {
  const key = `${size}:${n}:${sum}`;
  const hit = unionCache.get(key);
  if (hit !== undefined) return hit;
  let u = 0;
  for (const m of cageCombos(size, n, sum)) u |= m;
  unionCache.set(key, u);
  return u;
}

// Digits that appear in EVERY combination: those are forced somewhere in the
// cage, which is what lets a cage act like a unit for a hidden single.
const intersectCache = new Map();
export function comboIntersection(size, n, sum) {
  const key = `${size}:${n}:${sum}`;
  const hit = intersectCache.get(key);
  if (hit !== undefined) return hit;
  const all = cageCombos(size, n, sum);
  let x = all.length ? ~0 : 0;
  for (const m of all) x &= m;
  const v = all.length ? x & ((1 << size) - 1) : 0;
  intersectCache.set(key, v);
  return v;
}

// --- placing a combination on the board -------------------------------------

// Can each of `cells` take a distinct digit of `digits`, given `cand`?
// Kuhn's algorithm; cages are at most `size` cells so this is tiny.
export function matchable(cells, digits, cand) {
  const n = cells.length;
  if (bitCount(digits) !== n) return false;
  const digitList = [];
  for (let d = 1; d <= 16; d++) if (digits & (1 << (d - 1))) digitList.push(d);
  const assignedTo = new Int32Array(digitList.length).fill(-1);

  const tryCell = (ci, seen) => {
    for (let k = 0; k < digitList.length; k++) {
      if (seen[k]) continue;
      const bit = 1 << (digitList[k] - 1);
      if ((cand[cells[ci]] & bit) === 0) continue;
      seen[k] = 1;
      if (assignedTo[k] === -1 || tryCell(assignedTo[k], seen)) {
        assignedTo[k] = ci;
        return true;
      }
    }
    return false;
  };

  for (let ci = 0; ci < n; ci++) {
    if (!tryCell(ci, new Uint8Array(digitList.length))) return false;
  }
  return true;
}

// The exact local cage analysis.
//
// Returns, for a cage, the combinations still placeable on the current board
// and, for each cell, the digits it can hold in at least one of them. Those
// per-cell masks are the strongest restriction cage arithmetic alone supports;
// anything narrower would be unsound.
export function analyseCage(g, cand, cage) {
  const cells = g.cageCells[cage];
  const n = cells.length;
  const sum = g.cageSum[cage];
  const all = cageCombos(g.size, n, sum);

  const perCell = new Int32Array(n);
  let union = 0;
  let placeable = 0;
  let onlyCombo = -1;

  for (const combo of all) {
    // Every digit of the combination must be available to some cell, and the
    // whole combination must be assignable one digit per cell.
    if (!matchable(cells, combo, cand)) continue;
    placeable++;
    onlyCombo = placeable === 1 ? combo : -1;
    union |= combo;
    for (let k = 0; k < n; k++) {
      // Digit d can sit in cells[k] under this combination if the other cells
      // can absorb the rest of it.
      let avail = cand[cells[k]] & combo;
      while (avail) {
        const bit = avail & -avail;
        avail ^= bit;
        if ((perCell[k] & bit) !== 0) continue;
        const rest = cells.filter((_, j) => j !== k);
        if (rest.length === 0 || matchable(rest, combo & ~bit, cand)) perCell[k] |= bit;
      }
    }
  }
  return { placeable, union, perCell, onlyCombo, total: all.length };
}

// --- the rule of 45 ---------------------------------------------------------

// A unit (row, column or box) holds every digit once, so it sums to
// size*(size+1)/2. Split the cages touching a unit into those wholly inside it
// and those that spill out, and the spill is pinned:
//
//   sum(cages wholly inside) + sum(cells of spilling cages that are inside)
//     = unitTotal
//
// so the cells of spilling cages that lie inside the unit must total
// `unitTotal - sum(wholly inside)`. When there is exactly one such cell its
// value is known outright; when there are few, their total constrains them.
export function unitSpill(g, unitIndex) {
  const unit = g.units[unitIndex];
  const inUnit = new Set(unit);
  const touching = new Set();
  for (const i of unit) touching.add(g.cageOf[i]);

  let insideSum = 0;
  const spillCells = [];
  for (const c of touching) {
    const cells = g.cageCells[c];
    let allIn = true;
    for (const i of cells) if (!inUnit.has(i)) { allIn = false; break; }
    if (allIn) { insideSum += g.cageSum[c]; continue; }
    for (const i of cells) if (inUnit.has(i)) spillCells.push(i);
  }
  const total = (g.size * (g.size + 1)) / 2;
  return { target: total - insideSum, cells: spillCells };
}

// The same idea run outwards: for a cage that spills out of a unit, the cells
// of it that lie OUTSIDE the unit total the cage sum minus what is inside. The
// solver uses whichever of the two sets is smaller, since a set of one or two
// cells with a known total is what actually yields a deduction.
export function cageOutside(g, unitIndex, cage) {
  const inUnit = new Set(g.units[unitIndex]);
  const inside = [];
  const outside = [];
  for (const i of g.cageCells[cage]) (inUnit.has(i) ? inside : outside).push(i);
  return { inside, outside, cageSum: g.cageSum[cage] };
}

// Digits that can fill `cells` to exactly `target`, one digit per cell, with
// two cells forced apart whenever they are peers — which, on this family's
// geometry, covers sharing a row, a column, a box or a cage. Used for the
// innie/outie sets, which may span more than one cage.
//
// The search is exhaustive, so the caller keeps `cells` small; the techniques
// that use it never pass more than INNIE_LIMIT cells.
export const INNIE_LIMIT = 4;

export function fillsToTarget(g, cand, cells, target) {
  const n = cells.length;
  if (n === 0) return { feasible: target === 0, perCell: [] };
  if (n > INNIE_LIMIT) throw new Error(`fillsToTarget called with ${n} cells, over the ${INNIE_LIMIT} cell limit`);
  const perCell = new Int32Array(n);
  const peerOf = [];
  for (let k = 0; k < n; k++) {
    const s = new Set(g.peers[cells[k]]);
    peerOf.push(s);
  }
  let any = false;
  const chosen = new Int32Array(n);

  const rec = (k, left) => {
    if (k === n) {
      if (left !== 0) return false;
      any = true;
      for (let j = 0; j < n; j++) perCell[j] |= 1 << (chosen[j] - 1);
      return true;
    }
    // Bound: the remaining cells can each hold at most `size` and at least 1.
    const remaining = n - k;
    if (left < remaining || left > remaining * g.size) return false;
    let mask = cand[cells[k]];
    let found = false;
    while (mask) {
      const bit = mask & -mask;
      mask ^= bit;
      const d = 31 - Math.clz32(bit) + 1;
      // Two cells that see each other cannot both hold d. `g.peers` already
      // includes cage-mates, so this covers rows, columns, boxes and cages.
      let clash = false;
      for (let j = 0; j < k; j++) {
        if (chosen[j] === d && peerOf[k].has(cells[j])) { clash = true; break; }
      }
      if (clash) continue;
      chosen[k] = d;
      if (rec(k + 1, left - d)) found = true;
    }
    return found;
  };

  rec(0, target);
  return { feasible: any, perCell };
}
