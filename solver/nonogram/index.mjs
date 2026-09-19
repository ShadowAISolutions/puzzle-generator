// Family adapter for nonogram.
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
import { cluesOf, encodePuzzle, encodeGrid, decodePuzzle, runsOfLine } from './encode.mjs';
import {
  classifyClues, countSolutions, ladder, blankState, searchWithDepth, parsePuzzle, clueCount, stallAt,
  verifyComplete, SOLVER_VERSION, SEARCH_ENTRY, TIER_OF, TIER_WEIGHT, SEARCH_DEPTH_WEIGHT,
  MAX_DEDUCTION_TIER, UNKNOWN, FILLED, BLANK,
} from './solve.mjs';
import { Budget, BudgetExceeded } from '../../lib/budget.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BANDS = JSON.parse(fs.readFileSync(path.join(here, 'bands.json'), 'utf8'));

export const FAMILY = 'nonogram';
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

// Shapes need not be square, which is the first family here for which that is
// true. The upper end is set by the schema's 256-character ceiling on the two
// strings: the solution is rows*cols characters, and a clue string's worst case
// is a checkerboard, which costs 2*(rows*ceil(cols/2) + cols*ceil(rows/2)) run
// digits plus separators. A 15x15 checkerboard encodes to 269 characters, so
// 14x14 is the largest square shape that can never overflow.
export const SHAPES = [
  { rows: 5, cols: 5 },
  { rows: 6, cols: 6 },
  { rows: 8, cols: 8 },
  { rows: 10, cols: 10 },
  { rows: 12, cols: 12 },
  { rows: 14, cols: 14 },
  { rows: 5, cols: 8 },
  { rows: 6, cols: 10 },
  { rows: 8, cols: 12 },
  { rows: 10, cols: 15 },
];

// Fifteen columns is the widest shape here, and the limit is the reader rather
// than the solver. A nonogram needs a clue strip down the left as well as the
// grid, and on the 360px screen the site contract has to work at, sixteen
// columns plus a strip wide enough for "2 1 3 1 2 1 1 1" leaves cells 12px
// across. A 12x16 was in this list until the player's own self-test measured
// that and rejected it.

export const SHAPE_KEYS = ['rows', 'cols'];

export function validateShape(params) {
  if (!params || typeof params !== 'object') throw new Error('params must be an object');
  if (!SHAPES.some((s) => s.rows === params.rows && s.cols === params.cols)) {
    throw new Error(
      `unsupported shape ${params.rows}x${params.cols}; supported: ` +
      SHAPES.map((s) => `${s.rows}x${s.cols}`).join(', ')
    );
  }
  return true;
}

export { validateShape as validateParams };

// What a well-shaped nonogram record looks like. The gate asks; this answers.
//
// A nonogram's puzzle string is a clue list, not a grid, so its length has
// nothing to do with rows*cols -- which is exactly the check that used to be
// hard-coded in the gate and that this replaces. What is checked instead is
// stronger: that the clues describe the declared shape, that the solution is a
// legal grid of that shape, and that the clues the solution implies are the
// clues the record carries, character for character. A record whose clues and
// solution disagree cannot get through here.
export function validateEncoding(puzzle, solution, params) {
  validateShape(params);
  const { rows, cols } = params;
  if (typeof puzzle !== 'string') throw new Error('puzzle must be a string');
  if (typeof solution !== 'string') throw new Error('solution must be a string');
  if (solution.length !== rows * cols) {
    throw new Error(`solution is ${solution.length} characters, expected ${rows * cols}`);
  }
  const P = parsePuzzle(puzzle, params);
  const grid = new Int8Array(rows * cols);
  for (let i = 0; i < solution.length; i++) {
    const ch = solution[i];
    if (ch === '#') grid[i] = 1;
    else if (ch === '.') grid[i] = 0;
    else throw new Error(`solution holds ${JSON.stringify(ch)}, expected "#" or "."`);
  }
  const { rowRuns, colRuns } = cluesOf(grid, rows, cols);
  for (let r = 0; r < rows; r++) {
    if (rowRuns[r].join(',') !== P.rowRuns[r].join(',')) throw new Error(`row ${r} of the solution does not match its clue`);
  }
  for (let c = 0; c < cols; c++) {
    if (colRuns[c].join(',') !== P.colRuns[c].join(',')) throw new Error(`column ${c} of the solution does not match its clue`);
  }
}

export function makeBudgets(params) {
  const b = BANDS.budgets;
  const cells = (params?.rows ?? 0) * (params?.cols ?? 0);
  const scale = cells > 144 ? 3 : 1;
  return {
    countBudget: () => new Budget({ nodes: b.count_nodes * scale, ms: b.ms }),
    bandBudget: () => new Budget({ nodes: b.band_nodes * scale, ms: b.ms }),
    searchBudget: () => new Budget({ nodes: b.search_nodes * scale, ms: b.ms }),
    referenceBudget: () => new Budget({ nodes: b.reference_nodes, ms: b.reference_ms }),
  };
}

// --- the verdict ------------------------------------------------------------

// Fresh solve of a clue set. Nothing from generation is carried in.
export function classify(puzzleString, params) {
  validateShape(params);
  const P = parsePuzzle(puzzleString, params);
  const bd = makeBudgets(params);
  return classifyClues(P, {
    countBudget: bd.countBudget(),
    bandBudget: bd.bandBudget(),
    searchBudget: bd.searchBudget(),
  });
}

// The lowest tier ceiling at which deduction alone finishes the grid, or null
// if no ceiling up to MAX_DEDUCTION_TIER does.
export function deducibleWithin(puzzleString, params, maxTier) {
  const P = parsePuzzle(puzzleString, params);
  const ceiling = Math.min(maxTier, MAX_DEDUCTION_TIER);
  for (let tier = 1; tier <= ceiling; tier++) {
    const st = blankState(P.rows, P.cols);
    const trace = [];
    const r = ladder(st, P, tier, makeBudgets(params).bandBudget(), trace);
    if (r === 'solved') return { band: tier, trace };
    if (r === 'contradiction') return { band: null, trace, contradiction: true };
  }
  return { band: null, trace: [] };
}

// How many cells propagation at this tier ceiling leaves undecided. The
// generator hill climbs on this; nothing in the gate or the band depends on it.
export function residualAt(puzzleString, params, tier) {
  const P = parsePuzzle(puzzleString, params);
  return stallAt(P, tier, makeBudgets(params).bandBudget());
}

export function uniquenessOf(puzzleString, params) {
  const P = parsePuzzle(puzzleString, params);
  const r = countSolutions(P, { limit: 2, budget: makeBudgets(params).countBudget() });
  return { verdict: r.count === 0 ? 'unsolvable' : r.count === 1 ? 'unique' : 'multiple', ...r };
}

export function hashOf(puzzleString) {
  return canonicalHash(puzzleString, FAMILY_VERSION);
}

export function formOf(puzzleString) {
  return canonicalForm(puzzleString);
}

// Does the reference brute force have to confirm this instance?
export function needsReferenceCheck(params, rand) {
  const cc = BANDS.reference_cross_check;
  if (params.rows * params.cols <= cc.always_at_or_below_cells) return true;
  return rand < cc.random_fraction_above;
}

export function clues(puzzleString) {
  return clueCount(puzzleString);
}

// --- what the generator needs -----------------------------------------------
//
// The generator works in grids and needs them turned into the family's two
// strings. It goes through here rather than reaching into encode.mjs, so that
// the encoding stays this module's business.

export function encodeFrom(grid, rows, cols) {
  const { rowRuns, colRuns } = cluesOf(grid, rows, cols);
  return encodePuzzle(rowRuns, colRuns);
}

export function encodeSolution(grid, rows, cols) {
  return encodeGrid(grid, rows, cols);
}

// --- test material for the hardening suite ----------------------------------
//
// Four of the suite's passes build their own instances, and it asks the family
// for them. None of this ever reaches corpus/, and none of it may come from
// generators/, which the import check enforces: material built by the code
// under test would prove nothing. The grids below are therefore built here,
// from the rules, and deliberately not the way the generator builds them.

// Kept small and kept inside SHAPES. Both matter: the suite runs thousands of
// instances against a reference that enumerates whole row arrangements, and a
// shape the family does not support makes validateShape throw, which the
// differential pass counts as a solver crash rather than a verdict.
const HARDEN_SHAPES = [{ rows: 5, cols: 5 }, { rows: 6, cols: 6 }, { rows: 5, cols: 8 }, { rows: 8, cols: 8 }];

function randomGrid(rng, rows, cols, density) {
  const g = new Int8Array(rows * cols);
  for (let i = 0; i < g.length; i++) g[i] = rng.float() < density ? 1 : 0;
  return g;
}

export function randomInstance(rng) {
  const shape = HARDEN_SHAPES[rng.int(HARDEN_SHAPES.length)];
  const params = { rows: shape.rows, cols: shape.cols };
  const roll = rng.float();

  if (roll < 0.15) {
    // Clue lists invented out of thin air, most of which describe no grid at
    // all. The solver must say so rather than throwing or looping.
    const side = (n, len) => Array.from({ length: n }, () => {
      const k = rng.int(3);
      return Array.from({ length: k }, () => 1 + rng.int(len)).map((v) => v.toString(36)).join('');
    }).join(',');
    return { kind: 'noise', params, puzzle: `${side(shape.rows, shape.cols)}|${side(shape.cols, shape.rows)}` };
  }

  const grid = randomGrid(rng, shape.rows, shape.cols, 0.2 + rng.float() * 0.6);
  const puzzle = encodeFrom(grid, shape.rows, shape.cols);

  if (roll < 0.35) {
    // A single run altered, which almost always makes the two clue lists
    // disagree about how many cells are filled.
    return { kind: 'corrupted', params, puzzle: mutateOneRun(rng, puzzle) };
  }
  return { kind: 'honest', params, puzzle };
}

function mutateOneRun(rng, puzzle) {
  const [rowsPart, colsPart] = puzzle.split('|');
  const sides = [rowsPart.split(','), colsPart.split(',')];
  const withRuns = [];
  for (let s = 0; s < 2; s++) for (let i = 0; i < sides[s].length; i++) if (sides[s][i].length) withRuns.push([s, i]);
  if (!withRuns.length) return puzzle;
  const [s, i] = withRuns[rng.int(withRuns.length)];
  const group = sides[s][i];
  const j = rng.int(group.length);
  const n = parseInt(group[j], 36);
  const next = rng.float() < 0.5 ? Math.max(1, n - 1) : n + 1;
  sides[s][i] = group.slice(0, j) + next.toString(36) + group.slice(j + 1);
  return `${sides[0].join(',')}|${sides[1].join(',')}`;
}

// A nonogram has no redundant information to remove, so "minimal" means
// something different here from what it means for sudoku or binairo, and
// pretending otherwise would be dishonest.
//
// Those families present a subset of a finished grid, and a dig asks which
// members of that subset are load-bearing. A nonogram presents its clues, and
// the clues are a function of the solution: there is no subset to choose and
// nothing to leave out. Every unique nonogram is already minimal, trivially.
//
// So this returns an honest unique instance, and `weakenings` below explains
// what the mutation pass can and cannot ask of it.
export function minimalUniqueInstance(rng, S) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const shape = HARDEN_SHAPES[rng.int(HARDEN_SHAPES.length)];
    const params = { rows: shape.rows, cols: shape.cols };
    const grid = randomGrid(rng, shape.rows, shape.cols, 0.3 + rng.float() * 0.4);
    const puzzle = encodeFrom(grid, shape.rows, shape.cols);
    try {
      if (S.uniquenessOf(puzzle, params).verdict === 'unique') return { kind: 'minimal', params, puzzle };
    } catch { /* a budget miss is not an instance; draw again */ }
  }
  // Every line empty: one filled cell nowhere, exactly one solution, always.
  const shape = HARDEN_SHAPES[0];
  const params = { rows: shape.rows, cols: shape.cols };
  const puzzle = encodeFrom(new Int8Array(shape.rows * shape.cols), shape.rows, shape.cols);
  return { kind: 'minimal', params, puzzle };
}

// One-step mutations of a clue set, in a stable order.
//
// The suite's default weakening removes one given and demands that uniqueness
// break. That demand cannot be made of a nonogram, and the reason is a proof
// rather than an inconvenience: a line's clue names its run lengths exactly, so
// the sets of lines satisfying two different clues are disjoint. No clue is
// weaker than another. Changing a run does not enlarge the solution set, it
// replaces it -- which is why a mutated nonogram can perfectly well still be
// unique, with a different solution.
//
// What survives, and is the half of the pass worth having, is that the solver
// and the reference must agree on every one of these mutants. They are drawn to
// be nasty: shortened and lengthened runs, dropped runs, runs split in two, and
// clue lists whose two sides no longer agree on the number of filled cells.
//
// So a minimality claim gets the empty list, and that is the literal truth
// rather than an opt-out: a nonogram has no one-step weakenings, so there are
// none to return. Selecting instances whose mutants all happen to break
// uniqueness would turn the pass green while testing nothing, which is the
// failure mode the anti-drift rules exist to prevent. Measured on 1,502 mutants
// of 25 unique instances: 0.4% stayed unique, every one of them with a
// different solution, and the solver and the reference never once disagreed.
export function weakenings(inst) {
  if (inst.kind === 'minimal') return [];
  const [rowsPart, colsPart] = inst.puzzle.split('|');
  const sides = [rowsPart.split(','), colsPart.split(',')];
  const out = [];
  const emit = (s, i, group) => {
    const copy = [sides[0].slice(), sides[1].slice()];
    copy[s][i] = group;
    out.push({ at: `${s}:${i}`, puzzle: `${copy[0].join(',')}|${copy[1].join(',')}` });
  };
  for (let s = 0; s < 2; s++) {
    for (let i = 0; i < sides[s].length; i++) {
      const group = sides[s][i];
      for (let j = 0; j < group.length; j++) {
        const n = parseInt(group[j], 36);
        if (n > 1) emit(s, i, group.slice(0, j) + (n - 1).toString(36) + group.slice(j + 1));
        emit(s, i, group.slice(0, j) + (n + 1).toString(36) + group.slice(j + 1));
        emit(s, i, group.slice(0, j) + group.slice(j + 1));
        if (n > 1) emit(s, i, group.slice(0, j) + '1' + (n - 1).toString(36) + group.slice(j + 1));
      }
      if (!group.length) emit(s, i, '1');
    }
  }
  return out;
}

export function fuzzCase(rng, i) {
  const shape = HARDEN_SHAPES[rng.int(HARDEN_SHAPES.length)];
  const params = { rows: shape.rows, cols: shape.cols };
  const good = encodeFrom(randomGrid(rng, shape.rows, shape.cols, 0.5), shape.rows, shape.cols);
  const kinds = [
    () => ({ why: 'truncated', params, puzzle: good.slice(0, rng.int(good.length)) }),
    () => ({ why: 'no separator', params, puzzle: good.replace('|', '') }),
    () => ({ why: 'two separators', params, puzzle: `${good}|${good}` }),
    () => ({ why: 'oversized', params, puzzle: `${'1,'.repeat(50000)}1|1` }),
    () => ({ why: 'bad character', params, puzzle: good.replace(/[0-9a-z]/, rng.pick(['!', ' ', '\n', '\u0000', '\u{1F600}', '-', '#', '.'])) }),
    () => ({ why: 'zero run', params, puzzle: good.replace(/[1-9]/, '0') }),
    () => ({ why: 'empty string', params, puzzle: '' }),
    () => ({ why: 'not a string', params, puzzle: rng.pick([null, undefined, 42, {}, [], true, NaN]) }),
    () => ({ why: 'wrong row count', params, puzzle: good.replace('|', ',1|') }),
    () => ({ why: 'unsupported shape', params: { rows: rng.pick([3, 7, 9, 40, 0, -5]), cols: rng.pick([3, 9, 40, 0]) }, puzzle: good }),
    () => ({ why: 'non-integer shape', params: { rows: 8.5, cols: 8 }, puzzle: good }),
    () => ({ why: 'params not an object', params: rng.pick([null, undefined, 'eight', 8, []]), puzzle: good }),
    () => ({ why: 'run longer than the line', params, puzzle: `${'z'},${'1,'.repeat(shape.rows - 2)}1|${'1,'.repeat(shape.cols - 1)}1` }),
    () => ({ why: 'sides disagree on filled cells', params, puzzle: `${good.split('|')[0]}|${'1,'.repeat(shape.cols - 1)}1` }),
    () => ({ why: 'grid string instead of clues', params, puzzle: '#'.repeat(shape.rows * shape.cols) }),
    () => ({ why: 'prototype-looking keys', params: { rows: shape.rows, cols: shape.cols, __proto__: { rows: 99 } }, puzzle: good }),
  ];
  return kinds[i % kinds.length]();
}

// The family manifest written to corpus/<family>/family.json.
export function manifest() {
  return {
    family: FAMILY,
    family_version: FAMILY_VERSION,
    display_name: 'Nonogram',
    rules_summary:
      'Every row and every column carries a list of numbers giving the lengths of its blocks of filled ' +
      'cells, in order, with at least one empty cell between consecutive blocks. Fill in the grid so that ' +
      'every row and every column matches its list. A line with no numbers is entirely empty.',
    canonical_encoding:
      'The puzzle is "<row clues>|<column clues>". Each side is one group per line, joined by commas, and ' +
      'each group is that line\'s run lengths as single base-36 digits, so an empty group is a line with no ' +
      'filled cells. The solution is one character per cell in reading order, "#" filled and "." empty.',
    shapes: SHAPES.map((s) => ({ size: Math.max(s.rows, s.cols), rows: s.rows, cols: s.cols })),
    symmetry_group:
      'The four symmetries of the rectangle -- identity, mirror left to right, mirror top to bottom and a ' +
      'half turn -- each with or without transposing, eight in all. Transposing is included because the two ' +
      'clue lists play identical roles, so swapping them gives a puzzle a solver works through identically ' +
      'with the axes relabelled. Exchanging filled for empty is deliberately excluded: the clues describe ' +
      'the filled cells and say nothing about the empty ones, so the inverted grid is a different puzzle. ' +
      'The canonical form is the lexicographically smallest encoding over the group.',
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
  parsePuzzle, clueCount, verifyComplete, canonicalForm, canonicalHash, decodePuzzle, runsOfLine,
  countSolutions, searchWithDepth, MAX_DEDUCTION_TIER, UNKNOWN, FILLED, BLANK,
  Budget, BudgetExceeded,
};
