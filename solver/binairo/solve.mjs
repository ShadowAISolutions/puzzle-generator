// Grid-level solving for binairo: propagation, the technique ladder, bounded
// search and the solution count.
//
// This file imports nothing from generators/. It is given a grid of givens and
// it says what follows from them; how those givens were chosen is not its
// concern and must never become one.

import { Budget, BudgetExceeded } from '../../lib/budget.mjs';
import { lineDeduce, lineCompletions, keyOf, UNKNOWN, ZERO, ONE, LINE_TIERS, other } from './line.mjs';

export { UNKNOWN, ZERO, ONE, other };

export const SOLVER_VERSION = '1.0.0';

export const TIER_OF = {
  local_triples: 1,
  line_counts: 2,
  line_enumerate: 3,
  cell_contradiction: 4,
};
export const SEARCH_ENTRY = 'bounded_search';
export const MAX_DEDUCTION_TIER = 4;

export const TIER_WEIGHT = { 1: 1, 2: 4, 3: 12, 4: 40, 5: 150 };
export const SEARCH_DEPTH_WEIGHT = 60;

export function tierOfEntry(name) {
  if (name === SEARCH_ENTRY) return 5;
  const t = TIER_OF[name];
  if (t === undefined) throw new Error(`unknown technique ${name}`);
  return t;
}

// --- encoding ---------------------------------------------------------------

export function parseGrid(str, size) {
  if (typeof str !== 'string') throw new Error('grid must be a string');
  if (str.length !== size * size) throw new Error(`grid is ${str.length} characters, expected ${size * size}`);
  const g = new Int8Array(size * size);
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '.') g[i] = UNKNOWN;
    else if (ch === '0') g[i] = ZERO;
    else if (ch === '1') g[i] = ONE;
    else throw new Error(`grid holds ${JSON.stringify(ch)}, expected "0", "1" or "."`);
  }
  return g;
}

export function formatGrid(g) {
  let s = '';
  for (const v of g) s += v === ZERO ? '0' : v === ONE ? '1' : '.';
  return s;
}

export function blankState(size) {
  return new Int8Array(size * size);
}

export function clueCount(str) {
  let n = 0;
  for (const ch of str) if (ch !== '.') n++;
  return n;
}

// --- line access ------------------------------------------------------------

function readLine(st, size, isRow, n, out) {
  for (let i = 0; i < size; i++) out[i] = isRow ? st[n * size + i] : st[i * size + n];
  return out;
}

// The finished lines parallel to each axis, so a line can be stopped from
// repeating one. A line still holding an unknown is not finished and cannot
// forbid anything.
function finishedLines(st, size, isRow) {
  const set = new Set();
  const buf = new Int8Array(size);
  const index = [];
  for (let n = 0; n < size; n++) {
    readLine(st, size, isRow, n, buf);
    let full = true;
    for (const v of buf) if (v === UNKNOWN) { full = false; break; }
    index.push(full ? keyOf(buf) : null);
    if (full) set.add(index[n]);
  }
  return { set, index };
}

// Is a finished line legal, as far as this tier can tell? Each rule is
// checked at the tier that owns it: three in a row is tier 1, the count is
// tier 2, and repeating another finished line is tier 3.
function lineLegal(size, line, tier, fin, n) {
  for (let i = 2; i < size; i++) {
    if (line[i] === line[i - 1] && line[i] === line[i - 2]) return false;
  }
  if (tier < 2) return true;
  let z = 0;
  for (const v of line) if (v === ZERO) z++;
  if (z !== size / 2) return false;
  if (tier < 3 || !fin) return true;
  const k = keyOf(line);
  for (let m = 0; m < size; m++) if (m !== n && fin.index[m] === k) return false;
  return true;
}

// --- one sweep --------------------------------------------------------------

// Every row and column at a single tier. Returns cells settled, or the string
// 'contradiction'. Each application is pushed to the trace separately, because
// the score counts applications and a set would flatten the cost of a puzzle
// that needed a technique forty times into the cost of one that needed it once.
function sweep(st, size, tier, budget, trace) {
  let changed = 0;
  for (let pass = 0; pass < 2; pass++) {
    const isRow = pass === 0;
    const fin = tier >= 3 ? finishedLines(st, size, isRow) : null;
    const buf = new Int8Array(size);
    for (let n = 0; n < size; n++) {
      budget.tick();
      readLine(st, size, isRow, n, buf);
      let settled = true;
      for (const v of buf) if (v === UNKNOWN) { settled = false; break; }
      // A full line still has to be legal. Skipping it outright was wrong:
      // tier 1 reasons only about triples, so it will happily complete a row
      // that was handed five zeros and three ones, and from then on no tier
      // ever looked at that row again. The verdict stayed correct, because
      // verifyComplete catches it at the end, but the contradiction was only
      // found by exhausting the search below it -- three fixtures that should
      // be refuted on sight instead ran out of nodes. Deciding it here costs
      // one pass over the line and is the same rule at the same tier.
      if (settled) {
        if (!lineLegal(size, buf, tier, fin, n)) return 'contradiction';
        continue;
      }
      let forbidden = null;
      if (fin) {
        forbidden = new Set(fin.set);
        if (fin.index[n]) forbidden.delete(fin.index[n]);
      }
      const d = lineDeduce(size, buf, tier, forbidden);
      if (!d.ok) return 'contradiction';
      for (let i = 0; i < size; i++) {
        if (buf[i] !== UNKNOWN || d.cells[i] === UNKNOWN) continue;
        st[isRow ? n * size + i : i * size + n] = d.cells[i];
        changed++;
        if (trace) trace.push(LINE_TIERS[tier]);
      }
    }
  }
  return changed;
}

function complete(st) {
  for (const v of st) if (v === UNKNOWN) return false;
  return true;
}

// A finished grid is only a solution if it actually obeys every rule. The
// ladder is trusted to be sound, and then this checks it anyway, because a
// solver that marks a wrong grid solved is the one failure this project
// cannot absorb.
export function verifyComplete(st, size) {
  const half = size / 2;
  const seen = [new Set(), new Set()];
  const buf = new Int8Array(size);
  for (let pass = 0; pass < 2; pass++) {
    for (let n = 0; n < size; n++) {
      readLine(st, size, pass === 0, n, buf);
      let z = 0, o = 0;
      for (let i = 0; i < size; i++) {
        if (buf[i] === ZERO) z++; else if (buf[i] === ONE) o++; else return false;
        if (i >= 2 && buf[i] === buf[i - 1] && buf[i] === buf[i - 2]) return false;
      }
      if (z !== half || o !== half) return false;
      const k = keyOf(buf);
      if (seen[pass].has(k)) return false;
      seen[pass].add(k);
    }
  }
  return true;
}

// --- tier 4 ------------------------------------------------------------------

// Assume a cell, run the full line ladder, and if that is impossible the cell
// must be the other symbol. One step of case analysis that never keeps a
// guess, which is what separates it from the search at band 5.
function contradictionRule(st, size, budget, trace) {
  for (let at = 0; at < st.length; at++) {
    if (st[at] !== UNKNOWN) continue;
    for (const guess of [ZERO, ONE]) {
      budget.tick();
      const copy = Int8Array.from(st);
      copy[at] = guess;
      if (ladder(copy, size, 3, budget, null) !== 'contradiction') continue;
      st[at] = other(guess);
      if (trace) trace.push('cell_contradiction');
      return 1;
    }
  }
  return 0;
}

// --- the ladder --------------------------------------------------------------

// Propagate to a fixpoint under a tier ceiling. Cheap tiers are exhausted
// before an expensive one is tried, and any progress restarts from tier 1, so
// a technique is only recorded when it was genuinely needed.
export function ladder(st, size, maxTier, budget, trace) {
  for (;;) {
    let progress = false;
    for (let tier = 1; tier <= Math.min(maxTier, 3); tier++) {
      const r = sweep(st, size, tier, budget, trace);
      if (r === 'contradiction') return 'contradiction';
      if (r > 0) { progress = true; break; }
    }
    if (!progress && maxTier >= 4) {
      if (contradictionRule(st, size, budget, trace) > 0) progress = true;
    }
    if (!progress) break;
  }
  if (!complete(st)) return 'stalled';
  return verifyComplete(st, size) ? 'solved' : 'contradiction';
}

// The lowest tier ceiling at which deduction alone finishes the grid, or null.
export function deduce(grid, size, maxTier, { budget } = {}) {
  const b = budget ?? new Budget();
  const st = Int8Array.from(grid);
  const trace = [];
  const r = ladder(st, size, maxTier, b, trace);
  return { status: r, trace, state: st };
}

// --- counting and search -----------------------------------------------------

// The cell to branch on: the first unknown in reading order. Deliberately not
// a cleverer heuristic, because the node count is part of the published budget
// and a heuristic that changes between versions would change it.
function firstUnknown(st) {
  for (let i = 0; i < st.length; i++) if (st[i] === UNKNOWN) return i;
  return -1;
}

// Solutions, counted exhaustively up to a limit. Propagation runs at the full
// line tier between guesses; tier 4 is deliberately left out here because it is
// itself case analysis and the search does that job better.
export function countSolutions(grid, size, { limit = 2, budget } = {}) {
  const b = budget ?? new Budget();
  const solutions = [];
  let nodes = 0;
  let deepest = 0;

  const rec = (st, depth) => {
    if (solutions.length >= limit) return;
    nodes++;
    b.tick();
    const r = ladder(st, size, 3, b, null);
    if (r === 'contradiction') return;
    if (r === 'solved') { solutions.push(formatGrid(st)); return; }
    deepest = Math.max(deepest, depth + 1);
    const at = firstUnknown(st);
    for (const guess of [ZERO, ONE]) {
      const copy = Int8Array.from(st);
      copy[at] = guess;
      rec(copy, depth + 1);
      if (solutions.length >= limit) return;
    }
  };

  rec(Int8Array.from(grid), 0);
  return { count: solutions.length, solutions, nodes, maxDepth: deepest };
}

// How deep the search has to nest once deduction is spent, over the whole
// search and not only the path that succeeded. Bands 1 to 4 never reach here.
export function searchWithDepth(grid, size, { budget } = {}) {
  const b = budget ?? new Budget();
  let deepest = 0;
  let found = null;
  const rec = (st, depth) => {
    const r = ladder(st, size, MAX_DEDUCTION_TIER, b, null);
    if (r === 'contradiction') return false;
    if (r === 'solved') { found = formatGrid(st); return true; }
    deepest = Math.max(deepest, depth + 1);
    const at = firstUnknown(st);
    for (const guess of [ZERO, ONE]) {
      b.tick();
      const copy = Int8Array.from(st);
      copy[at] = guess;
      if (rec(copy, depth + 1)) return true;
    }
    return false;
  };
  rec(Int8Array.from(grid), 0);
  return { solution: found, maxSearchDepth: deepest };
}

// --- the verdict -------------------------------------------------------------

function distinct(trace) {
  const seen = new Set();
  const out = [];
  for (const t of trace) if (!seen.has(t)) { seen.add(t); out.push(t); }
  return out;
}

// A continuous measure from the trace: every application weighted by its tier,
// plus a term for how deep a band-5 search had to nest. It exists so puzzles
// can be ordered inside a band later on without ever reopening the thresholds.
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
export function classifyGrid(grid, params, opts = {}) {
  const size = params.size;
  const t0 = Date.now();
  const counted = countSolutions(grid, size, {
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
    const r = deduce(grid, size, tier, {
      budget: opts.bandBudget ?? new Budget({ nodes: 200_000, ms: 20_000 }),
    });
    if (r.status === 'solved') { band = tier; trace = r.trace; break; }
    if (r.status === 'contradiction') {
      // Deduction contradicted a grid the counting search solved. That is a
      // solver bug, not a puzzle property, and it must never be swallowed.
      throw new Error(`solver inconsistency: deduction at tier ${tier} contradicted a counted solution`);
    }
    if (tier === MAX_DEDUCTION_TIER) trace = r.trace;
  }
  if (band === null) {
    band = 5;
    const s = searchWithDepth(grid, size, {
      budget: opts.searchBudget ?? new Budget({ nodes: 400_000, ms: 20_000 }),
    });
    if (!s.solution) throw new Error('solver inconsistency: search found no solution on a unique grid');
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

export { Budget, BudgetExceeded, lineCompletions, keyOf };
