// The independent killer sudoku solver.
//
// Same three jobs, and the same separation, as the classic solver:
//
//   countSolutions  the uniqueness proof. Counts to two and stops. A count of
//                   one means the tree was exhausted without a second
//                   solution, not that the search gave up.
//   deduce          apply the technique ladder up to a tier ceiling and report
//                   whether that was enough, with the trace of what was used.
//   classifyPuzzle  the verdict a record is built from.
//
// The band is the lowest tier ceiling at which deduction alone completes the
// grid, read from a fresh solve of the finished puzzle. Nothing carried over
// from generation can influence it.
//
// A killer sudoku starts from a completely empty board, so the counting search
// cannot lean on givens the way the classic one does: without cage arithmetic
// in the propagation loop it would be enumerating every sudoku grid. The
// propagation here therefore prunes on cage sums, using the precomputed
// combination tables. It is deliberately weaker than the `cage_combination`
// technique on the ladder — propagation only has to be correct and fast, while
// a technique has to be exactly as strong as its tier claims.

import { geometry, bitCount, lowestBitIndex, formatGrid } from './geometry.mjs';
import {
  CONTRADICTION, makeState, cloneState, assign, restrict, gridOf,
  emptyGrid, verifyComplete, cageSumsSatisfied,
} from './state.mjs';
import { TECHNIQUES, MAX_DEDUCTION_TIER, TIER_OF } from './techniques.mjs';
import { cageCombos } from './combos.mjs';
import { Budget, BudgetExceeded } from '../../lib/budget.mjs';

export const SOLVER_VERSION = '1.0.0';

// The same weights as sudoku-classic, so a score means the same amount of
// work whichever family produced it.
export const TIER_WEIGHT = { 1: 1, 2: 4, 3: 12, 4: 40, 5: 150 };
export const SEARCH_DEPTH_WEIGHT = 60;
export const SEARCH_ENTRY = 'bounded_search';

// --- cage pruning used by the counting search -------------------------------

// Hold every open cell of a cage to the digits that some completion of the
// cage could put there, working from what is already assigned in it. Sound
// but not maximal: it unions over whole combinations rather than testing each
// digit's placeability, which is what makes it cheap enough for every node.
function pruneCage(st, c) {
  const g = st.g;
  const cells = g.cageCells[c];
  let assignedMask = 0;
  let left = g.cageSum[c];
  const open = [];
  for (let k = 0; k < cells.length; k++) {
    const d = st.val[cells[k]];
    if (d === 0) { open.push(cells[k]); continue; }
    const bit = 1 << (d - 1);
    if (assignedMask & bit) return CONTRADICTION;  // cannot happen: cage-mates are peers
    assignedMask |= bit;
    left -= d;
  }
  if (open.length === 0) return left === 0 ? false : CONTRADICTION;
  if (left < open.length || left > open.length * g.size) return CONTRADICTION;

  let union = 0;
  let any = false;
  for (const combo of cageCombos(g.size, open.length, left)) {
    if (combo & assignedMask) continue;
    // Every digit of the combination must be available somewhere in the cage.
    let coverable = true;
    let rest = combo;
    while (rest) {
      const bit = rest & -rest;
      rest ^= bit;
      let seen = false;
      for (let k = 0; k < open.length; k++) if (st.cand[open[k]] & bit) { seen = true; break; }
      if (!seen) { coverable = false; break; }
    }
    if (!coverable) continue;
    any = true;
    union |= combo;
  }
  if (!any) return CONTRADICTION;

  let changed = false;
  for (let k = 0; k < open.length; k++) {
    const r = restrict(st, open[k], union);
    if (r === CONTRADICTION) return CONTRADICTION;
    if (r) changed = true;
  }
  return changed;
}

function propagate(st, budget) {
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

    for (let c = 0; c < g.nCages; c++) {
      const r = pruneCage(st, c);
      if (r === CONTRADICTION) return CONTRADICTION;
      if (r) progress = true;
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

export function countSolutions(g, { limit = 2, budget } = {}) {
  const b = budget ?? new Budget();
  const root = makeState(emptyGrid(g), g);
  if (root === CONTRADICTION) return { count: 0, solutions: [], nodes: b.nodes };
  const solutions = [];

  const rec = (st) => {
    b.tick();
    if (propagate(st, b) === CONTRADICTION) return;
    if (st.unsolved === 0) {
      // Propagation already rejects a cage whose assigned digits miss its
      // target, so this can only fail if that logic is wrong. Checked anyway:
      // a wrong solution counted as right is the one error that would reach
      // the corpus.
      if (!cageSumsSatisfied(g, st.val)) throw new Error('solver inconsistency: complete grid violates a cage sum');
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

export function deduce(g, maxTier, { budget } = {}) {
  const b = budget ?? new Budget();
  const st = makeState(emptyGrid(g), g);
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
  if (!cageSumsSatisfied(g, st.val)) return { status: 'contradiction', trace, state: st };
  return { status: 'solved', trace, state: st };
}

// --- bounded search, for band 5 only ---------------------------------------

export function searchWithDepth(g, { budget } = {}) {
  const b = budget ?? new Budget();
  let maxDepth = 0;
  let found = null;

  const rec = (st, depth) => {
    if (found) return;
    if (depth > maxDepth) maxDepth = depth;
    b.tick();
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
    if (st.unsolved === 0) {
      if (cageSumsSatisfied(g, st.val)) { found = gridOf(st); }
      return;
    }
    const i = pickBranchCell(st);
    const c = st.cand[i];
    for (let d = 1; d <= g.size; d++) {
      if ((c & (1 << (d - 1))) === 0) continue;
      const child = cloneState(st);
      if (assign(child, i, d) !== CONTRADICTION) rec(child, depth + 1);
      if (found) return;
    }
  };

  const root = makeState(emptyGrid(g), g);
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

export function tierOfEntry(name) {
  if (name === SEARCH_ENTRY) return 5;
  const t = TIER_OF[name];
  if (t === undefined) throw new Error(`unknown technique ${name}`);
  return t;
}

function scoreOf(trace, band, maxSearchDepth) {
  let s = 0;
  for (const name of trace) s += TIER_WEIGHT[tierOfEntry(name)];
  if (band === 5) s += SEARCH_DEPTH_WEIGHT * maxSearchDepth;
  return s;
}

// The single entry point the gate and the generator both use.
//
// Takes the puzzle in this family's encoding, because for killer sudoku the
// puzzle *is* the cage layout: there is no grid of givens to pass.
export function classifyPuzzle(puzzleString, params, opts = {}) {
  const { size, box_h: boxH, box_w: boxW } = params;
  const g = geometry(size, boxH, boxW, puzzleString);
  const countBudget = opts.countBudget ?? new Budget({ nodes: 400_000, ms: 20_000 });
  const t0 = Date.now();

  const counted = countSolutions(g, { limit: 2, budget: countBudget });
  const countMs = Date.now() - t0;

  const noVerdict = (verdict) => ({
    verdict,
    solution: null,
    uniqueness: { verdict, method: 'exhaustive-count-to-2', nodes_searched: counted.nodes, reference_checked: false },
    difficulty: null,
    timings: { count_ms: countMs, band_ms: 0 },
  });
  if (counted.count === 0) return noVerdict('unsolvable');
  if (counted.count > 1) return noVerdict('multiple');

  const solution = counted.solutions[0];
  const t1 = Date.now();
  let band = null, trace = [], maxSearchDepth = 0;
  for (let tier = 1; tier <= MAX_DEDUCTION_TIER; tier++) {
    const bandBudget = opts.bandBudget ?? new Budget({ nodes: 200_000, ms: 20_000 });
    const r = deduce(g, tier, { budget: bandBudget });
    if (r.status === 'solved') { band = tier; trace = r.trace; break; }
    if (r.status === 'contradiction') {
      throw new Error(`solver inconsistency: deduction at tier ${tier} contradicted a counted solution`);
    }
    if (tier === MAX_DEDUCTION_TIER) trace = r.trace;
  }
  if (band === null) {
    band = 5;
    const searchBudget = opts.searchBudget ?? new Budget({ nodes: 400_000, ms: 20_000 });
    const s = searchWithDepth(g, { budget: searchBudget });
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
