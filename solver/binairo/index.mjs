// Family adapter for binairo.
//
// Everything the gate, the hardening suite and the generators are allowed to
// know about this family goes through here.
//
// bands.json is frozen. To stop a later edit to solve.mjs silently
// reclassifying puzzles already in the corpus, this module asserts at load
// that the code's ladder still matches bands.json exactly, and refuses to
// load if it does not.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalForm, canonicalHash } from './canonical.mjs';
import {
  classifyGrid, countSolutions, deduce, searchWithDepth, parseGrid, formatGrid, clueCount,
  verifyComplete, SOLVER_VERSION, SEARCH_ENTRY, TIER_OF, TIER_WEIGHT, SEARCH_DEPTH_WEIGHT,
  MAX_DEDUCTION_TIER, UNKNOWN, ZERO, ONE,
} from './solve.mjs';
import { Budget, BudgetExceeded } from '../../lib/budget.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BANDS = JSON.parse(fs.readFileSync(path.join(here, 'bands.json'), 'utf8'));

export const FAMILY = 'binairo';
export const FAMILY_VERSION = 1;
export { SOLVER_VERSION };

// --- the frozen-calibration assertion ---------------------------------------

(function assertLadderMatchesBands() {
  const codeNames = Object.keys(TIER_OF).sort();
  const bandNames = Object.keys(BANDS.technique_tiers).sort();
  if (codeNames.join(',') !== bandNames.join(',')) {
    throw new Error(
      `frozen calibration broken: technique set differs from bands.json\n` +
      `  only in code:  ${codeNames.filter((n) => !bandNames.includes(n)).join(', ') || '(none)'}\n` +
      `  only in bands: ${bandNames.filter((n) => !codeNames.includes(n)).join(', ') || '(none)'}`
    );
  }
  for (const n of codeNames) {
    if (TIER_OF[n] !== BANDS.technique_tiers[n]) {
      throw new Error(`frozen calibration broken: ${n} is tier ${TIER_OF[n]} in code, ${BANDS.technique_tiers[n]} in bands.json`);
    }
  }
  for (const [k, v] of Object.entries(BANDS.tier_weights)) {
    if (TIER_WEIGHT[k] !== v) throw new Error(`frozen calibration broken: tier weight ${k} is ${TIER_WEIGHT[k]} in code, ${v} in bands.json`);
  }
  if (BANDS.search_depth_weight !== SEARCH_DEPTH_WEIGHT) throw new Error('frozen calibration broken: search_depth_weight');
  if (BANDS.search_entry !== SEARCH_ENTRY) throw new Error('frozen calibration broken: search_entry');
})();

// --- parameters -------------------------------------------------------------

// Only even sizes exist. Half the cells in every line must carry each symbol,
// which an odd line cannot do, so an odd binairo is not a hard binairo -- it
// is not a binairo. The upper end is where the schema's 256-character ceiling
// on the solution string lands.
export const SIZES = [6, 8, 10, 12, 14, 16];

export const SHAPE_KEYS = ['size'];

export function validateShape(params) {
  if (!params || typeof params !== 'object') throw new Error('params must be an object');
  if (!SIZES.includes(params.size)) {
    throw new Error(`unsupported size ${params.size}; supported: ${SIZES.join(', ')}`);
  }
  return true;
}

export { validateShape as validateParams };

// What a well-shaped binairo record looks like. The gate asks; this answers.
// Stricter than the length check it replaced, because it also insists the
// solution is a legal finished board and that it actually completes the
// puzzle rather than merely sharing its shape.
export function validateEncoding(puzzle, solution, params) {
  validateShape(params);
  const size = params.size;
  if (puzzle.length !== size * size) throw new Error(`puzzle is ${puzzle.length} characters, expected ${size * size}`);
  if (solution.length !== size * size) throw new Error(`solution is ${solution.length} characters, expected ${size * size}`);
  if (solution.includes('.')) throw new Error('solution has an empty cell');
  const p = parseGrid(puzzle, size);
  const s = parseGrid(solution, size);
  if (!verifyComplete(s, size)) throw new Error('solution does not obey the binairo rules');
  for (let i = 0; i < p.length; i++) {
    if (p[i] !== UNKNOWN && p[i] !== s[i]) throw new Error(`given at cell ${i} contradicts the solution`);
  }
}

export function makeBudgets(params) {
  const b = BANDS.budgets;
  const scale = params && params.size > 12 ? 3 : 1;
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
  const ceiling = Math.min(maxTier, MAX_DEDUCTION_TIER);
  for (let tier = 1; tier <= ceiling; tier++) {
    const r = deduce(grid, params.size, tier, { budget: makeBudgets(params).bandBudget() });
    if (r.status === 'solved') return { band: tier, trace: r.trace };
    if (r.status === 'contradiction') return { band: null, trace: r.trace, contradiction: true };
  }
  return { band: null, trace: [] };
}

export function uniquenessOf(puzzleString, params) {
  const grid = typeof puzzleString === 'string' ? parseGrid(puzzleString, params.size) : puzzleString;
  const r = countSolutions(grid, params.size, { limit: 2, budget: makeBudgets(params).countBudget() });
  return { verdict: r.count === 0 ? 'unsolvable' : r.count === 1 ? 'unique' : 'multiple', ...r };
}

export function hashOf(puzzleString, params) {
  return canonicalHash(puzzleString, params.size, FAMILY_VERSION);
}

export function formOf(puzzleString, params) {
  return canonicalForm(puzzleString, params.size);
}

// Does the reference brute force have to confirm this instance?
export function needsReferenceCheck(params, rand) {
  const cc = BANDS.reference_cross_check;
  if (params.size <= cc.always_at_or_below_size) return true;
  return rand < cc.random_fraction_above;
}

export function clues(puzzleString) {
  return clueCount(puzzleString);
}

// --- test material for the hardening suite ----------------------------------
//
// Four of the suite's passes build their own instances, and it asks the family
// for them. These exist only to be hardened against: none of it ever reaches
// corpus/, and none of it may come from generators/, which the import check
// enforces. The board builder below is therefore written here from the rules
// rather than shared with the generator, which is the point -- material built
// by the code under test would prove nothing.

function buildBoard(rng, size) {
  const half = size / 2;
  const g = new Int8Array(size * size);
  const legalAt = (i) => {
    const r = Math.floor(i / size), c = i % size;
    for (const isRow of [true, false]) {
      const n = isRow ? r : c;
      let z = 0, o = 0, done = true;
      for (let k = 0; k < size; k++) {
        const v = isRow ? g[n * size + k] : g[k * size + n];
        if (v === ZERO) z++; else if (v === ONE) o++; else done = false;
        if (k >= 2) {
          const a = isRow ? g[n * size + k] : g[k * size + n];
          const b = isRow ? g[n * size + k - 1] : g[(k - 1) * size + n];
          const d = isRow ? g[n * size + k - 2] : g[(k - 2) * size + n];
          if (a !== UNKNOWN && a === b && a === d) return false;
        }
      }
      if (z > half || o > half) return false;
      if (done) {
        for (let m = 0; m < size; m++) {
          if (m === n) continue;
          let same = true;
          for (let k = 0; k < size; k++) {
            const v = isRow ? g[m * size + k] : g[k * size + m];
            const w = isRow ? g[n * size + k] : g[k * size + n];
            if (v === UNKNOWN || v !== w) { same = false; break; }
          }
          if (same) return false;
        }
      }
    }
    return true;
  };
  const rec = (i) => {
    if (i === g.length) return true;
    const first = rng.uint32() % 2 === 0 ? ZERO : ONE;
    for (const v of [first, first === ZERO ? ONE : ZERO]) {
      g[i] = v;
      if (legalAt(i) && rec(i + 1)) return true;
      g[i] = UNKNOWN;
    }
    return false;
  };
  if (!rec(0)) throw new Error(`could not build a ${size}x${size} board`);
  return g;
}

// Kept small on purpose. The suite runs thousands of instances against a
// reference that enumerates cell by cell, and a 14x14 with few givens costs
// minutes there; the bugs worth catching show up at 6x6 and 8x8 just as well.
const HARDEN_SIZES = [6, 8, 10];

export function randomInstance(rng) {
  const size = HARDEN_SIZES[rng.int(HARDEN_SIZES.length)];
  const params = { size };
  const cells = size * size;
  const roll = rng.float();
  if (roll < 0.15) {
    const grid = new Array(cells).fill('.');
    const k = 1 + rng.int(Math.max(2, Math.floor(cells * 0.35)));
    for (let i = 0; i < k; i++) grid[rng.int(cells)] = rng.uint32() % 2 === 0 ? '0' : '1';
    return { kind: 'noise', params, puzzle: grid.join('') };
  }
  const full = buildBoard(rng, size);
  const keep = 0.15 + rng.float() * 0.75;
  const grid = Array.from(full, (v) => (rng.float() < keep ? (v === ZERO ? '0' : '1') : '.'));
  if (roll < 0.40) {
    const at = [];
    for (let i = 0; i < grid.length; i++) if (grid[i] !== '.') at.push(i);
    if (at.length) {
      const i = at[rng.int(at.length)];
      grid[i] = grid[i] === '0' ? '1' : '0';
    }
    return { kind: 'corrupted', params, puzzle: grid.join('') };
  }
  return { kind: 'dug', params, puzzle: grid.join('') };
}

// A minimal unique instance: dug to a fixpoint, so removing any single given
// breaks uniqueness. The mutation pass needs these; a random instance is
// usually so heavily given that a clue can be dropped with the solution still
// forced, which tests nothing.
export function minimalUniqueInstance(rng, S) {
  const size = HARDEN_SIZES[rng.int(HARDEN_SIZES.length)];
  const params = { size };
  const cells = buildBoard(rng, size);
  const order = rng.shuffle(Array.from({ length: size * size }, (_, i) => i));
  for (let pass = 0; pass < 3; pass++) {
    let progress = false;
    for (const i of order) {
      if (cells[i] === UNKNOWN) continue;
      const saved = cells[i];
      cells[i] = UNKNOWN;
      if (S.uniquenessOf(formatGrid(cells), params).verdict === 'unique') progress = true;
      else cells[i] = saved;
    }
    if (!progress) break;
  }
  return { kind: 'minimal', params, puzzle: formatGrid(cells) };
}

export function fuzzCase(rng, i) {
  const size = HARDEN_SIZES[rng.int(HARDEN_SIZES.length)];
  const params = { size };
  const good = formatGrid(buildBoard(rng, size));
  const kinds = [
    () => ({ why: 'too short', params, puzzle: good.slice(0, rng.int(good.length)) }),
    () => ({ why: 'too long', params, puzzle: good + '.'.repeat(1 + rng.int(40)) }),
    () => ({ why: 'oversized', params, puzzle: '.'.repeat(100000) }),
    () => ({ why: 'bad character', params, puzzle: good.slice(0, -1) + rng.pick(['2', '9', 'Z', ' ', '\n', '\u0000', '\u{1F600}', '-', '#']) }),
    () => ({ why: 'empty string', params, puzzle: '' }),
    () => ({ why: 'not a string', params, puzzle: rng.pick([null, undefined, 42, {}, [], true, NaN]) }),
    () => ({ why: 'odd size', params: { size: rng.pick([5, 7, 9, 11, 13]) }, puzzle: good }),
    () => ({ why: 'unsupported size', params: { size: rng.pick([0, 1, 2, 4, 18, 64, -8, 1e6]) }, puzzle: good }),
    () => ({ why: 'non-integer size', params: { size: 8.5 }, puzzle: good }),
    () => ({ why: 'params not an object', params: rng.pick([null, undefined, 'eight', 8, []]), puzzle: good }),
    () => ({ why: 'all one symbol', params, puzzle: '0'.repeat(size * size) }),
    () => ({ why: 'unicode padding', params, puzzle: '́'.repeat(size * size) }),
    () => ({ why: 'whitespace grid', params, puzzle: ' '.repeat(size * size) }),
    () => ({ why: 'sudoku digits', params, puzzle: '5'.repeat(size * size) }),
    () => ({ why: 'prototype-looking keys', params: { size, __proto__: { size: 99 } }, puzzle: good }),
  ];
  return kinds[i % kinds.length]();
}

// The family manifest written to corpus/<family>/family.json.
export function manifest() {
  return {
    family: FAMILY,
    family_version: FAMILY_VERSION,
    display_name: 'Binairo',
    rules_summary:
      'Fill every cell with a 0 or a 1 so that no three neighbours in a row or column are the same symbol, ' +
      'every row and every column holds as many 0s as 1s, and no two rows and no two columns are identical. ' +
      'A puzzle is presented as its givens; the rest of the cells are yours to fill.',
    canonical_encoding:
      'A single string of size*size characters read left to right, top to bottom, drawn from "0", "1" and ' +
      '"." for an empty cell. The grid is always square and its size is always even.',
    shapes: SIZES.map((size) => ({ size })),
    symmetry_group:
      'The eight symmetries of the square -- four rotations and four reflections -- each with or without ' +
      'exchanging the two symbols, sixteen in all. Permuting rows or columns is deliberately not included: ' +
      'it preserves every row but breaks the columns. The canonical form is the lexicographically smallest ' +
      'encoding over the whole group.',
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
  parseGrid, formatGrid, clueCount, verifyComplete, canonicalForm, canonicalHash,
  countSolutions, deduce, searchWithDepth, MAX_DEDUCTION_TIER, UNKNOWN, ZERO, ONE,
  Budget, BudgetExceeded,
};
