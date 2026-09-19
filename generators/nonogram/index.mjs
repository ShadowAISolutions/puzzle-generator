// Generator for nonograms.
//
// Pure function of (GENERATOR_VERSION, seed, params). Nothing here reads the
// clock, the filesystem or Math.random, because the gate regenerates every
// record from its seed and compares byte for byte.
//
// This family does not dig, and that is the whole difference from sudoku and
// binairo. Those two start from a finished grid and choose which givens to keep,
// so the same solution can be dressed as an easy puzzle or a hard one. A
// nonogram has no givens: its clues are a function of its solution, fully
// determined, with nothing to remove. The only lever is which grid to pick.
//
// So the search is a hill climb over grids. Start from a random field at the
// requested density, smooth it so the runs are long enough to be pleasant
// rather than a checkerboard, then flip cells one at a time and keep the flips
// that move the solver's verdict toward the band asked for. A uniformly random
// grid is almost always band 1 -- measured, not assumed -- so without the climb
// this family would produce one difficulty and call it five.
//
// The generator's intent is not evidence. Every puzzle it emits is classified
// from scratch by the solver, and the band the solver reports is the band the
// record carries, whatever this file was aiming at.

import { makeRng } from '../../lib/prng.mjs';
import { solverFor } from '../../solver/index.mjs';

export const GENERATOR_VERSION = '1.0.0';
export const FAMILY = 'nonogram';

export const PARAM_KEYS = ['rows', 'cols', 'density', 'smooth', 'band_target', 'climb_steps'];

export function validateParams(params) {
  if (!params || typeof params !== 'object') throw new Error('params must be an object');
  for (const k of Object.keys(params)) {
    if (!PARAM_KEYS.includes(k)) throw new Error(`unknown param ${k}; known: ${PARAM_KEYS.join(', ')}`);
  }
  const S = solverFor(FAMILY);
  S.validateParams({ rows: params.rows, cols: params.cols });
  if (typeof params.density !== 'number' || !(params.density > 0.05) || !(params.density < 0.95)) {
    throw new Error('density must be a number strictly between 0.05 and 0.95');
  }
  if (!Number.isInteger(params.smooth) || params.smooth < 0 || params.smooth > 3) {
    throw new Error('smooth must be an integer in 0..3');
  }
  if (!Number.isInteger(params.band_target) || params.band_target < 1 || params.band_target > 5) {
    throw new Error('band_target must be an integer in 1..5');
  }
  if (!Number.isInteger(params.climb_steps) || params.climb_steps < 0 || params.climb_steps > 2000) {
    throw new Error('climb_steps must be an integer in 0..2000');
  }
  return true;
}

// A random field, then `smooth` rounds of a majority filter over each cell's
// four neighbours. Smoothing lengthens runs: it turns an even scatter of single
// cells into blocks, which is both nicer to solve and shorter to encode, and
// the encoded clue string has a 256-character ceiling to stay under.
function seedGrid(rng, rows, cols, density, smooth) {
  let g = new Int8Array(rows * cols);
  for (let i = 0; i < g.length; i++) g[i] = rng.float() < density ? 1 : 0;
  for (let round = 0; round < smooth; round++) {
    const next = new Int8Array(rows * cols);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let on = g[r * cols + c] ? 1 : 0, n = 1;
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
          on += g[rr * cols + cc] ? 1 : 0;
          n++;
        }
        // A tie falls back to the cell's own value, so smoothing is stable.
        next[r * cols + c] = on * 2 > n ? 1 : on * 2 < n ? 0 : g[r * cols + c];
      }
    }
    g = next;
  }
  return g;
}

// How far a candidate is from what the plan asked for. Lower is better; zero
// means the solver agrees.
//
// Scoring on the band alone does not work, and the measurements that say so are
// in HARDENING/nonogram.md. The band is a step function of the grid: tier 3
// either finishes a puzzle or it does not, so almost every single-cell flip
// leaves the score exactly where it was and the climb wanders at random over
// flat ground. Bands 3 and 5 were unreachable that way -- forty attempts at
// five shapes produced no band 5 at all and two band 3s.
//
// What gives the climb a gradient is how much of the grid is still undecided
// when propagation stops. To land band b, a puzzle has to stall for the tier
// below and finish at b, so the score adds two terms that can each be nudged
// one cell at a time: how far the tier below is from stalling, and how far
// tier b is from finishing. Both are counts of cells, not booleans.
const AMBIGUOUS = 1e6;

function evaluate(S, grid, params) {
  const { rows, cols, band_target: target } = params;
  let puzzle;
  try {
    puzzle = S.encodeFrom(grid, rows, cols);
  } catch {
    return { distance: AMBIGUOUS * 4, reason: 'unencodable' };
  }
  // The record schema caps both strings at 256 characters and requires at
  // least 16. A grid outside that is rejected here rather than after a solve.
  if (puzzle.length < 16 || puzzle.length > 256) {
    return { distance: AMBIGUOUS * 3, reason: `clue string is ${puzzle.length} characters` };
  }
  let v;
  try {
    v = S.classify(puzzle, params);
  } catch (e) {
    if (e.name === 'BudgetExceeded') return { distance: AMBIGUOUS * 2, reason: 'budget' };
    throw e;
  }
  // A clue set with more than one solution is not a puzzle, so it scores worse
  // than any band does. It still scores better than the three cases above,
  // because it is one flip from being a puzzle and they are not.
  if (v.verdict !== 'unique') return { distance: AMBIGUOUS, reason: v.verdict, puzzle };

  const band = v.difficulty.band;
  if (band === target) return { distance: 0, band, puzzle };

  // The tier below the target must stall, and the target tier must finish.
  // Band 5 is the exception at the top: there is no tier above 4, so all that
  // is asked of it is that tier 4 stalls, as far from finishing as possible.
  const cells = rows * cols;
  let score = 0;
  if (target > 1) {
    const below = S.residualAt(puzzle, params, target - 1);
    score += below.unknown > 0 ? 0 : cells; // it solved too early
  }
  if (target <= 4) {
    const at = S.residualAt(puzzle, params, target);
    score += at.status === 'solved' ? 0 : at.unknown;
  }
  // Never zero: only the solver's own verdict may award that, above.
  return { distance: 1 + score, band, puzzle };
}

export function generate(seed, params) {
  validateParams(params);
  const S = solverFor(FAMILY);
  const { rows, cols, density, smooth, band_target: target, climb_steps: steps } = params;
  const rng = makeRng(`${GENERATOR_VERSION}|${FAMILY}|${seed}`);

  const grid = seedGrid(rng, rows, cols, density, smooth);
  let best = evaluate(S, grid, params);

  // A plain hill climb with one flip per step. Equal-scoring moves are kept as
  // well as improving ones, which is what lets it cross the flat ground between
  // two bands: most single flips change nothing the solver can see, so a
  // strictly-improving climb stalls almost at once.
  for (let step = 0; step < steps && best.distance > 0; step++) {
    const at = rng.int(rows * cols);
    const saved = grid[at];
    grid[at] = saved ? 0 : 1;
    const got = evaluate(S, grid, params);
    if (got.distance <= best.distance) best = got;
    else grid[at] = saved;
  }

  if (best.distance > 0) {
    return { puzzle: null, reason: best.reason ?? `band ${best.band}, wanted ${target}` };
  }

  return {
    puzzle: best.puzzle,
    solution: S.encodeSolution(grid, rows, cols),
    clues: S.clues(best.puzzle),
  };
}
