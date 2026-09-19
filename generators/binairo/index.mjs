// Generator for binairo.
//
// Pure function of (GENERATOR_VERSION, seed, params). Nothing here reads the
// clock, the filesystem or Math.random, because the gate regenerates every
// record from its seed and compares byte for byte.
//
// The shape of the search is the same one the sudoku generator uses, and for
// the same reason. Dig a finished grid down to a fixpoint under uniqueness
// alone, which lands somewhere at the hard end; then, if that overshot the
// band asked for, put givens back until it is exactly right; then take away
// anything the band turned out not to need. Digging straight to a target band
// does not work, because whether a given is load-bearing depends on which
// other givens are still there.
//
// The generator's intent is not evidence. Every puzzle it emits is classified
// from scratch by the solver, and the band the solver reports is the band the
// record carries, whatever this file was aiming at.

import { makeRng } from '../../lib/prng.mjs';
import { solverFor } from '../../solver/index.mjs';

export const GENERATOR_VERSION = '1.0.0';
export const FAMILY = 'binairo';

const ZERO = 0, ONE = 1, EMPTY = -1;

export const SYMMETRIES = ['none', 'rot180', 'rot90', 'mirror_h', 'mirror_v', 'diagonal'];
export const PARAM_KEYS = ['size', 'symmetry', 'min_clues', 'band_target', 'dig_passes'];

export function validateParams(params) {
  if (!params || typeof params !== 'object') throw new Error('params must be an object');
  for (const k of Object.keys(params)) {
    if (!PARAM_KEYS.includes(k)) throw new Error(`unknown param ${k}; known: ${PARAM_KEYS.join(', ')}`);
  }
  const S = solverFor(FAMILY);
  S.validateParams({ size: params.size });
  if (!SYMMETRIES.includes(params.symmetry)) {
    throw new Error(`unknown symmetry ${params.symmetry}; known: ${SYMMETRIES.join(', ')}`);
  }
  const n = params.size * params.size;
  if (!Number.isInteger(params.min_clues) || params.min_clues < 0 || params.min_clues > n) {
    throw new Error(`min_clues must be an integer in 0..${n}`);
  }
  if (!Number.isInteger(params.band_target) || params.band_target < 1 || params.band_target > 5) {
    throw new Error('band_target must be an integer in 1..5');
  }
  if (!Number.isInteger(params.dig_passes) || params.dig_passes < 1 || params.dig_passes > 8) {
    throw new Error('dig_passes must be an integer in 1..8');
  }
  return true;
}

function paramKey(params) {
  return PARAM_KEYS.map((k) => `${k}=${params[k]}`).join(',');
}

// --- clue-pattern symmetry ---------------------------------------------------

// The cells that must be given or blank together, so the finished board has
// the symmetry the plan promised. These are symmetries of the clue pattern,
// not of the solution; a binairo solution is rarely symmetric and is not
// expected to be.
export function orbitsFor(symmetry, size) {
  const last = size - 1;
  const partner = {
    none: (r, c) => [[r, c]],
    rot180: (r, c) => [[r, c], [last - r, last - c]],
    rot90: (r, c) => [[r, c], [c, last - r], [last - r, last - c], [last - c, r]],
    mirror_h: (r, c) => [[r, c], [r, last - c]],
    mirror_v: (r, c) => [[r, c], [last - r, c]],
    diagonal: (r, c) => [[r, c], [c, r]],
  }[symmetry];
  if (!partner) throw new Error(`unknown symmetry ${symmetry}`);

  const seen = new Uint8Array(size * size);
  const orbits = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (seen[r * size + c]) continue;
      const cells = new Set();
      for (const [y, x] of partner(r, c)) cells.add(y * size + x);
      for (const i of cells) seen[i] = 1;
      orbits.push([...cells].sort((a, b) => a - b));
    }
  }
  return orbits;
}

// --- a finished board --------------------------------------------------------

const fmt = (cells) => {
  let s = '';
  for (const v of cells) s += v === EMPTY ? '.' : String(v);
  return s;
};

// Randomised backtracking straight from the rules. Written here rather than
// taken from the solver, so that a bug in one does not quietly produce
// agreement in the other.
function completeGrid(rng, size) {
  const half = size / 2;
  const g = new Int8Array(size * size).fill(EMPTY);

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
          if (a !== EMPTY && a === b && a === d) return false;
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
            if (v === EMPTY || v !== w) { same = false; break; }
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
      g[i] = EMPTY;
    }
    return false;
  };

  if (!rec(0)) throw new Error(`could not build a complete ${size}x${size} board`);
  return g;
}

// --- the generator -----------------------------------------------------------

export function generate(seed, params) {
  const S = solverFor(FAMILY);
  validateParams(params);
  const { size, symmetry, min_clues: minClues, band_target: target, dig_passes: digPasses } = params;
  const shape = { size };

  const rng = makeRng(`${FAMILY}|${GENERATOR_VERSION}|${seed}|${paramKey(params)}`);
  const full = completeGrid(rng, size);
  const solution = fmt(full);

  const cells = Int8Array.from(full);
  const orbits = orbitsFor(symmetry, size);
  let clues = cells.length;

  const str = () => fmt(cells);
  const isUnique = () => S.uniquenessOf(str(), shape).verdict === 'unique';
  // Above the target: not finishable within the target tier. For target 5 this
  // is never true, since a unique puzzle is always finishable with search.
  const tooHard = () => target <= 4 && S.deducibleWithin(str(), shape, target).band === null;
  // Below the target: already finishable within the tier beneath it.
  const tooEasy = () => target > 1 && S.deducibleWithin(str(), shape, target - 1).band !== null;
  const bandNow = () => {
    const r = S.deducibleWithin(str(), shape, 4);
    return r.band === null ? 5 : r.band;
  };

  // --- stage A: dig to a fixpoint under uniqueness alone.
  let dug = 0;
  for (let pass = 0; pass < digPasses; pass++) {
    let progress = false;
    for (const orbit of rng.shuffle(orbits.slice())) {
      const filled = orbit.filter((i) => cells[i] !== EMPTY);
      if (filled.length === 0) continue;
      if (clues - filled.length < minClues) continue;
      const saved = filled.map((i) => cells[i]);
      for (const i of filled) cells[i] = EMPTY;
      if (isUnique()) { clues -= filled.length; dug += filled.length; progress = true; }
      else filled.forEach((i, k) => { cells[i] = saved[k]; });
    }
    if (!progress) break;
  }

  if (bandNow() < target) {
    return { puzzle: null, reason: 'minimal-instance-easier-than-target', band_reached: bandNow(), clues, stages: { dug, filled: 0, polished: 0 } };
  }

  // --- stage B: fill back to the target band.
  //
  // An orbit at a time, not a cell at a time. The plan's symmetry is a
  // structural promise about the finished puzzle, and adding a single cell of
  // a rot180 pair would quietly break it -- the record would say rot180 over a
  // board that is not symmetric.
  let filledBack = 0;
  const fillOrder = rng.shuffle(orbits.slice());
  let guard = 0;
  while (tooHard()) {
    if (++guard > orbits.length + 1) {
      return { puzzle: null, reason: 'fill-back-did-not-converge', band_reached: bandNow(), clues, stages: { dug, filled: filledBack, polished: 0 } };
    }
    let added = false;
    for (const orbit of fillOrder) {
      const empty = orbit.filter((i) => cells[i] === EMPTY);
      if (empty.length === 0) continue;
      for (const i of empty) cells[i] = full[i];
      if (!tooEasy()) { added = true; clues += empty.length; filledBack += empty.length; break; }
      for (const i of empty) cells[i] = EMPTY;
    }
    if (!added) {
      return { puzzle: null, reason: 'every-addition-overshoots-the-band', band_reached: bandNow(), clues, stages: { dug, filled: filledBack, polished: 0 } };
    }
  }
  if (tooEasy()) {
    return { puzzle: null, reason: 'landed-below-target-band', band_reached: bandNow(), clues, stages: { dug, filled: filledBack, polished: 0 } };
  }

  // --- stage C: one polishing pass; drop givens the band does not need.
  let polished = 0;
  if (filledBack > 0) {
    for (const orbit of rng.shuffle(orbits.slice())) {
      const occupied = orbit.filter((i) => cells[i] !== EMPTY);
      if (occupied.length === 0) continue;
      if (clues - occupied.length < minClues) continue;
      const saved = occupied.map((i) => cells[i]);
      for (const i of occupied) cells[i] = EMPTY;
      if (isUnique() && !tooHard() && !tooEasy()) { clues -= occupied.length; polished += occupied.length; }
      else occupied.forEach((i, k) => { cells[i] = saved[k]; });
    }
  }

  return {
    puzzle: str(),
    solution,
    clues,
    band_reached: target,
    stages: { dug, filled: filledBack, polished },
  };
}
