// Grid and cage geometry for a killer sudoku.
//
// A killer sudoku is a boxed sudoku with no given digits at all. Instead the
// grid is partitioned into *cages*: each cage carries a target sum, and the
// digits inside a cage must be distinct. The cages are the whole of the given
// information, which is why a record's `clues` field counts cages.
//
// The row, column and box geometry is the classic one, imported rather than
// re-derived: solver/sudoku-classic/geometry.mjs is frozen, hardened, and
// describes exactly the same grid. What this module adds is the cage layer.
//
// One deliberate consequence of the cage layer: cage-mates are added to the
// peer relation. Two cells in one cage cannot hold the same digit, so treating
// them as peers is sound, and it means the frozen assign() propagates cage
// distinctness with no change to a frozen file. Cages are NOT added to
// `units`, because a unit is a set of `size` cells that must hold every digit
// exactly once and a cage of three cells holds three digits.

import {
  geometry as classicGeometry, ALPHABET, SHAPES, shapeKey, isSupportedShape,
  bitCount, lowestBitIndex, bitsToDigits, parseGrid, formatGrid, clueCount,
} from '../sudoku-classic/geometry.mjs';

export { ALPHABET, SHAPES, shapeKey, isSupportedShape, bitCount, lowestBitIndex, bitsToDigits, parseGrid, formatGrid, clueCount };

// Cage ids in the encoding, in order of first appearance scanning row-major.
// 62 ids is the ceiling on how many cages a puzzle may have. A 9x9 with every
// cage a single cell would need 81, but that puzzle is a fully given sudoku
// with arithmetic decoration, not a killer sudoku; the generator never goes
// near the ceiling and encode() refuses to if asked.
export const CAGE_IDS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const MAX_CAGES = CAGE_IDS.length;

// The largest sum any cage can carry on this grid: every digit once.
export function maxPossibleSum(size) {
  return (size * (size + 1)) / 2;
}

// Sums are written as fixed-width zero-padded decimals so the encoding needs
// no separator between them and stays comparable character by character.
export function sumWidth(size) {
  return String(maxPossibleSum(size)).length;
}

// --- encoding ---------------------------------------------------------------
//
// "<layout>|<sums>" where <layout> is size*size cage ids read left to right,
// top to bottom, and <sums> is each cage's target in the same order, each one
// zero-padded to sumWidth(size) characters.

export function encode(cageOf, sums, size) {
  const cells = size * size;
  if (cageOf.length !== cells) throw new Error(`layout length ${cageOf.length}, expected ${cells}`);
  const order = new Map();
  let layout = '';
  for (let i = 0; i < cells; i++) {
    const c = cageOf[i];
    if (!Number.isInteger(c) || c < 0) throw new Error(`bad cage index ${c} at cell ${i}`);
    if (!order.has(c)) {
      if (order.size >= MAX_CAGES) throw new Error(`more than ${MAX_CAGES} cages`);
      order.set(c, order.size);
    }
    layout += CAGE_IDS[order.get(c)];
  }
  if (order.size !== sums.length) throw new Error(`layout has ${order.size} cages, ${sums.length} sums given`);
  const w = sumWidth(size);
  const max = maxPossibleSum(size);
  let out = '';
  // Sums are re-ordered to match first-appearance order, so the caller's cage
  // numbering does not leak into the encoding.
  const bySlot = new Array(order.size);
  for (const [orig, slot] of order) bySlot[slot] = sums[orig];
  for (const s of bySlot) {
    if (!Number.isInteger(s) || s < 1 || s > max) throw new Error(`cage sum ${s} outside 1..${max}`);
    out += String(s).padStart(w, '0');
  }
  return `${layout}|${out}`;
}

export function decode(str, size) {
  if (typeof str !== 'string') throw new Error('puzzle must be a string');
  const cells = size * size;
  const bar = str.indexOf('|');
  if (bar !== cells) throw new Error(`expected '|' at index ${cells}, found ${bar === -1 ? 'none' : bar}`);
  const layout = str.slice(0, cells);
  const sumsPart = str.slice(cells + 1);

  const cageOf = new Int32Array(cells);
  let nCages = 0;
  const seen = new Map();
  for (let i = 0; i < cells; i++) {
    const ch = layout[i];
    const id = CAGE_IDS.indexOf(ch);
    if (id < 0) throw new Error(`bad cage character ${JSON.stringify(ch)} at ${i}`);
    if (!seen.has(id)) {
      // Ids must appear in order, so one layout has exactly one encoding.
      if (id !== nCages) throw new Error(`cage ids out of first-appearance order at ${i}: saw ${ch}, expected ${CAGE_IDS[nCages]}`);
      seen.set(id, nCages++);
    }
    cageOf[i] = id;
  }

  const w = sumWidth(size);
  if (sumsPart.length !== nCages * w) throw new Error(`sums length ${sumsPart.length}, expected ${nCages * w} for ${nCages} cages`);
  const max = maxPossibleSum(size);
  const sums = new Int32Array(nCages);
  for (let c = 0; c < nCages; c++) {
    const field = sumsPart.slice(c * w, (c + 1) * w);
    if (!/^[0-9]+$/.test(field)) throw new Error(`bad sum field ${JSON.stringify(field)} for cage ${c}`);
    const v = Number(field);
    if (v < 1 || v > max) throw new Error(`cage sum ${v} outside 1..${max}`);
    sums[c] = v;
  }
  return { cageOf, sums, nCages, layout };
}

// --- cage-aware geometry ----------------------------------------------------

const cache = new Map();

export function geometry(size, boxH, boxW, puzzleString) {
  const key = `${shapeKey(size, boxH, boxW)}|${puzzleString}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { cageOf, sums, nCages } = decode(puzzleString, size);
  const g = geometryFromCages(size, boxH, boxW, cageOf, sums, nCages, puzzleString, key);
  cache.set(key, g);
  return g;
}

// The same geometry built straight from a cage assignment, with no encoding in
// between. A generator works with layouts that have more cages than the
// encoding can name, merging them down before any record is written, so it
// needs a way in that does not go through a puzzle string.
export function geometryFromCages(size, boxH, boxW, cageOf, sums, nCages = sums.length, puzzleString = null, key = null) {
  const base = classicGeometry(size, boxH, boxW);
  const cells = base.cells;

  const cageCells = [];
  for (let c = 0; c < nCages; c++) cageCells.push([]);
  for (let i = 0; i < cells; i++) cageCells[cageOf[i]].push(i);
  for (let c = 0; c < nCages; c++) {
    if (cageCells[c].length === 0) throw new Error(`cage ${c} is empty`);
    if (cageCells[c].length > size) throw new Error(`cage ${c} has ${cageCells[c].length} cells, more than ${size} distinct digits`);
  }

  // Extend the peer relation with cage-mates. Sound because a cage holds
  // distinct digits; see the note at the top of this file.
  const peers = [];
  for (let i = 0; i < cells; i++) {
    const set = new Set(base.peers[i]);
    for (const j of cageCells[cageOf[i]]) if (j !== i) set.add(j);
    peers.push(Int32Array.from([...set].sort((a, b) => a - b)));
  }

  // Cage-mates that are not already row/col/box peers. Only used for
  // reporting; the solver works through `peers`.
  const cageOnlyMates = [];
  for (let i = 0; i < cells; i++) {
    const rcb = new Set(base.peers[i]);
    cageOnlyMates.push(Int32Array.from(cageCells[cageOf[i]].filter((j) => j !== i && !rcb.has(j))));
  }

  return {
    ...base,
    peers,
    cageOf,
    cageSum: sums,
    cageCells: cageCells.map((a) => Int32Array.from(a)),
    nCages,
    cageOnlyMates,
    puzzle: puzzleString,
    key: key ?? `${shapeKey(size, boxH, boxW)}|cages:${nCages}`,
  };
}

// --- validity of a layout, independent of any solution ----------------------

// A layout is well formed if it partitions the grid, every cage is contiguous
// (killer cages are drawn as connected regions), no cage exceeds `size` cells,
// and every cage sum is reachable by some set of distinct digits of that size.
export function checkLayout(g) {
  const { size, cells, cageCells, cageSum, nCages } = g;
  for (let c = 0; c < nCages; c++) {
    const n = cageCells[c].length;
    const lo = (n * (n + 1)) / 2;                       // 1+2+...+n
    const hi = (n * (2 * size - n + 1)) / 2;            // size + (size-1) + ...
    if (cageSum[c] < lo || cageSum[c] > hi) {
      return { ok: false, why: `cage ${c} of ${n} cells cannot sum to ${cageSum[c]} (range ${lo}..${hi})` };
    }
    if (!isContiguous(cageCells[c], size)) return { ok: false, why: `cage ${c} is not a connected region` };
  }
  let total = 0;
  for (let c = 0; c < nCages; c++) total += cageSum[c];
  const want = size * maxPossibleSum(size);
  if (total !== want) return { ok: false, why: `cage sums total ${total}, but a full grid totals ${want}` };
  if (cells !== cageCells.reduce((a, b) => a + b.length, 0)) return { ok: false, why: 'cages do not partition the grid' };
  return { ok: true };
}

export function isContiguous(cellList, size) {
  if (cellList.length <= 1) return true;
  const inCage = new Set(cellList);
  const seen = new Set([cellList[0]]);
  const stack = [cellList[0]];
  while (stack.length) {
    const i = stack.pop();
    const r = Math.floor(i / size);
    const c = i % size;
    const around = [];
    if (r > 0) around.push(i - size);
    if (r < size - 1) around.push(i + size);
    if (c > 0) around.push(i - 1);
    if (c < size - 1) around.push(i + 1);
    for (const j of around) {
      if (inCage.has(j) && !seen.has(j)) { seen.add(j); stack.push(j); }
    }
  }
  return seen.size === cellList.length;
}

// Which cell of a cage carries its printed sum: the top-left, as every killer
// sudoku in print does it. The player reads this, and so does the renderer.
export function cageAnchor(cellList) {
  let best = cellList[0];
  for (const i of cellList) if (i < best) best = i;
  return best;
}
