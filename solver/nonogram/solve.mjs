// Grid-level solving for nonograms: propagation, the technique ladder, bounded
// search and the solution count.
//
// This file imports nothing from generators/. It is given a clue set and it
// says what follows from it; how that clue set was produced is not its concern
// and must never become one.
//
// A nonogram has no givens inside the grid. The whole puzzle is the two clue
// lists, so every solve starts from an empty board and the only thing that
// varies between instances is the clues. That makes the band a property of the
// clue set alone, which is cleaner than sudoku or binairo, where the same
// solution grid can carry easy and hard sets of givens.

import { Budget, BudgetExceeded } from '../../lib/budget.mjs';
import { lineDeduce, UNKNOWN, FILLED, BLANK } from './line.mjs';
import { decodePuzzle, checkShape, encodeGrid, runsOfLine } from './encode.mjs';

export { UNKNOWN, FILLED, BLANK };

export const SOLVER_VERSION = '1.0.0';

// The ladder, and why it is this ladder rather than the obvious one.
//
// The obvious one was tried first and measured: overlap, then run bounds, then
// full line solving, then cell contradiction. It has a dead rung. Full line
// solving is genuinely stronger than run bounds on a single line -- it decides
// cells no individual run always covers, on 8.9% of lines -- but a grid is
// swept row and column alternately until nothing moves, and that iteration
// recovers the difference. Measured over 40 grids that run-bound propagation
// could not finish: full line solving finished none of them and cell
// contradiction finished all 40. A band that nothing can earn is a band that
// lies about what it means, so that ladder was not frozen.
//
// What separates instead is how hard the solver is allowed to think inside a
// hypothesis. Tier 2 is complete line reasoning, which subsumes run bounds.
// Tiers 3 and 4 both assume a cell and look for a contradiction; they differ in
// what they may use while looking. Tier 3 gets overlap only, which is the
// glance a person takes before committing to a guess. Tier 4 gets the full line
// reasoning of tier 2, which is working the hypothesis out properly.
export const TIER_OF = {
  overlap: 1,
  line_solve: 2,
  shallow_contradiction: 3,
  deep_contradiction: 4,
};
export const SEARCH_ENTRY = 'bounded_search';
export const MAX_DEDUCTION_TIER = 4;

// Which of line.mjs's three tiers each grid tier reasons with. The line
// reasoner keeps its middle tier -- it is validated, it is exact, and it is a
// real distinction on one line -- but the grid ladder does not use it, for the
// reason above.
const LINE_TIER_FOR = { 1: 1, 2: 3 };

// What tier 3 and tier 4 may use inside a hypothesis.
const INNER_TIER_FOR = { 3: 1, 4: 2 };

// The same weights binairo uses, so a score means the same thing across the
// corpus: a band-3 puzzle is a band-3 puzzle whichever family it came from.
export const TIER_WEIGHT = { 1: 1, 2: 4, 3: 12, 4: 40, 5: 150 };
export const SEARCH_DEPTH_WEIGHT = 60;

const LINE_RULE = { 1: 'overlap', 2: 'line_solve' };

export function tierOfEntry(name) {
  if (name === SEARCH_ENTRY) return 5;
  const t = TIER_OF[name];
  if (t === undefined) throw new Error(`unknown technique ${name}`);
  return t;
}

// --- the clue set -----------------------------------------------------------

// Decode a puzzle string into the object the rest of this file reasons about.
// The shape the params declare has to match the shape the clues describe, or
// the record is lying about one of the two.
//
// Nothing else is rejected here, and the line between what throws and what does
// not matters. A string that is not a clue set at all -- a missing separator, a
// zero-length run, the wrong number of groups -- is malformed input and throws.
// A clue set that is perfectly well formed and simply has no solution is not
// malformed; it is unsolvable, which is a verdict. Conflating the two was a
// real bug: every mutated clue set the hardening suite builds has two sides
// that no longer agree on the number of filled cells, and throwing on those
// turned 1,375 honest `unsolvable` verdicts into solver crashes.
export function parsePuzzle(puzzleString, params) {
  const { rowRuns, colRuns, rows, cols } = decodePuzzle(puzzleString);
  if (params) {
    if (rows !== params.rows) throw new Error(`clues name ${rows} rows, params say ${params.rows}`);
    if (cols !== params.cols) throw new Error(`clues name ${cols} columns, params say ${params.cols}`);
  }
  return { rows, cols, rowRuns, colRuns };
}

// Necessary conditions for a solution to exist, each of them cheap. Returns the
// reason there is none, or null if none of these rules it out.
//
// The search would reach the same verdict without this -- a run that cannot fit
// leaves its line with no arrangement, and mismatched totals leave the grid with
// no completion -- so this is an optimisation, not a check. It has to stay one:
// anything here that could reject a solvable clue set would be the solver
// quietly deciding a puzzle is impossible without looking.
export function infeasible(P) {
  for (const line of P.rowRuns) for (const n of line) if (n > P.cols) return `a row run of ${n} cannot fit in ${P.cols} cells`;
  for (const line of P.colRuns) for (const n of line) if (n > P.rows) return `a column run of ${n} cannot fit in ${P.rows} cells`;
  try { checkShape(P.rowRuns, P.colRuns); } catch (e) { return e.message; }
  return null;
}

export function blankState(rows, cols) {
  return new Int8Array(rows * cols);
}

export function formatState(st, rows, cols) {
  const grid = new Int8Array(rows * cols);
  for (let i = 0; i < st.length; i++) grid[i] = st[i] === FILLED ? 1 : 0;
  return encodeGrid(grid, rows, cols);
}

// How many runs the two clue lists name between them. A nonogram's "clues" are
// the runs, not cells of the grid, so this is the honest analogue of a sudoku's
// given count.
export function clueCount(puzzleString) {
  const { rowRuns, colRuns } = decodePuzzle(puzzleString);
  let n = 0;
  for (const line of rowRuns) n += line.length;
  for (const line of colRuns) n += line.length;
  return n;
}

function readLine(st, P, isRow, n, out) {
  const { rows, cols } = P;
  const len = isRow ? cols : rows;
  for (let i = 0; i < len; i++) out[i] = isRow ? st[n * cols + i] : st[i * cols + n];
  return len;
}

// Does a finished line actually match its clue?
//
// This has to be asked, and asking it is not optional. `sweep` skips a line in
// which every cell is already settled, because there is nothing left to deduce
// there -- but a line can be settled entirely by deductions made about the
// *other* axis, and nothing in that path ever compares it to its own clue. Skip
// the check and a grid can reach `complete` with a row whose runs are wrong,
// and the solver will call it solved. Binairo had the identical hole and it was
// found the same way: a contradiction fixture that should have been rejected
// instantly instead ran until it exhausted its budget.
function lineMatchesClue(line, len, clue) {
  let ri = 0, run = 0;
  for (let i = 0; i < len; i++) {
    if (line[i] === FILLED) run++;
    else {
      if (run) { if (ri >= clue.length || clue[ri] !== run) return false; ri++; run = 0; }
    }
  }
  if (run) { if (ri >= clue.length || clue[ri] !== run) return false; ri++; }
  return ri === clue.length;
}

// One sweep of every row and column at a single tier. Returns the number of
// cells it settled, or the string 'contradiction'.
function sweep(st, P, tier, budget, trace) {
  const { rows, cols, rowRuns, colRuns } = P;
  const buf = new Int8Array(Math.max(rows, cols));
  let changed = 0;
  for (let pass = 0; pass < 2; pass++) {
    const isRow = pass === 0;
    const count = isRow ? rows : cols;
    const runs = isRow ? rowRuns : colRuns;
    for (let n = 0; n < count; n++) {
      budget.tick();
      const len = readLine(st, P, isRow, n, buf);
      let settled = true;
      for (let i = 0; i < len; i++) if (buf[i] === UNKNOWN) { settled = false; break; }
      if (settled) {
        if (!lineMatchesClue(buf, len, runs[n])) return 'contradiction';
        continue;
      }
      const state = buf.slice(0, len);
      const d = lineDeduce(len, runs[n], state, LINE_TIER_FOR[tier]);
      if (!d.ok) return 'contradiction';
      for (let i = 0; i < len; i++) {
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

// A finished grid, checked against both clue lists from scratch. Nothing that
// leaves this file as a solution avoids this.
export function verifyComplete(st, P) {
  const { rows, cols, rowRuns, colRuns } = P;
  for (let r = 0; r < rows; r++) {
    const line = [];
    for (let c = 0; c < cols; c++) line.push(st[r * cols + c] === FILLED ? 1 : 0);
    const got = runsOfLine(line);
    if (got.join(',') !== rowRuns[r].join(',')) return false;
  }
  for (let c = 0; c < cols; c++) {
    const line = [];
    for (let r = 0; r < rows; r++) line.push(st[r * cols + c] === FILLED ? 1 : 0);
    const got = runsOfLine(line);
    if (got.join(',') !== colRuns[c].join(',')) return false;
  }
  return true;
}

// Tiers 3 and 4. Assume a cell, propagate, and if that is impossible the cell
// must be the other thing. One step of case analysis that never keeps a guess,
// which is what separates both of them from the search at band 5.
//
// `inner` is the whole difference between the two tiers: tier 3 propagates the
// hypothesis with overlap alone, tier 4 with complete line reasoning.
function contradictionRule(st, P, budget, trace, tier) {
  const inner = INNER_TIER_FOR[tier];
  const name = tier === 3 ? 'shallow_contradiction' : 'deep_contradiction';
  for (let at = 0; at < st.length; at++) {
    if (st[at] !== UNKNOWN) continue;
    for (const guess of [FILLED, BLANK]) {
      budget.tick();
      const copy = Int8Array.from(st);
      copy[at] = guess;
      if (ladder(copy, P, inner, budget, null) !== 'contradiction') continue;
      st[at] = guess === FILLED ? BLANK : FILLED;
      if (trace && !trace.includes(name)) trace.push(name);
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
    for (let tier = 1; tier <= Math.min(maxTier, 2); tier++) {
      const r = sweep(st, P, tier, budget, trace);
      if (r === 'contradiction') return 'contradiction';
      if (r > 0) { progress = true; break; }
    }
    for (let tier = 3; !progress && tier <= Math.min(maxTier, 4); tier++) {
      if (contradictionRule(st, P, budget, trace, tier) > 0) progress = true;
    }
    if (!progress) break;
  }
  if (!complete(st)) return 'stalled';
  return verifyComplete(st, P) ? 'solved' : 'contradiction';
}

// How much of the grid is still undecided once propagation at this tier
// ceiling has run out of things to say.
//
// The band is a step function -- tier 3 either finishes a grid or it does not --
// and a hill climb over a step function is a hill climb over flat ground. This
// is the continuous version underneath it: a grid that tier 2 leaves with three
// cells open is measurably closer to being a band-3 puzzle than one tier 2
// solves outright, even though both are band 1 or 2. Searching on this rather
// than on the band is what makes the thin bands reachable at all.
export function stallAt(P, tier, budget) {
  const st = blankState(P.rows, P.cols);
  const r = ladder(st, P, tier, budget, null);
  if (r === 'contradiction') return { status: 'contradiction', unknown: -1 };
  let unknown = 0;
  for (const v of st) if (v === UNKNOWN) unknown++;
  return { status: r, unknown };
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

// Which cell to branch on: the one whose line is closest to being finished, so
// a guess is most likely to cascade. Ties break to the first, which keeps the
// search deterministic.
function branchCell(st, P) {
  const { rows, cols } = P;
  let best = -1, bestScore = -1;
  for (let i = 0; i < st.length; i++) {
    if (st[i] !== UNKNOWN) continue;
    const r = Math.floor(i / cols), c = i % cols;
    let known = 0;
    for (let k = 0; k < cols; k++) if (st[r * cols + k] !== UNKNOWN) known++;
    for (let k = 0; k < rows; k++) if (st[k * cols + c] !== UNKNOWN) known++;
    if (known > bestScore) { bestScore = known; best = i; }
  }
  return best;
}

// Solutions, counted exhaustively up to a limit. Propagation runs at the full
// line-solving tier between guesses; tiers 3 and 4 are deliberately left out
// here because they are themselves case analysis and the search does that job
// better.
export function countSolutions(P, { limit = 2, budget } = {}) {
  const b = budget ?? new Budget();
  if (infeasible(P)) return { count: 0, nodes: 0, maxDepth: 0, solutions: [] };
  let count = 0;
  let nodes = 0;
  let deepest = 0;
  const solutions = [];

  const rec = (st, depth) => {
    if (count >= limit) return;
    nodes++;
    b.tick();
    const r = ladder(st, P, 2, b, null);
    if (r === 'contradiction') return;
    if (r === 'solved') {
      count++;
      if (solutions.length < limit) solutions.push(formatState(st, P.rows, P.cols));
      return;
    }
    deepest = Math.max(deepest, depth + 1);
    const at = branchCell(st, P);
    for (const guess of [FILLED, BLANK]) {
      const copy = Int8Array.from(st);
      copy[at] = guess;
      rec(copy, depth + 1);
      if (count >= limit) return;
    }
  };

  rec(blankState(P.rows, P.cols), 0);
  return { count, nodes, maxDepth: deepest, solutions };
}

// How deep the search has to go once deduction is spent. Bands 1 to 4 never
// reach this; band 5 records what it cost.
export function searchWithDepth(P, { budget } = {}) {
  const b = budget ?? new Budget();
  let deepest = 0;
  let found = null;
  const rec = (st, depth) => {
    const r = ladder(st, P, MAX_DEDUCTION_TIER, b, null);
    if (r === 'contradiction') return false;
    if (r === 'solved') { found = formatState(st, P.rows, P.cols); return true; }
    deepest = Math.max(deepest, depth + 1);
    const at = branchCell(st, P);
    for (const guess of [FILLED, BLANK]) {
      b.tick();
      const copy = Int8Array.from(st);
      copy[at] = guess;
      if (rec(copy, depth + 1)) return true;
    }
    return false;
  };
  rec(blankState(P.rows, P.cols), 0);
  return { solution: found, maxSearchDepth: deepest };
}

function distinct(trace) {
  const out = [];
  for (const t of trace) if (!out.includes(t)) out.push(t);
  return out;
}

function scoreOf(trace, band, maxSearchDepth) {
  let s = 0;
  for (const name of trace) s += TIER_WEIGHT[tierOfEntry(name)];
  if (band === 5) s += SEARCH_DEPTH_WEIGHT * maxSearchDepth;
  return s;
}

// The single entry point the gate and the generator both use.
//
// Returns { verdict, solution, uniqueness, difficulty }, where verdict is
// 'unsolvable' | 'unique' | 'multiple'. Throws BudgetExceeded when a bound is
// hit; callers must treat that as a rejection, never a pass.
export function classifyClues(P, opts = {}) {
  const t0 = Date.now();
  const counted = countSolutions(P, {
    limit: 2,
    budget: opts.countBudget ?? new Budget({ nodes: 400_000, ms: 20_000 }),
  });
  const countMs = Date.now() - t0;

  if (counted.count !== 1) {
    return {
      verdict: counted.count === 0 ? 'unsolvable' : 'multiple',
      solution: null,
      uniqueness: {
        verdict: counted.count === 0 ? 'unsolvable' : 'multiple',
        method: 'exhaustive-count-to-2',
        nodes_searched: counted.nodes,
        reference_checked: false,
      },
      difficulty: null,
      timings: { count_ms: countMs, band_ms: 0 },
    };
  }

  const t1 = Date.now();
  let band = null, trace = [], maxSearchDepth = 0;
  for (let tier = 1; tier <= MAX_DEDUCTION_TIER; tier++) {
    const st = blankState(P.rows, P.cols);
    const tr = [];
    const r = ladder(st, P, tier, opts.bandBudget ?? new Budget({ nodes: 400_000, ms: 20_000 }), tr);
    if (r === 'solved') { band = tier; trace = tr; break; }
    if (r === 'contradiction') {
      // Deduction contradicted a clue set the counting search solved. That is a
      // solver bug, not a puzzle property, and it must never be swallowed.
      throw new Error(`solver inconsistency: deduction at tier ${tier} contradicted a counted solution`);
    }
    if (tier === MAX_DEDUCTION_TIER) trace = tr;
  }
  if (band === null) {
    band = 5;
    const s = searchWithDepth(P, { budget: opts.searchBudget ?? new Budget({ nodes: 400_000, ms: 20_000 }) });
    if (!s.solution) throw new Error('solver inconsistency: search found no solution on a unique clue set');
    maxSearchDepth = s.maxSearchDepth;
    trace = [...trace, SEARCH_ENTRY];
  }

  return {
    verdict: 'unique',
    solution: counted.solutions[0],
    solutionString: counted.solutions[0],
    uniqueness: {
      verdict: 'unique',
      method: 'exhaustive-count-to-2',
      nodes_searched: counted.nodes,
      reference_checked: false,
    },
    difficulty: {
      band,
      score: scoreOf(trace, band, maxSearchDepth),
      techniques: distinct(trace),
      max_search_depth: maxSearchDepth,
    },
    trace,
    timings: { count_ms: countMs, band_ms: Date.now() - t1 },
  };
}

export { Budget, BudgetExceeded };
