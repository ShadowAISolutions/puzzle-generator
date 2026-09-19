// Grid-level solving for nonograms: propagation, the technique ladder, bounded
// search and the solution count.
//
// This file imports nothing from generators/. It is given a clue set and it
// says what follows from it; how that clue set was produced is not its concern
// and must never become one.

import { Budget, BudgetExceeded } from '../../lib/budget.mjs';
import { lineDeduce, UNKNOWN, FILLED, BLANK } from './line.mjs';

export { UNKNOWN, FILLED, BLANK };

export const TECHNIQUE_TIERS = {
  overlap: 1,
  run_bounds: 2,
  line_solve: 3,
  cell_contradiction: 4,
};
export const SEARCH_ENTRY = 'bounded_search';
export const MAX_DEDUCTION_TIER = 4;

const LINE_RULE = { 1: 'overlap', 2: 'run_bounds', 3: 'line_solve' };

export function blankState(rows, cols) {
  return new Int8Array(rows * cols);
}

function readLine(st, P, isRow, n) {
  const { rows, cols } = P;
  const len = isRow ? cols : rows;
  const out = new Int8Array(len);
  for (let i = 0; i < len; i++) out[i] = isRow ? st[n * cols + i] : st[i * cols + n];
  return out;
}

// One sweep of every row and column at a single tier. Returns the number of
// cells it settled, or the string 'contradiction'.
function sweep(st, P, tier, budget, trace) {
  const { rows, cols, rowRuns, colRuns } = P;
  let changed = 0;
  for (let pass = 0; pass < 2; pass++) {
    const isRow = pass === 0;
    const count = isRow ? rows : cols;
    const runs = isRow ? rowRuns : colRuns;
    for (let n = 0; n < count; n++) {
      budget.tick();
      const state = readLine(st, P, isRow, n);
      let settled = true;
      for (const v of state) if (v === UNKNOWN) { settled = false; break; }
      if (settled) continue;
      const d = lineDeduce(state.length, runs[n], state, tier);
      if (!d.ok) return 'contradiction';
      for (let i = 0; i < state.length; i++) {
        if (state[i] !== UNKNOWN || d.cells[i] === UNKNOWN) continue;
        const at = isRow ? n * cols + i : i * cols + n;
        st[at] = d.cells[i];
        changed++;
        if (trace && !trace.includes(LINE_RULE[tier])) trace.push(LINE_RULE[tier]);
      }
    }
  }
  return changed;
}

function complete(st) {
  for (const v of st) if (v === UNKNOWN) return false;
  return true;
}

// Tier 4. Assume a cell, run the full line ladder, and if that is impossible
// the cell must be the other thing. It is one step of case analysis that never
// keeps a guess, which is what separates it from the search at band 5.
function contradictionRule(st, P, budget, trace) {
  for (let at = 0; at < st.length; at++) {
    if (st[at] !== UNKNOWN) continue;
    for (const guess of [FILLED, BLANK]) {
      budget.tick();
      const copy = Int8Array.from(st);
      copy[at] = guess;
      if (ladder(copy, P, 3, budget, null) !== 'contradiction') continue;
      st[at] = guess === FILLED ? BLANK : FILLED;
      if (trace && !trace.includes('cell_contradiction')) trace.push('cell_contradiction');
      return 1;
    }
  }
  return 0;
}

// Propagate to a fixpoint under a tier ceiling. Cheap tiers are exhausted
// before an expensive one is tried, and any progress restarts from tier 1, so
// a technique is only recorded when it was genuinely needed.
export function ladder(st, P, maxTier, budget, trace) {
  for (;;) {
    let progress = false;
    for (let tier = 1; tier <= Math.min(maxTier, 3); tier++) {
      const r = sweep(st, P, tier, budget, trace);
      if (r === 'contradiction') return 'contradiction';
      if (r > 0) { progress = true; break; }
    }
    if (!progress && maxTier >= 4) {
      const r = contradictionRule(st, P, budget, trace);
      if (r === 'contradiction') return 'contradiction';
      if (r > 0) progress = true;
    }
    if (!progress) break;
  }
  return complete(st) ? 'solved' : 'stalled';
}

// The lowest tier ceiling at which deduction alone finishes the grid, or null.
export function deducibleWithin(P, maxTier, budget) {
  const ceiling = Math.min(maxTier, MAX_DEDUCTION_TIER);
  for (let tier = 1; tier <= ceiling; tier++) {
    const st = blankState(P.rows, P.cols);
    const trace = [];
    const r = ladder(st, P, tier, budget, trace);
    if (r === 'solved') return { band: tier, trace, state: st };
    if (r === 'contradiction') return { band: null, trace, contradiction: true };
  }
  return { band: null, trace: [] };
}

function firstUnknown(st) {
  for (let i = 0; i < st.length; i++) if (st[i] === UNKNOWN) return i;
  return -1;
}

// Solutions, counted exhaustively up to a limit. Propagation runs at the full
// line-solving tier between guesses; tier 4 is deliberately left out here
// because it is itself case analysis and the search does that job better.
export function countSolutions(P, { limit = 2, budget } = {}) {
  const b = budget ?? new Budget();
  let count = 0;
  let nodes = 0;
  let deepest = 0;
  let first = null;

  const rec = (st, depth) => {
    if (count >= limit) return;
    nodes++;
    b.tick();
    const r = ladder(st, P, 3, b, null);
    if (r === 'contradiction') return;
    if (r === 'solved') {
      count++;
      if (!first) first = Int8Array.from(st);
      return;
    }
    deepest = Math.max(deepest, depth + 1);
    const at = firstUnknown(st);
    for (const guess of [FILLED, BLANK]) {
      const copy = Int8Array.from(st);
      copy[at] = guess;
      rec(copy, depth + 1);
      if (count >= limit) return;
    }
  };

  rec(blankState(P.rows, P.cols), 0);
  return { count, nodes, maxDepth: deepest, solution: first };
}

// How deep the search has to go once deduction is spent. Bands 1 to 4 never
// reach this; band 5 records what it cost.
export function searchDepth(P, budget) {
  const b = budget ?? new Budget();
  let deepest = 0;
  const rec = (st, depth) => {
    const r = ladder(st, P, MAX_DEDUCTION_TIER, b, null);
    if (r === 'contradiction') return false;
    if (r === 'solved') return true;
    deepest = Math.max(deepest, depth + 1);
    const at = firstUnknown(st);
    for (const guess of [FILLED, BLANK]) {
      b.tick();
      const copy = Int8Array.from(st);
      copy[at] = guess;
      if (rec(copy, depth + 1)) return true;
    }
    return false;
  };
  const solved = rec(blankState(P.rows, P.cols), 0);
  return { solved, depth: deepest };
}

export { BudgetExceeded };
