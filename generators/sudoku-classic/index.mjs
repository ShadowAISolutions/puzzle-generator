// Generator for sudoku-classic.
//
// Pure function of (GENERATOR_VERSION, seed, params). Nothing here reads the
// clock or an unseeded random source, so the same inputs rebuild the same
// puzzle byte for byte on any machine. tools/gate.mjs checks that on every
// puzzle.
//
// The generator calls the solver through its public verdict functions, which
// is how it searches for a unique instance. It never reads solver internals,
// patches its behaviour, passes it hints, or keeps a trace from one call to
// use in the next. The band on the finished record comes from a fresh solve
// the gate performs itself.
//
// Method. Difficulty is monotone in the givens: adding a clue can never make
// a puzzle harder, and removing one can never make it easier, because the
// techniques are pure elimination rules over candidate sets. That single fact
// is what makes an exact band reachable.
//
//   Stage A  dig orbits out, to a fixpoint, under uniqueness alone. What is
//            left is a minimal unique puzzle, and it is the hardest instance
//            this solution grid and dig order can produce. Call its band B.
//   Stage B  if B is above the target, fill clues back in from the solution,
//            one at a time, keeping only additions that leave the band at or
//            above the target. Monotonicity means each kept addition weakly
//            lowers the band, so this walks down to the target rather than
//            past it. The first state that is neither too hard nor too easy
//            is the target band, exactly.
//   Stage C  one polishing pass, removing any orbit whose removal leaves the
//            band unchanged, so the shipped puzzle is minimal within its band
//            rather than carrying clues it does not need.
//
// If B is already below the target this solution grid cannot reach it, and
// generate() reports the miss so the driver can try another seed. Digging
// under a tier ceiling was tried first and does not work: by the time a grid
// is minimal for tier 1 it is close to minimal for uniqueness too, so there
// is no room left to push the band up.
//
// The band the record carries is never the one computed here. The gate reads
// it off a fresh solve of the finished puzzle.

import { makeRng } from '../../lib/prng.mjs';
import { solverFor } from '../../solver/index.mjs';

export const GENERATOR_VERSION = '1.0.0';
export const FAMILY = 'sudoku-classic';

const ALPHABET = '123456789ABCDEFG';

function paramKey(params) {
  return Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join(',');
}

// --- a complete valid grid, built without the solver ------------------------

function boxIndex(r, c, boxH, boxW, nStacks) {
  return Math.floor(r / boxH) * nStacks + Math.floor(c / boxW);
}

function completeGrid(rng, size, boxH, boxW) {
  const nStacks = size / boxW;
  const cells = new Int8Array(size * size);
  const rowMask = new Int32Array(size);
  const colMask = new Int32Array(size);
  const boxMask = new Int32Array(size);
  const order = [];
  for (let d = 1; d <= size; d++) order.push(d);

  const rec = (at) => {
    if (at === cells.length) return true;
    const r = Math.floor(at / size), c = at % size;
    const b = boxIndex(r, c, boxH, boxW, nStacks);
    const digits = rng.shuffle(order.slice());
    for (const d of digits) {
      const bit = 1 << (d - 1);
      if ((rowMask[r] | colMask[c] | boxMask[b]) & bit) continue;
      cells[at] = d;
      rowMask[r] |= bit; colMask[c] |= bit; boxMask[b] |= bit;
      if (rec(at + 1)) return true;
      cells[at] = 0;
      rowMask[r] &= ~bit; colMask[c] &= ~bit; boxMask[b] &= ~bit;
    }
    return false;
  };

  if (!rec(0)) throw new Error('could not build a complete grid');
  return cells;
}

// --- symmetry orbits --------------------------------------------------------

export function orbitsFor(symmetry, size) {
  const seen = new Uint8Array(size * size);
  const orbits = [];
  const image = (r, c) => {
    switch (symmetry) {
      case 'none': return [[r, c]];
      case 'rot180': return [[r, c], [size - 1 - r, size - 1 - c]];
      case 'rot90': return [[r, c], [c, size - 1 - r], [size - 1 - r, size - 1 - c], [size - 1 - c, r]];
      case 'mirror_h': return [[r, c], [r, size - 1 - c]];
      case 'mirror_v': return [[r, c], [size - 1 - r, c]];
      case 'diagonal': return [[r, c], [c, r]];
      default: throw new Error(`unknown symmetry ${symmetry}`);
    }
  };
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const i = r * size + c;
      if (seen[i]) continue;
      const set = new Set();
      for (const [rr, cc] of image(r, c)) set.add(rr * size + cc);
      const orbit = [...set].sort((a, b) => a - b);
      for (const j of orbit) seen[j] = 1;
      orbits.push(orbit);
    }
  }
  return orbits;
}

function format(cells, size) {
  const alpha = ALPHABET.slice(0, size);
  let s = '';
  for (let i = 0; i < cells.length; i++) s += cells[i] === 0 ? '.' : alpha[cells[i] - 1];
  return s;
}

// --- generation -------------------------------------------------------------

// Returns { puzzle, solution, clues, removals_attempted, removals_accepted }.
// `puzzle` is the instance; its band is NOT decided here.
export const SYMMETRIES = ['none', 'rot180', 'rot90', 'mirror_h', 'mirror_v', 'diagonal'];

export const PARAM_KEYS = ['size', 'box_h', 'box_w', 'symmetry', 'min_clues', 'band_target', 'dig_passes'];

export function validateParams(params) {
  const S = solverFor(FAMILY);
  S.validateShape(params);
  const { size, box_h: boxH, box_w: boxW } = params;
  if (!SYMMETRIES.includes(params.symmetry)) throw new Error(`unknown symmetry ${params.symmetry}`);
  if ((params.symmetry === 'rot90' || params.symmetry === 'diagonal') && boxH !== boxW) {
    throw new Error(`${params.symmetry} needs a square box shape`);
  }
  if (!Number.isInteger(params.min_clues) || params.min_clues < 0 || params.min_clues > size * size) {
    throw new Error(`min_clues out of range: ${params.min_clues}`);
  }
  if (!Number.isInteger(params.band_target) || params.band_target < 1 || params.band_target > 5) {
    throw new Error(`band_target out of range: ${params.band_target}`);
  }
  if (!Number.isInteger(params.dig_passes) || params.dig_passes < 1 || params.dig_passes > 8) {
    throw new Error(`dig_passes out of range: ${params.dig_passes}`);
  }
  const extra = Object.keys(params).filter((k) => !PARAM_KEYS.includes(k));
  if (extra.length) throw new Error(`unknown params: ${extra.join(', ')}`);
  return true;
}

// Returns { puzzle, solution, clues, band_reached, stages } on success, or
// { puzzle: null, reason, band_reached } when this seed cannot reach the
// target band. The band recorded here is the generator's own reading and is
// not evidence of anything; the gate recomputes it.
export function generate(seed, params) {
  const S = solverFor(FAMILY);
  validateParams(params);
  const { size, symmetry, min_clues: minClues, band_target: target, dig_passes: digPasses } = params;

  const rng = makeRng(`${FAMILY}|${GENERATOR_VERSION}|${seed}|${paramKey(params)}`);
  const full = completeGrid(rng, size, params.box_h, params.box_w);
  const solution = format(full, size);

  const cells = Int8Array.from(full);
  const orbits = orbitsFor(symmetry, size);
  let clues = cells.length;

  const str = () => format(cells, size);
  const isUnique = () => S.uniquenessOf(str(), params).verdict === 'unique';
  // Above the target: not finishable within the target tier. For target 5 this
  // is never true, since a unique puzzle is always finishable with search.
  const tooHard = () => target <= 4 && S.deducibleWithin(str(), params, target).band === null;
  // Below the target: already finishable within the tier beneath it.
  const tooEasy = () => target > 1 && S.deducibleWithin(str(), params, target - 1).band !== null;

  // --- stage A: dig to a fixpoint under uniqueness alone.
  let dug = 0;
  for (let pass = 0; pass < digPasses; pass++) {
    const order = rng.shuffle(orbits.slice());
    let progress = false;
    for (const orbit of order) {
      const filled = orbit.filter((i) => cells[i] !== 0);
      if (filled.length === 0) continue;
      if (clues - filled.length < minClues) continue;
      const saved = filled.map((i) => cells[i]);
      for (const i of filled) cells[i] = 0;
      if (isUnique()) { clues -= filled.length; dug += filled.length; progress = true; }
      else filled.forEach((i, k) => { cells[i] = saved[k]; });
    }
    if (!progress) break;
  }

  const bandNow = () => {
    const r = S.deducibleWithin(str(), params, 4);
    return r.band === null ? 5 : r.band;
  };

  if (bandNow() < target) {
    return { puzzle: null, reason: 'minimal-instance-easier-than-target', band_reached: bandNow(), clues, stages: { dug, filled: 0, polished: 0 } };
  }

  // --- stage B: fill back to the target band.
  //
  // Filled back an orbit at a time, not a cell at a time. The plan's symmetry
  // is a structural promise about the finished puzzle, and adding a single
  // cell of a rot180 pair would quietly break it -- the record would say
  // rot180 over a board that is not symmetric.
  let filledBack = 0;
  const fillOrder = rng.shuffle(orbits.slice());
  let guard = 0;
  while (tooHard()) {
    if (++guard > orbits.length + 1) {
      return { puzzle: null, reason: 'fill-back-did-not-converge', band_reached: bandNow(), clues, stages: { dug, filled: filledBack, polished: 0 } };
    }
    let added = false;
    for (const orbit of fillOrder) {
      const empty = orbit.filter((i) => cells[i] === 0);
      if (empty.length === 0) continue;
      for (const i of empty) cells[i] = full[i];
      if (!tooEasy()) { added = true; clues += empty.length; filledBack += empty.length; break; }
      for (const i of empty) cells[i] = 0;
    }
    if (!added) {
      return { puzzle: null, reason: 'every-addition-overshoots-the-band', band_reached: bandNow(), clues, stages: { dug, filled: filledBack, polished: 0 } };
    }
  }
  if (tooEasy()) {
    return { puzzle: null, reason: 'landed-below-target-band', band_reached: bandNow(), clues, stages: { dug, filled: filledBack, polished: 0 } };
  }

  // --- stage C: one polishing pass; drop clues the band does not need.
  let polished = 0;
  if (filledBack > 0) {
    for (const orbit of rng.shuffle(orbits.slice())) {
      const occupied = orbit.filter((i) => cells[i] !== 0);
      if (occupied.length === 0) continue;
      if (clues - occupied.length < minClues) continue;
      const saved = occupied.map((i) => cells[i]);
      for (const i of occupied) cells[i] = 0;
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
