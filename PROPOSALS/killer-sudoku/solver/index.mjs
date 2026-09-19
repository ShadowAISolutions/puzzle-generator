// Family adapter for killer-sudoku.
//
// Everything the gate, the hardening suite and the generator are allowed to
// know about this family goes through here.
//
// bands.json is frozen. To stop a later edit to techniques.mjs silently
// reclassifying puzzles already in the corpus, this module asserts at load
// that the code's ladder still matches bands.json exactly, and refuses to
// load if it does not.
//
// Two differences from the classic adapter are worth knowing before reading
// on. First, a killer puzzle has no given digits: the cages are the whole of
// the given information, so every entry point takes the puzzle encoding rather
// than a grid, and `clues` counts cages. Second, the generator works with cage
// layouts that have not been encoded yet, so the verdict functions accept
// either an encoded puzzle string or a geometry built straight from cages.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  geometry, geometryFromCages, encode, decode, checkLayout, isContiguous, cageAnchor,
  CAGE_IDS, MAX_CAGES, maxPossibleSum, sumWidth,
  ALPHABET, SHAPES, isSupportedShape, parseGrid, formatGrid,
} from './geometry.mjs';
import { canonicalForm, canonicalHash } from './canonical.mjs';
import {
  classifyPuzzle, countSolutions, deduce, searchWithDepth,
  SOLVER_VERSION, SEARCH_ENTRY, TIER_WEIGHT, SEARCH_DEPTH_WEIGHT,
} from './solve.mjs';
import { TIER_OF, MAX_DEDUCTION_TIER, TECHNIQUE_NAMES } from './techniques.mjs';
import { cageSumsSatisfied } from './state.mjs';
import { Budget, BudgetExceeded } from '../../lib/budget.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BANDS = JSON.parse(fs.readFileSync(path.join(here, 'bands.json'), 'utf8'));

export const FAMILY = 'killer-sudoku';
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

export const SHAPE_KEYS = ['size', 'box_h', 'box_w'];

// The shapes this family is calibrated on, read from the frozen file rather
// than restated here. A shape whose boxes are not square has no transposition
// in its symmetry group -- transposing a 2x3 box gives a 3x2 one, which is a
// different shape -- and canonical.mjs handles that; what keeps the list short
// is the cost of solving an empty killer board, which is measured per shape
// during calibration.
export const SUPPORTED = BANDS.shapes;

export function validateShape(params) {
  if (!params || typeof params !== 'object') throw new Error('params must be an object');
  const { size, box_h: boxH, box_w: boxW } = params;
  if (!SUPPORTED.some((s) => s.size === size && s.box_h === boxH && s.box_w === boxW)) {
    throw new Error(`unsupported shape ${size} ${boxH}x${boxW}; supported: ${SUPPORTED.map((s) => `${s.size}(${s.box_h}x${s.box_w})`).join(', ')}`);
  }
  return true;
}

export { validateShape as validateParams };

export function makeBudgets(params) {
  const b = BANDS.budgets;
  return {
    countBudget: () => new Budget({ nodes: b.count_nodes, ms: b.ms }),
    bandBudget: () => new Budget({ nodes: b.band_nodes, ms: b.ms }),
    searchBudget: () => new Budget({ nodes: b.search_nodes, ms: b.ms }),
    referenceBudget: () => new Budget({ nodes: b.reference_nodes, ms: b.reference_ms }),
  };
}

// --- accepting either an encoded puzzle or a raw cage layout ----------------

function asGeometry(puzzleOrGeometry, params) {
  if (typeof puzzleOrGeometry === 'string') {
    validateShape(params);
    return geometry(params.size, params.box_h, params.box_w, puzzleOrGeometry);
  }
  if (puzzleOrGeometry && typeof puzzleOrGeometry === 'object' && puzzleOrGeometry.cageCells) return puzzleOrGeometry;
  throw new Error('expected an encoded puzzle string or a cage geometry');
}

// --- the verdict ------------------------------------------------------------

// Fresh solve of a finished puzzle. Nothing from generation is carried in.
export function classify(puzzleString, params) {
  validateShape(params);
  const bd = makeBudgets(params);
  return classifyPuzzle(puzzleString, params, {
    countBudget: bd.countBudget(),
    bandBudget: bd.bandBudget(),
    searchBudget: bd.searchBudget(),
  });
}

// The lowest tier ceiling at which deduction alone finishes the grid, or null
// if no ceiling up to MAX_DEDUCTION_TIER does.
export function deducibleWithin(puzzleOrGeometry, paramsOrTier, maybeTier) {
  const fromString = typeof puzzleOrGeometry === 'string';
  const params = fromString ? paramsOrTier : shapeOf(puzzleOrGeometry);
  const maxTier = fromString ? maybeTier : paramsOrTier;
  const g = asGeometry(puzzleOrGeometry, params);
  const ceiling = Math.min(maxTier, MAX_DEDUCTION_TIER);
  for (let tier = 1; tier <= ceiling; tier++) {
    const r = deduce(g, tier, { budget: makeBudgets(params).bandBudget() });
    if (r.status === 'solved') return { band: tier, trace: r.trace };
    if (r.status === 'contradiction') return { band: null, trace: r.trace, contradiction: true };
  }
  return { band: null, trace: [] };
}

export function uniquenessOf(puzzleOrGeometry, params) {
  const g = asGeometry(puzzleOrGeometry, params ?? shapeOf(puzzleOrGeometry));
  const r = countSolutions(g, { limit: 2, budget: makeBudgets(params ?? shapeOf(g)).countBudget() });
  return { verdict: r.count === 0 ? 'unsolvable' : r.count === 1 ? 'unique' : 'multiple', ...r };
}

function shapeOf(g) {
  return { size: g.size, box_h: g.boxH, box_w: g.boxW };
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

// A killer sudoku gives away no digits. Its cages are the clues, so this
// counts them, and the schema's `clues` field means cages for this family.
export function clues(puzzleString) {
  const bar = puzzleString.indexOf('|');
  if (bar < 0) throw new Error('not a killer-sudoku encoding: no cage/sum separator');
  const seen = new Set();
  for (let i = 0; i < bar; i++) seen.add(puzzleString[i]);
  return seen.size;
}

// The family manifest written to corpus/<family>/family.json.
export function manifest() {
  return {
    family: FAMILY,
    family_version: FAMILY_VERSION,
    display_name: 'Killer Sudoku',
    rules_summary:
      'Fill the grid so that every row, every column and every box contains each symbol exactly once. ' +
      'The grid is also divided into cages. The digits in a cage must be different from each other and must ' +
      'add up to the small number printed in its corner. No digit is given to start with: the cages are the puzzle.',
    canonical_encoding:
      'Two parts separated by "|". The first is size*size cage labels read left to right, top to bottom, ' +
      'each label a character of "0-9A-Za-z" assigned in order of first appearance. The second is every ' +
      `cage's target in that same order, each written as ${sumWidth(9)} decimal digits, zero padded, with no separator.`,
    shapes: SUPPORTED.map((s) => ({ size: s.size, box_h: s.box_h, box_w: s.box_w })),
    symmetry_group:
      'Permutations of the bands, of the rows inside each band, of the stacks and of the columns inside each stack; ' +
      'and transposition. Rotations and reflections are contained in this group. Relabelling the symbols is NOT a ' +
      'symmetry of this family, because a cage target is a sum of the symbols themselves. The canonical form is the ' +
      'lexicographically smallest encoding over the whole group.',
    clues_mean: 'the number of cages; a killer sudoku gives no digits away',
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
  geometry, geometryFromCages, encode, decode, checkLayout, isContiguous, cageAnchor,
  CAGE_IDS, MAX_CAGES, maxPossibleSum, sumWidth,
  ALPHABET, SHAPES, isSupportedShape, parseGrid, formatGrid,
  canonicalForm, canonicalHash, countSolutions, deduce, searchWithDepth,
  cageSumsSatisfied, TECHNIQUE_NAMES, MAX_DEDUCTION_TIER, Budget, BudgetExceeded,
};
