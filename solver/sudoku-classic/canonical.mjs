// Canonical form of a sudoku instance under its full symmetry group.
//
// Two puzzles that are the same puzzle in disguise must not both enter the
// corpus, so the hash is taken over a canonical representative rather than
// over the givens as generated.
//
// The group, for a grid tiled by boxH x boxW boxes:
//   - permute the bands, and the rows inside each band
//   - permute the stacks, and the columns inside each stack
//   - transpose
//   - relabel the digits
// Rotations and reflections need no separate treatment: reversing the row
// order is a band permutation composed with row permutations inside each band,
// and likewise for columns, so the group above already contains every rotation
// and reflection of the grid.
//
// The representative is the lexicographically smallest encoding over the whole
// group. Empty cells encode as 255 so that givens sort before blanks.
//
// Digit relabelling is not enumerated. For a fixed cell order the smallest
// relabelling is always "number the digits by first appearance", so it is
// applied directly as the encoding is built. Note that the labels of row 0
// depend only on row 0, which is what makes the two-phase search below exact.
//
// Search. A naive scan is |rowOrders| x |colOrders|, which is 1.68 million for
// a 9x9 and costs about 100ms per puzzle -- too slow for a corpus. Instead:
//
//   Phase A: the first row of the minimal encoding is the smallest first row
//     achievable at all, and it depends only on (which row comes first, which
//     column order). That is size x |colOrders| combinations, ~12k for a 9x9.
//     Take the minimum and keep every combination that attains it.
//   Phase B: complete the comparison only for row orders starting with a
//     surviving first row.
//
// This is exact, not a heuristic: any arrangement whose first row is not
// minimal cannot produce the minimal string.
//
// Transposing a boxH x boxW grid yields a boxW x boxH grid, a different
// geometry. Both orientations are searched and the smaller wins, so the hash
// is shape-symmetric: a 6x6 with 2x3 boxes and its transpose with 3x2 boxes
// hash the same.

import { geometry, parseGrid, isSupportedShape, clueCount } from './geometry.mjs';
import { sha256hex } from '../../lib/hash.mjs';

const EMPTY = 255;
const orderCache = new Map();

// Every permutation of `n` items, in lexicographic order.
function permutations(n) {
  const out = [];
  const cur = [];
  const used = new Array(n).fill(false);
  (function rec() {
    if (cur.length === n) { out.push(cur.slice()); return; }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = true; cur.push(i);
      rec();
      cur.pop(); used[i] = false;
    }
  })();
  return out;
}

// All ways to reorder `size` lines grouped into `size/groupSize` groups of
// `groupSize`: permute the groups, and permute the lines inside each group.
// Returns { orders, byFirst } where orders is an array of Int32Array(size)
// mapping new index -> old index, and byFirst[r] lists the orders beginning
// with old line r.
function lineOrderings(size, groupSize) {
  const key = `${size}/${groupSize}`;
  const hit = orderCache.get(key);
  if (hit) return hit;

  const nGroups = size / groupSize;
  if (!Number.isInteger(nGroups)) throw new Error(`group ${groupSize} does not divide ${size}`);
  const groupPerms = permutations(nGroups);
  const innerPerms = permutations(groupSize);
  const orders = [];
  const innerChoice = new Array(nGroups).fill(0);
  const total = innerPerms.length ** nGroups;
  for (const gp of groupPerms) {
    for (let t = 0; t < total; t++) {
      let rest = t;
      for (let k = 0; k < nGroups; k++) {
        innerChoice[k] = rest % innerPerms.length;
        rest = Math.floor(rest / innerPerms.length);
      }
      const ord = new Int32Array(size);
      let p = 0;
      for (let gi = 0; gi < nGroups; gi++) {
        const srcGroup = gp[gi];
        const ip = innerPerms[innerChoice[gi]];
        for (let j = 0; j < groupSize; j++) ord[p++] = srcGroup * groupSize + ip[j];
      }
      orders.push(ord);
    }
  }
  const byFirst = Array.from({ length: size }, () => []);
  for (const ord of orders) byFirst[ord[0]].push(ord);

  const res = { orders, byFirst };
  orderCache.set(key, res);
  return res;
}

export function groupSize(size, boxH, boxW) {
  return lineOrderings(size, boxH).orders.length * lineOrderings(size, boxW).orders.length;
}

// Encode one row of the grid under a column order, relabelling by first
// appearance. Writes into `out` and returns nothing.
function encodeRow(grid, rowBase, co, n, out) {
  const map = new Uint8Array(17);
  let next = 1;
  for (let c = 0; c < n; c++) {
    const raw = grid[rowBase + co[c]];
    if (raw === 0) { out[c] = EMPTY; continue; }
    let code = map[raw];
    if (code === 0) { code = next++; map[raw] = code; }
    out[c] = code;
  }
}

function cmpRange(a, b, len) {
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

// Smallest encoding of `grid` over the band/stack/relabel group for one fixed
// geometry. `best` carries a running minimum from an earlier orientation, or
// null. Returns a Uint8Array of length size*size.
function minimalForOrientation(grid, size, boxH, boxW, best) {
  const n = size;
  const cells = n * n;
  const rowOrd = lineOrderings(n, boxH);
  const colOrders = lineOrderings(n, boxW).orders;

  // --- Phase A: the minimal first row, and every way of achieving it.
  const bestRow = new Uint8Array(n).fill(0xff);
  const row = new Uint8Array(n);
  let haveRow = false;
  const survivors = []; // [colOrder, firstRowIndex] pairs
  for (let ci = 0; ci < colOrders.length; ci++) {
    const co = colOrders[ci];
    for (let r = 0; r < n; r++) {
      encodeRow(grid, r * n, co, n, row);
      const c = haveRow ? cmpRange(row, bestRow, n) : -1;
      if (c < 0) {
        bestRow.set(row);
        haveRow = true;
        survivors.length = 0;
        survivors.push([co, r]);
      } else if (c === 0) {
        survivors.push([co, r]);
      }
    }
  }

  // --- Phase B: complete only the survivors.
  let bestBuf = best;
  const cand = new Uint8Array(cells);
  const map = new Uint8Array(17);
  const touched = new Int32Array(17);

  for (const [co, r0] of survivors) {
    for (const ro of rowOrd.byFirst[r0]) {
      let nTouched = 0;
      let next = 1;
      let cmp = bestBuf === null ? -1 : 0; // -1 smaller, 0 tied so far, 1 larger
      let p = 0;
      outer:
      for (let r = 0; r < n; r++) {
        const base = ro[r] * n;
        for (let c = 0; c < n; c++) {
          const raw = grid[base + co[c]];
          let code;
          if (raw === 0) code = EMPTY;
          else {
            code = map[raw];
            if (code === 0) { code = next++; map[raw] = code; touched[nTouched++] = raw; }
          }
          cand[p] = code;
          if (cmp === 0) {
            const b = bestBuf[p];
            if (code < b) cmp = -1;
            else if (code > b) { cmp = 1; break outer; }
          }
          p++;
        }
      }
      if (cmp < 0) {
        // Strictly smaller. The build may have stopped early once the
        // comparison resolved, so finish it before taking a copy.
        for (let q = p; q < cells; q++) {
          const r = (q / n) | 0, c = q - r * n;
          const raw = grid[ro[r] * n + co[c]];
          let code;
          if (raw === 0) code = EMPTY;
          else {
            code = map[raw];
            if (code === 0) { code = next++; map[raw] = code; touched[nTouched++] = raw; }
          }
          cand[q] = code;
        }
        bestBuf = Uint8Array.from(cand);
      }
      for (let k = 0; k < nTouched; k++) map[touched[k]] = 0;
    }
  }
  return bestBuf;
}

function transpose(grid, size) {
  const out = new Int8Array(size * size);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) out[c * size + r] = grid[r * size + c];
  return out;
}

function decode(buf) {
  let s = '';
  for (let i = 0; i < buf.length; i++) s += buf[i] === EMPTY ? '.' : String.fromCharCode(64 + buf[i]);
  return s;
}

// Canonical representative as a printable string. Letters A.. stand for the
// relabelled digits; '.' is an empty cell.
export function canonicalForm(gridOrString, size, boxH, boxW) {
  const grid = typeof gridOrString === 'string' ? parseGrid(gridOrString, size) : gridOrString;
  if (!isSupportedShape(size, boxH, boxW)) throw new Error(`unsupported shape ${size} ${boxH}x${boxW}`);
  geometry(size, boxH, boxW); // validates the tiling
  // A grid with no givens is fixed by the whole group; skip the search.
  if (clueCount(grid) === 0) return '.'.repeat(size * size);
  let best = minimalForOrientation(grid, size, boxH, boxW, null);
  best = minimalForOrientation(transpose(grid, size), size, boxW, boxH, best);
  return decode(best);
}

// The hash a record's `id` and `canonical_hash` come from. The box shape is
// folded in unordered, since a shape and its transpose describe the same set
// of grids.
export function canonicalHash(gridOrString, size, boxH, boxW, familyVersion = 1) {
  const form = canonicalForm(gridOrString, size, boxH, boxW);
  const shape = [boxH, boxW].sort((a, b) => a - b).join('x');
  return sha256hex(`sudoku-classic|${familyVersion}|${size}|${shape}|${form}`);
}
