// The killer sudoku technique ladder.
//
// Killer sudoku is classic sudoku plus two constraints: the digits in a cage
// are distinct, and they total the cage's target. Every classic sudoku
// deduction therefore remains valid here, so the seventeen techniques of
// solver/sudoku-classic/techniques.mjs are reused rather than rewritten. That
// file is frozen; nothing here modifies it. The functions are lifted out of
// its exported TECHNIQUES array by name, which is the only handle it offers.
//
// Cage distinctness needs no technique of its own: the family's geometry puts
// cage-mates into the peer relation, so the frozen assign() propagates it.
//
// What is genuinely new is the arithmetic, and it is where a killer solver
// earns its difficulty bands:
//
//   cage_single           a one-cell cage states its digit outright
//   cage_combination      a cell can only hold digits some placeable
//                         combination of its cage would put there
//   cage_hidden_single    a digit every placeable combination needs, with only
//                         one cell of the cage able to hold it
//   cage_innie_single     the rule of 45 on one unit, resolving to one cell
//   cage_innie_set        the same, resolving to a small set of cells
//   cage_group_sum        the rule of 45 over two or three units at once
//
// Tiers are this family's own. They are asserted against bands.json at load
// in index.mjs, so moving one breaks the build rather than quietly
// reclassifying the corpus.

import { CONTRADICTION, assign, restrict } from '../sudoku-classic/state.mjs';
import { TECHNIQUES as CLASSIC } from '../sudoku-classic/techniques.mjs';
import { bitCount, lowestBitIndex } from './geometry.mjs';
import { analyseCage, cageCombos, comboUnion, fillsToTarget, matchable, INNIE_LIMIT } from './combos.mjs';

// --- the classic ladder, borrowed ------------------------------------------

const classic = Object.fromEntries(CLASSIC.map((t) => [t.name, t.apply]));

function borrow(name) {
  const fn = classic[name];
  if (!fn) throw new Error(`solver/sudoku-classic no longer exports a technique called ${name}`);
  return fn;
}

// --- cage arithmetic -------------------------------------------------------

// A cage of one cell is its own answer.
function cageSingle(st) {
  const g = st.g;
  for (let c = 0; c < g.nCages; c++) {
    const cells = g.cageCells[c];
    if (cells.length !== 1) continue;
    const i = cells[0];
    if (st.val[i] !== 0) continue;
    const d = g.cageSum[c];
    if (d < 1 || d > g.size) return CONTRADICTION;
    const r = assign(st, i, d);
    if (r === CONTRADICTION) return CONTRADICTION;
    if (r) return true;
  }
  return false;
}

// The workhorse. For each cage, work out which of its digit combinations are
// still placeable on the board, then hold each cell to the digits some
// placeable combination would put in it.
function cageCombination(st) {
  const g = st.g;
  for (let c = 0; c < g.nCages; c++) {
    const cells = g.cageCells[c];
    let openCells = 0;
    for (let k = 0; k < cells.length; k++) if (st.val[cells[k]] === 0) openCells++;
    if (openCells === 0) continue;

    // The board-free union first: it costs one table lookup and does most of
    // the work on a fresh grid.
    const union = comboUnion(g.size, cells.length, g.cageSum[c]);
    if (union === 0) return CONTRADICTION;
    let changed = false;
    for (let k = 0; k < cells.length; k++) {
      if (st.val[cells[k]] !== 0) continue;
      const r = restrict(st, cells[k], union);
      if (r === CONTRADICTION) return CONTRADICTION;
      if (r) changed = true;
    }
    if (changed) return true;

    const a = analyseCage(g, st.cand, c);
    if (a.placeable === 0) return CONTRADICTION;
    for (let k = 0; k < cells.length; k++) {
      if (st.val[cells[k]] !== 0) continue;
      const r = restrict(st, cells[k], a.perCell[k]);
      if (r === CONTRADICTION) return CONTRADICTION;
      if (r) changed = true;
    }
    if (changed) return true;
  }
  return false;
}

// A digit that every placeable combination of a cage requires must appear in
// the cage. If only one of its cells can take it, that cell is settled. This
// is the hidden single of a unit, applied to a cage, which is not a unit.
function cageHiddenSingle(st) {
  const g = st.g;
  for (let c = 0; c < g.nCages; c++) {
    const cells = g.cageCells[c];
    if (cells.length < 2) continue;
    let open = false;
    for (let k = 0; k < cells.length; k++) if (st.val[cells[k]] === 0) { open = true; break; }
    if (!open) continue;

    const required = requiredDigits(g, st, c);
    if (required === 0) continue;

    let rest = required;
    while (rest) {
      const bit = rest & -rest;
      rest ^= bit;
      const d = lowestBitIndex(bit) + 1;
      let where = -1, count = 0, already = false;
      for (let k = 0; k < cells.length; k++) {
        const i = cells[k];
        if (st.val[i] === d) { already = true; break; }
        if (st.val[i] === 0 && (st.cand[i] & bit)) { where = i; count++; }
      }
      if (already) continue;
      if (count === 0) return CONTRADICTION;
      if (count === 1) {
        const r = assign(st, where, d);
        if (r === CONTRADICTION) return CONTRADICTION;
        if (r) return true;
      }
    }
  }
  return false;
}

// Digits present in every combination of the cage that is still placeable, and
// so certainly somewhere in the cage. Returns 0 both when the placeable
// combinations share no digit and when none is placeable at all; the caller
// only skips the cage, because cage_combination sits below this on the ladder
// and reports the second case as the contradiction it is.
function requiredDigits(g, st, cage) {
  const cells = g.cageCells[cage];
  let inter = ~0;
  let seen = 0;
  for (const combo of cageCombos(g.size, cells.length, g.cageSum[cage])) {
    if (!matchable(cells, combo, st.cand)) continue;
    inter &= combo;
    seen++;
  }
  if (seen === 0) return 0;
  return inter & ((1 << g.size) - 1);
}

// --- the rule of 45 --------------------------------------------------------

// For a set of cells that between them hold every digit `reps` times over
// (one unit: once; a band of three rows: three times), the cages touching that
// region pin two small sets:
//
//   innies:  cells inside the region belonging to cages that spill out
//   outies:  cells outside the region belonging to those same cages
//
// Each set has an exactly known total. When a set is one cell its digit is
// known; when it is two to four, its digits are constrained.
function regionSums(g, cellList) {
  const inRegion = new Set(cellList);
  const touching = new Set();
  for (const i of cellList) touching.add(g.cageOf[i]);

  let wholeSum = 0;
  let touchingSum = 0;
  const innies = [];
  const outies = [];
  for (const c of touching) {
    touchingSum += g.cageSum[c];
    const cells = g.cageCells[c];
    let spills = false;
    for (const i of cells) if (!inRegion.has(i)) { spills = true; break; }
    if (!spills) { wholeSum += g.cageSum[c]; continue; }
    for (const i of cells) (inRegion.has(i) ? innies : outies).push(i);
  }
  const unitTotal = (g.size * (g.size + 1)) / 2;
  const regionTotal = (cellList.length / g.size) * unitTotal;
  return {
    innies, outies,
    innieTarget: regionTotal - wholeSum,
    outieTarget: touchingSum - regionTotal,
  };
}

function applyRegion(st, cellList, lo, hi) {
  const g = st.g;
  const { innies, outies, innieTarget, outieTarget } = regionSums(g, cellList);
  for (const [cells, target] of [[innies, innieTarget], [outies, outieTarget]]) {
    if (cells.length < lo || cells.length > hi) continue;
    // Cells already settled just reduce the target.
    const open = [];
    let left = target;
    for (const i of cells) {
      if (st.val[i] !== 0) left -= st.val[i];
      else open.push(i);
    }
    if (open.length === 0) { if (left !== 0) return CONTRADICTION; continue; }
    if (open.length < lo || open.length > hi) continue;
    if (left < open.length || left > open.length * g.size) return CONTRADICTION;

    const f = fillsToTarget(g, st.cand, open, left);
    if (!f.feasible) return CONTRADICTION;
    let changed = false;
    for (let k = 0; k < open.length; k++) {
      const r = restrict(st, open[k], f.perCell[k]);
      if (r === CONTRADICTION) return CONTRADICTION;
      if (r) changed = true;
    }
    if (changed) return true;
  }
  return false;
}

// One unit, resolving to exactly one cell: the cheapest form of the rule.
function cageInnieSingle(st) {
  const g = st.g;
  for (let ui = 0; ui < g.units.length; ui++) {
    const r = applyRegion(st, Array.from(g.units[ui]), 1, 1);
    if (r === CONTRADICTION) return CONTRADICTION;
    if (r) return true;
  }
  return false;
}

// One unit, resolving to a small set.
function cageInnieSet(st) {
  const g = st.g;
  for (let ui = 0; ui < g.units.length; ui++) {
    const r = applyRegion(st, Array.from(g.units[ui]), 2, INNIE_LIMIT);
    if (r === CONTRADICTION) return CONTRADICTION;
    if (r) return true;
  }
  return false;
}

// Two or three whole units at once. A cage that spills out of one row often
// sits entirely inside a band of three, so groups reach deductions single
// units cannot. The groups are fixed and ordered, so the trace stays
// reproducible.
function unitGroups(g) {
  if (g._killerGroups) return g._killerGroups;
  const N = g.size;
  const groups = [];
  const rows = [];
  const cols = [];
  for (let r = 0; r < N; r++) {
    const u = [];
    for (let c = 0; c < N; c++) u.push(r * N + c);
    rows.push(u);
  }
  for (let c = 0; c < N; c++) {
    const u = [];
    for (let r = 0; r < N; r++) u.push(r * N + c);
    cols.push(u);
  }
  for (const lines of [rows, cols]) {
    for (let span = 2; span <= 3; span++) {
      for (let start = 0; start + span <= N; start++) {
        const cells = [];
        for (let k = 0; k < span; k++) cells.push(...lines[start + k]);
        groups.push(cells);
      }
    }
  }
  Object.defineProperty(g, '_killerGroups', { value: groups, enumerable: false });
  return groups;
}

function cageGroupSum(st) {
  const g = st.g;
  for (const cells of unitGroups(g)) {
    const r = applyRegion(st, cells, 1, INNIE_LIMIT);
    if (r === CONTRADICTION) return CONTRADICTION;
    if (r) return true;
  }
  return false;
}

// --- the ladder ------------------------------------------------------------

export const TECHNIQUES = [
  { name: 'cage_single', tier: 1, apply: cageSingle },
  { name: 'naked_single', tier: 1, apply: borrow('naked_single') },
  { name: 'hidden_single', tier: 1, apply: borrow('hidden_single') },
  { name: 'cage_combination', tier: 1, apply: cageCombination },

  { name: 'cage_innie_single', tier: 2, apply: cageInnieSingle },
  { name: 'locked_candidates_pointing', tier: 2, apply: borrow('locked_candidates_pointing') },
  { name: 'locked_candidates_claiming', tier: 2, apply: borrow('locked_candidates_claiming') },
  { name: 'naked_pair', tier: 2, apply: borrow('naked_pair') },
  { name: 'hidden_pair', tier: 2, apply: borrow('hidden_pair') },
  { name: 'cage_hidden_single', tier: 2, apply: cageHiddenSingle },

  { name: 'cage_innie_set', tier: 3, apply: cageInnieSet },
  { name: 'naked_triple', tier: 3, apply: borrow('naked_triple') },
  { name: 'hidden_triple', tier: 3, apply: borrow('hidden_triple') },
  { name: 'x_wing', tier: 3, apply: borrow('x_wing') },
  { name: 'naked_quad', tier: 3, apply: borrow('naked_quad') },
  { name: 'hidden_quad', tier: 3, apply: borrow('hidden_quad') },

  { name: 'cage_group_sum', tier: 4, apply: cageGroupSum },
  { name: 'swordfish', tier: 4, apply: borrow('swordfish') },
  { name: 'xy_wing', tier: 4, apply: borrow('xy_wing') },
  { name: 'xyz_wing', tier: 4, apply: borrow('xyz_wing') },
  { name: 'w_wing', tier: 4, apply: borrow('w_wing') },
  { name: 'jellyfish', tier: 4, apply: borrow('jellyfish') },
  { name: 'simple_coloring', tier: 4, apply: borrow('simple_coloring') },
];

export const MAX_DEDUCTION_TIER = 4;
export const TECHNIQUE_NAMES = TECHNIQUES.map((t) => t.name);
export const TIER_OF = Object.fromEntries(TECHNIQUES.map((t) => [t.name, t.tier]));

export { bitCount, lowestBitIndex };
