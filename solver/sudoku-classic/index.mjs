// Family adapter for sudoku-classic.
//
// Everything the gate, the hardening suite and the generators are allowed to
// know about this family goes through here.
//
// bands.json is frozen. To stop a later edit to techniques.mjs silently
// reclassifying puzzles already in the corpus, this module asserts at load
// that the code's ladder still matches bands.json exactly, and refuses to
// load if it does not.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { geometry, parseGrid, formatGrid, clueCount, isSupportedShape, SHAPES, ALPHABET } from './geometry.mjs';
import { canonicalForm, canonicalHash } from './canonical.mjs';
import { classifyGrid, countSolutions, deduce, searchWithDepth, SOLVER_VERSION, SEARCH_ENTRY, TIER_WEIGHT, SEARCH_DEPTH_WEIGHT } from './solve.mjs';
import { TIER_OF, MAX_DEDUCTION_TIER } from './techniques.mjs';
import { Budget, BudgetExceeded } from '../../lib/budget.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BANDS = JSON.parse(fs.readFileSync(path.join(here, 'bands.json'), 'utf8'));

export const FAMILY = 'sudoku-classic';
export const FAMILY_VERSION = 1;
export { SOLVER_VERSION };

// --- the frozen-calibration assertion ---------------------------------------

(function assertLadderMatchesBands() {
  const fromCode = TIER_OF;
  const fromBands = BANDS.technique_tiers;
  const codeNames = Object.keys(fromCode).sort();
  const bandNames = Object.keys(fromBands).sort();
  if (codeNames.join(',') !== bandNames.join(',')) {
    throw new Error(
      `frozen calibration broken: technique set differs from bands.json\n` +
      `  only in code:  ${codeNames.filter((n) => !bandNames.includes(n)).join(', ') || '(none)'}\n` +
      `  only in bands: ${bandNames.filter((n) => !codeNames.includes(n)).join(', ') || '(none)'}`
    );
  }
  for (const n of codeNames) {
    if (fromCode[n] !== fromBands[n]) {
      throw new Error(`frozen calibration broken: ${n} is tier ${fromCode[n]} in code, ${fromBands[n]} in bands.json`);
    }
  }
  for (const [k, v] of Object.entries(BANDS.tier_weights)) {
    if (TIER_WEIGHT[k] !== v) throw new Error(`frozen calibration broken: tier weight ${k} is ${TIER_WEIGHT[k]} in code, ${v} in bands.json`);
  }
  if (BANDS.search_depth_weight !== SEARCH_DEPTH_WEIGHT) throw new Error('frozen calibration broken: search_depth_weight');
  if (BANDS.search_entry !== SEARCH_ENTRY) throw new Error('frozen calibration broken: search_entry');
})();

// --- parameters -------------------------------------------------------------

// The solver cares only about the grid shape. Everything else in a record's
// `params` belongs to the generator, which validates its own keys; the solver
// deliberately does not, so that adding a generator knob never requires
// touching a frozen file.
export const SHAPE_KEYS = ['size', 'box_h', 'box_w'];

export function validateShape(params) {
  if (!params || typeof params !== 'object') throw new Error('params must be an object');
  const { size, box_h: boxH, box_w: boxW } = params;
  if (!isSupportedShape(size, boxH, boxW)) {
    throw new Error(`unsupported shape ${size} ${boxH}x${boxW}; supported: ${SHAPES.map((s) => `${s.size}(${s.boxH}x${s.boxW})`).join(', ')}`);
  }
  return true;
}

export { validateShape as validateParams };

// The encoding check the gate used to make inline. Word for word the same two
// rules and the same two messages; it lives here now because what counts as a
// well-shaped puzzle string is a fact about the family, not about the gate.
export function validateEncoding(puzzle, solution, params) {
  const size = params.size;
  if (puzzle.length !== size * size) throw new Error('puzzle length does not match size');
  if (solution.includes('.')) throw new Error('solution has an empty cell');
}

export function makeBudgets(params) {
  const b = BANDS.budgets;
  const scale = params && params.size > 9 ? 2 : 1;
  return {
    countBudget: () => new Budget({ nodes: b.count_nodes * scale, ms: b.ms }),
    bandBudget: () => new Budget({ nodes: b.band_nodes * scale, ms: b.ms }),
    searchBudget: () => new Budget({ nodes: b.search_nodes * scale, ms: b.ms }),
    referenceBudget: () => new Budget({ nodes: b.reference_nodes, ms: b.reference_ms }),
  };
}

// --- the verdict ------------------------------------------------------------

// Fresh solve of a finished puzzle. Nothing from generation is carried in.
export function classify(puzzleString, params) {
  validateShape(params);
  const grid = parseGrid(puzzleString, params.size);
  const bd = makeBudgets(params);
  return classifyGrid(grid, params, {
    countBudget: bd.countBudget(),
    bandBudget: bd.bandBudget(),
    searchBudget: bd.searchBudget(),
  });
}

// The lowest tier ceiling at which deduction alone finishes the grid, or null
// if no ceiling up to MAX_DEDUCTION_TIER does. Escalates from tier 1 so the
// expensive techniques are only reached when the cheap ones are not enough.
export function deducibleWithin(puzzleString, params, maxTier) {
  const grid = typeof puzzleString === 'string' ? parseGrid(puzzleString, params.size) : puzzleString;
  const g = geometry(params.size, params.box_h, params.box_w);
  const ceiling = Math.min(maxTier, MAX_DEDUCTION_TIER);
  for (let tier = 1; tier <= ceiling; tier++) {
    const r = deduce(grid, g, tier, { budget: makeBudgets(params).bandBudget() });
    if (r.status === 'solved') return { band: tier, trace: r.trace };
    if (r.status === 'contradiction') return { band: null, trace: r.trace, contradiction: true };
  }
  return { band: null, trace: [] };
}

export function uniquenessOf(puzzleString, params) {
  const grid = typeof puzzleString === 'string' ? parseGrid(puzzleString, params.size) : puzzleString;
  const g = geometry(params.size, params.box_h, params.box_w);
  const r = countSolutions(grid, g, { limit: 2, budget: makeBudgets(params).countBudget() });
  return { verdict: r.count === 0 ? 'unsolvable' : r.count === 1 ? 'unique' : 'multiple', ...r };
}

export function hashOf(puzzleString, params) {
  return canonicalHash(puzzleString, params.size, params.box_h, params.box_w, FAMILY_VERSION);
}

export function formOf(puzzleString, params) {
  return canonicalForm(puzzleString, params.size, params.box_h, params.box_w);
}

// Does the reference brute force have to confirm this instance?
export function needsReferenceCheck(params, rand) {
  const cc = BANDS.reference_cross_check;
  if (params.size <= cc.always_at_or_below_size) return true;
  return rand < cc.random_fraction_above;
}

export function clues(puzzleString) {
  let n = 0;
  for (const ch of puzzleString) if (ch !== '.') n++;
  return n;
}

// The family manifest written to corpus/<family>/family.json.
export function manifest() {
  return {
    family: FAMILY,
    family_version: FAMILY_VERSION,
    display_name: 'Classic Sudoku',
    rules_summary:
      'Fill the grid so that every row, every column and every box contains each symbol exactly once. ' +
      'A puzzle is presented as its givens; the rest of the cells are yours to fill.',
    canonical_encoding:
      'A single string of size*size characters read left to right, top to bottom. Symbols are "123456789ABCDEFG" ' +
      'truncated to the grid size, and "." marks an empty cell.',
    shapes: SHAPES.map((s) => ({ size: s.size, box_h: s.boxH, box_w: s.boxW })),
    symmetry_group:
      'Permutations of the bands, of the rows inside each band, of the stacks and of the columns inside each stack; ' +
      'transposition; and relabelling of the symbols. Rotations and reflections are contained in this group. ' +
      'The canonical form is the lexicographically smallest encoding over the whole group, with givens ordered ' +
      'before blanks and symbols renumbered by first appearance.',
    technique_ladder: BANDS.technique_tiers,
    bands: BANDS.bands,
    tier_weights: BANDS.tier_weights,
    search_depth_weight: BANDS.search_depth_weight,
    solver_version: SOLVER_VERSION,
    hardening_report: `HARDENING/${FAMILY}.md`,
    player: `site/play/${FAMILY}.html`,
  };
}

export {
  geometry, parseGrid, formatGrid, clueCount, ALPHABET, SHAPES,
  canonicalForm, canonicalHash, countSolutions, deduce, searchWithDepth,
  MAX_DEDUCTION_TIER, Budget, BudgetExceeded,
};
