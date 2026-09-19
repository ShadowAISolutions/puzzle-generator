// The independent solver.
//
// Three jobs, kept separate on purpose:
//
//   countSolutions  the uniqueness proof. Counts to two and stops. A count of
//                   one means the search exhausted the tree without finding a
//                   second solution, not that it gave up looking.
//   deduce          apply the technique ladder up to a tier ceiling and report
//                   whether that was enough, with the trace of what was used.
//   classify        the verdict a record is built from: solvability,
//                   uniqueness, solution, band, score, trace, search depth.
//
// The band is the lowest tier ceiling at which deduction alone completes the
// grid -- which is the definition in FOUNDATION.md, the highest tier the
// easiest complete path needs, not the first path the solver happens to take.
// It is always read from a fresh solve of the finished puzzle, so nothing
// carried over from generation can influence it.

import { geometry, bitCount, lowestBitIndex, formatGrid } from './geometry.mjs';
import { CONTRADICTION, makeState, cloneState, assign, gridOf, verifyComplete } from './state.mjs';
import { TECHNIQUES, MAX_DEDUCTION_TIER, TIER_OF } from './techniques.mjs';
import { Budget, BudgetExceeded } from '../../lib/budget.mjs';

export const SOLVER_VERSION = '1.0.0';

export const TIER_WEIGHT = { 1: 1, 2: 4, 3: 12, 4: 40, 5: 150 };
export const SEARCH_DEPTH_WEIGHT = 60;

// --- fast tier-1 propagation, used by the counting search -------------------

function propagateSingles(st, budget) {
  const g = st.g;
  for (;;) {
    budget.tick();
    let progress = false;
    for (let i = 0; i < g.cells; i++) {
      if (st.val[i] !== 0) continue;
      const c = st.cand[i];
      if (c === 0) return CONTRADICTION;
      if (bitCount(c) === 1) {
        if (assign(st, i, lowestBitIndex(c) + 1) === CONTRADICTION) return CONTRADICTION;
        progress = true;
      }
    }
    for (let ui = 0; ui < g.units.length; ui++) {
      const u = g.units[ui];
      for (let d = 1; d <= g.size; d++) {
        const bit = 1 << (d - 1);
        let where = -1, count = 0, placed = false;
        for (let k = 0; k < u.length; k++) {
          const i = u[k];
          if (st.val[i] === d) { placed = true; break; }
          if (st.val[i] === 0 && (st.cand[i] & bit)) { where = i; count++; if (count > 1) break; }
        }
        if (placed) continue;
        if (count === 0) return CONTRADICTION;
        if (count === 1) {
          if (assign(st, where, d) === CONTRADICTION) return CONTRADICTION;
          progress = true;
        }
      }
    }
    if (!progress) return true;
    if (st.unsolved === 0) return true;
  }
}

// Fewest candidates wins; ties break to the lowest cell index. Deterministic.
function pickBranchCell(st) {
  let best = -1, bestN = Infinity;
  for (let i = 0; i < st.g.cells; i++) {
    if (st.val[i] !== 0) continue;
    const n = bitCount(st.cand[i]);
    if (n < bestN) { bestN = n; best = i; if (n === 2) break; }
  }
  return best;
}

// --- uniqueness -------------------------------------------------------------

export function countSolutions(grid, g, { limit = 2, budget } = {}) {
  const b = budget ?? new Budget();
  const root = makeState(grid, g);
  if (root === CONTRADICTION) return { count: 0, solutions: [], nodes: b.nodes };
  const solutions = [];

  const rec = (st) => {
    b.tick();
    if (propagateSingles(st, b) === CONTRADICTION) return;
    if (st.unsolved === 0) {
      solutions.push(gridOf(st));
      return;
    }
    const i = pickBranchCell(st);
    const c = st.cand[i];
    for (let d = 1; d <= g.size; d++) {
      if ((c & (1 << (d - 1))) === 0) continue;
      const child = cloneState(st);
      if (assign(child, i, d) !== CONTRADICTION) rec(child);
      if (solutions.length >= limit) return;
    }
  };

  rec(root);
  return { count: solutions.length, solutions, nodes: b.nodes };
}

// --- deduction --------------------------------------------------------------

// Apply the ladder up to `maxTier`, cheapest technique first, restarting from
// the cheapest after every successful application.
export function deduce(grid, g, maxTier, { budget } = {}) {
  const b = budget ?? new Budget();
  const st = makeState(grid, g);
  if (st === CONTRADICTION) return { status: 'contradiction', trace: [], state: null };
  const trace = [];
  outer:
  while (st.unsolved > 0) {
    b.tick();
    for (const tech of TECHNIQUES) {
      if (tech.tier > maxTier) break;
      const r = tech.apply(st);
      if (r === CONTRADICTION) return { status: 'contradiction', trace, state: st };
      if (r) { trace.push(tech.name); continue outer; }
    }
    return { status: 'stuck', trace, state: st };
  }
  return { status: 'solved', trace, state: st };
}

// --- bounded search, for band 5 only ---------------------------------------

// Full deduction at every node, then a guess. Returns the solution and the
// deepest guess nesting the search entered. Deterministic: MRV with the
// lowest-index tie-break, digits ascending.
export function searchWithDepth(grid, g, { budget } = {}) {
  const b = budget ?? new Budget();
  let maxDepth = 0;
  let found = null;

  const rec = (st, depth) => {
    if (found) return;
    if (depth > maxDepth) maxDepth = depth;
    b.tick();
    // Deduce in place on this node's state.
    outer:
    while (st.unsolved > 0) {
      b.tick();
      for (const tech of TECHNIQUES) {
        if (tech.tier > MAX_DEDUCTION_TIER) break;
        const r = tech.apply(st);
        if (r === CONTRADICTION) return;
        if (r) continue outer;
      }
      break;
    }
    if (st.unsolved === 0) { found = gridOf(st); return; }
    const i = pickBranchCell(st);
    const c = st.cand[i];
    for (let d = 1; d <= g.size; d++) {
      if ((c & (1 << (d - 1))) === 0) continue;
      const child = cloneState(st);
      if (assign(child, i, d) !== CONTRADICTION) rec(child, depth + 1);
      if (found) return;
    }
  };

  const root = makeState(grid, g);
  if (root === CONTRADICTION) return { solution: null, maxSearchDepth: 0, nodes: b.nodes };
  rec(root, 0);
  return { solution: found, maxSearchDepth: maxDepth, nodes: b.nodes };
}

// --- the verdict ------------------------------------------------------------

function distinct(list) {
  const seen = new Set();
  const out = [];
  for (const x of list) if (!seen.has(x)) { seen.add(x); out.push(x); }
  return out;
}

// A continuous measure from the trace: every application weighted by its
// tier, plus a term for how deep a band-5 search had to nest. It exists so
// that puzzles can be ordered inside a band later on without ever reopening
// the band thresholds.
function scoreOf(trace, band, maxSearchDepth) {
  let s = 0;
  for (const name of trace) s += TIER_WEIGHT[tierOfEntry(name)];
  if (band === 5) s += SEARCH_DEPTH_WEIGHT * maxSearchDepth;
  return s;
}

export const SEARCH_ENTRY = 'bounded_search';

export function tierOfEntry(name) {
  if (name === SEARCH_ENTRY) return 5;
  const t = TIER_OF[name];
  if (t === undefined) throw new Error(`unknown technique ${name}`);
  return t;
}


// The single entry point the gate and the generator both use.
//
// Returns { verdict, solution, uniqueness, difficulty }, where verdict is
// 'unsolvable' | 'unique' | 'multiple'. Throws BudgetExceeded when a bound is
// hit; callers must treat that as a rejection, never a pass.
export function classifyGrid(grid, params, opts = {}) {
  const { size, box_h: boxH, box_w: boxW } = params;
  const g = geometry(size, boxH, boxW);
  const countBudget = opts.countBudget ?? new Budget({ nodes: 400_000, ms: 15_000 });
  const t0 = Date.now();

  const counted = countSolutions(grid, g, { limit: 2, budget: countBudget });
  const countMs = Date.now() - t0;

  if (counted.count === 0) {
    return {
      verdict: 'unsolvable',
      solution: null,
      uniqueness: { verdict: 'unsolvable', method: 'exhaustive-count-to-2', nodes_searched: counted.nodes, reference_checked: false },
      difficulty: null,
      timings: { count_ms: countMs, band_ms: 0 },
    };
  }
  if (counted.count > 1) {
    return {
      verdict: 'multiple',
      solution: null,
      uniqueness: { verdict: 'multiple', method: 'exhaustive-count-to-2', nodes_searched: counted.nodes, reference_checked: false },
      difficulty: null,
      timings: { count_ms: countMs, band_ms: 0 },
    };
  }

  const solution = counted.solutions[0];
  const t1 = Date.now();
  let band = null, trace = [], maxSearchDepth = 0;
  for (let tier = 1; tier <= MAX_DEDUCTION_TIER; tier++) {
    const bandBudget = opts.bandBudget ?? new Budget({ nodes: 200_000, ms: 20_000 });
    const r = deduce(grid, g, tier, { budget: bandBudget });
    if (r.status === 'solved') { band = tier; trace = r.trace; break; }
    if (r.status === 'contradiction') {
      // Deduction found a contradiction on a grid the counting search solved.
      // That is a solver bug, not a puzzle property.
      throw new Error(`solver inconsistency: deduction at tier ${tier} contradicted a counted solution`);
    }
    if (tier === MAX_DEDUCTION_TIER) trace = r.trace;
  }
  if (band === null) {
    band = 5;
    const searchBudget = opts.searchBudget ?? new Budget({ nodes: 400_000, ms: 20_000 });
    const s = searchWithDepth(grid, g, { budget: searchBudget });
    if (!s.solution) throw new Error('solver inconsistency: search found no solution on a unique grid');
    maxSearchDepth = s.maxSearchDepth;
    trace = [...trace, SEARCH_ENTRY];
  }
  const bandMs = Date.now() - t1;

  return {
    verdict: 'unique',
    solution,
    solutionString: formatGrid(solution, size),
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
    timings: { count_ms: countMs, band_ms: bandMs },
  };
}

export { Budget, BudgetExceeded, verifyComplete };
