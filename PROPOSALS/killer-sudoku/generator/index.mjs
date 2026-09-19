// The killer sudoku generator.
//
// It may ask the solver for a verdict. It may not read the solver's internals,
// patch its behaviour, pass it a hint, or keep a trace from generation and
// call it the puzzle's difficulty. Difficulty comes from the solver, always,
// on a fresh solve of the finished puzzle.
//
// The shape of the search is the one that worked for sudoku-classic, and for
// the same reason: difficulty is monotone in how much the puzzle tells you.
// For classic that quantity is the number of givens. Here it is the number of
// cages -- many small cages give a great deal away, a few large ones almost
// nothing -- so the generator
//
//   A. lays out small cages, which is informative and so nearly always unique,
//   B. merges adjacent cages for as long as the puzzle stays unique, which
//      walks it to the hardest layout reachable from that start,
//   C. undoes merges, hardest-last, until the band is the one asked for.
//
// Undoing a merge is always legal: both halves were contiguous cages a moment
// earlier. That is why stage C walks the merge stack backwards instead of
// trying to split a cage it never built.

import { makeRng } from '../../lib/prng.mjs';
import * as S from '../../solver/killer-sudoku/index.mjs';

export const GENERATOR_VERSION = '1.0.0';
export const FAMILY = 'killer-sudoku';

export const PARAM_KEYS = [
  'size', 'box_h', 'box_w', 'max_cage_size', 'seed_cage_size', 'band_target', 'merge_passes',
];

export function validateParams(params) {
  if (!params || typeof params !== 'object') throw new Error('params must be an object');
  for (const k of Object.keys(params)) {
    if (!PARAM_KEYS.includes(k)) throw new Error(`unknown param ${k}; known: ${PARAM_KEYS.join(', ')}`);
  }
  S.validateShape(params);
  const { size, max_cage_size: maxCage, seed_cage_size: seedCage, band_target: band, merge_passes: passes } = params;
  if (!Number.isInteger(maxCage) || maxCage < 2 || maxCage > Math.min(size, 6)) {
    throw new Error(`max_cage_size must be an integer in 2..${Math.min(size, 6)}`);
  }
  if (!Number.isInteger(seedCage) || seedCage < 1 || seedCage > maxCage) {
    throw new Error(`seed_cage_size must be an integer in 1..max_cage_size`);
  }
  if (!Number.isInteger(band) || band < 1 || band > 5) throw new Error('band_target must be 1..5');
  if (!Number.isInteger(passes) || passes < 1 || passes > 12) throw new Error('merge_passes must be 1..12');
  return true;
}

// --- a complete grid, built without the solver ------------------------------

// Plain randomised backtracking over a permuted digit order. Deliberately its
// own code: the generator must never depend on how the solver searches.
export function completeGrid(rng, size, boxH, boxW) {
  const cells = size * size;
  const val = new Int8Array(cells);
  const nStacks = size / boxW;
  const boxOf = (i) => Math.floor(Math.floor(i / size) / boxH) * nStacks + Math.floor((i % size) / boxW);

  const legal = (i, d) => {
    const r = Math.floor(i / size);
    const c = i % size;
    const b = boxOf(i);
    for (let k = 0; k < cells; k++) {
      if (val[k] !== d) continue;
      if (Math.floor(k / size) === r || k % size === c || boxOf(k) === b) return false;
    }
    return true;
  };

  const order = [];
  for (let d = 1; d <= size; d++) order.push(d);

  const rec = (i) => {
    if (i === cells) return true;
    const digits = rng.shuffle(order.slice());
    for (const d of digits) {
      if (!legal(i, d)) continue;
      val[i] = d;
      if (rec(i + 1)) return true;
      val[i] = 0;
    }
    return false;
  };

  if (!rec(0)) throw new Error(`could not build a complete ${size}x${size} grid`);
  return val;
}

// --- cage layouts -----------------------------------------------------------

function neighbours(i, size) {
  const r = Math.floor(i / size);
  const c = i % size;
  const out = [];
  if (r > 0) out.push(i - size);
  if (r < size - 1) out.push(i + size);
  if (c > 0) out.push(i - 1);
  if (c < size - 1) out.push(i + 1);
  return out;
}

// Grow contiguous cages of at most `maxSize` cells, never repeating a digit
// inside a cage. Every cell ends up in exactly one cage.
function growCages(rng, grid, size, maxSize) {
  const cells = size * size;
  const cageOf = new Int32Array(cells).fill(-1);
  const cageCells = [];
  const order = rng.shuffle([...Array(cells).keys()]);

  for (const start of order) {
    if (cageOf[start] !== -1) continue;
    const id = cageCells.length;
    const mine = [start];
    const digits = new Set([grid[start]]);
    cageOf[start] = id;
    const want = 1 + rng.int(maxSize);
    while (mine.length < want) {
      const options = [];
      for (const i of mine) {
        for (const j of neighbours(i, size)) {
          if (cageOf[j] === -1 && !digits.has(grid[j])) options.push(j);
        }
      }
      if (!options.length) break;
      const pick = options[rng.int(options.length)];
      cageOf[pick] = id;
      digits.add(grid[pick]);
      mine.push(pick);
    }
    cageCells.push(mine);
  }
  return { cageOf, cageCells };
}

function sumsOf(cageCells, grid) {
  return cageCells.map((cs) => cs.reduce((a, i) => a + grid[i], 0));
}

// A layout the solver can be asked about.
function layoutGeometry(layout, grid, params) {
  const live = layout.cageCells.map((cs, id) => ({ id, cs })).filter((x) => x.cs !== null);
  const cageOf = new Int32Array(params.size * params.size);
  const sums = [];
  live.forEach(({ cs }, idx) => {
    for (const i of cs) cageOf[i] = idx;
    sums.push(cs.reduce((a, i) => a + grid[i], 0));
  });
  return S.geometryFromCages(params.size, params.box_h, params.box_w, cageOf, sums, sums.length);
}

function adjacentCages(layout, size) {
  const pairs = new Set();
  const { cageOf, cageCells } = layout;
  for (let id = 0; id < cageCells.length; id++) {
    const cs = cageCells[id];
    if (cs === null) continue;
    for (const i of cs) {
      for (const j of neighbours(i, size)) {
        const other = cageOf[j];
        if (other === id) continue;
        pairs.add(id < other ? `${id},${other}` : `${other},${id}`);
      }
    }
  }
  return [...pairs].sort().map((s) => s.split(',').map(Number));
}

// --- generation -------------------------------------------------------------

export function generate(seed, params) {
  validateParams(params);
  const rng = makeRng(`${FAMILY}|${GENERATOR_VERSION}|${seed}|${JSON.stringify(params)}`);
  const { size, box_h: boxH, box_w: boxW, max_cage_size: maxCage, seed_cage_size: seedCage, band_target: target, merge_passes: passes } = params;

  const grid = completeGrid(rng, size, boxH, boxW);
  const layout = growCages(rng, grid, size, seedCage);

  const stages = { seed_cages: layout.cageCells.length, merges: 0, undone: 0 };

  const uniqueNow = () => S.uniquenessOf(layoutGeometry(layout, grid, params)).verdict === 'unique';
  const bandNow = (ceiling) => S.deducibleWithin(layoutGeometry(layout, grid, params), ceiling).band;
  const tooHard = () => target <= 4 && bandNow(target) === null;
  const tooEasy = () => target > 1 && bandNow(target - 1) !== null;

  if (!uniqueNow()) return { puzzle: null, reason: 'seed-layout-not-unique', stages };

  // --- stage A: merge while the puzzle stays unique -------------------------
  const merges = [];
  const doMerge = (a, b) => {
    const A = layout.cageCells[a];
    const B = layout.cageCells[b];
    layout.cageCells[a] = [...A, ...B];
    layout.cageCells[b] = null;
    for (const i of B) layout.cageOf[i] = a;
    return { a, b, A, B };
  };
  const undoMerge = (m) => {
    layout.cageCells[m.a] = m.A;
    layout.cageCells[m.b] = m.B;
    for (const i of m.B) layout.cageOf[i] = m.b;
  };

  for (let pass = 0; pass < passes; pass++) {
    let did = false;
    const candidates = rng.shuffle(adjacentCages(layout, size).filter(([a, b]) => {
      const A = layout.cageCells[a];
      const B = layout.cageCells[b];
      if (!A || !B) return false;
      if (A.length + B.length > maxCage) return false;
      const digits = new Set(A.map((i) => grid[i]));
      for (const i of B) if (digits.has(grid[i])) return false;
      return true;
    }));
    for (const [a, b] of candidates) {
      const A = layout.cageCells[a];
      const B = layout.cageCells[b];
      if (!A || !B) continue;               // consumed earlier in this pass
      if (A.length + B.length > maxCage) continue;
      const m = doMerge(a, b);
      if (uniqueNow()) { merges.push(m); stages.merges++; did = true; }
      else undoMerge(m);
    }
    if (!did) break;
  }

  // Every layout from here on is unique; only the band is in question.
  if (!tooEasy() && !tooHard()) return finish();

  // --- stage C: undo merges until the band is the one asked for -------------
  //
  // Undoing the most recent merge first keeps the layout closest to the hard
  // end of the range, which is where the target bands live.
  for (let k = merges.length - 1; k >= 0 && tooHard(); k--) {
    const m = merges[k];
    if (layout.cageCells[m.a] === null || layout.cageCells[m.b] !== null) continue;
    undoMerge(m);
    if (tooEasy()) { doMerge(m.a, m.b); continue; }
    merges.splice(k, 1);
    stages.undone++;
  }

  if (tooHard()) return { puzzle: null, reason: 'no-split-reaches-the-target-band', stages };
  if (tooEasy()) return { puzzle: null, reason: 'every-split-overshoots-the-band', stages };
  return finish();

  function finish() {
    const g = layoutGeometry(layout, grid, params);
    if (g.nCages > S.MAX_CAGES) return { puzzle: null, reason: 'more-cages-than-the-encoding-can-name', stages };
    const check = S.checkLayout(g);
    if (!check.ok) return { puzzle: null, reason: `layout-invalid: ${check.why}`, stages };
    const puzzle = S.encode(g.cageOf, [...g.cageSum], size);
    const band = bandNow(4);
    return {
      puzzle,
      solution: S.formatGrid(grid, size),
      clues: g.nCages,
      band_reached: band === null ? 5 : band,
      stages: { ...stages, cages: g.nCages },
    };
  }
}
