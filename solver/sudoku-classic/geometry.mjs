// Grid geometry for a boxed sudoku.
//
// A box is `boxH` rows tall and `boxW` columns wide, and size = boxH * boxW.
// That gives boxW horizontal bands (each boxH rows) and boxH vertical stacks
// (each boxW columns).
//
// Supported shapes are limited to those whose full symmetry group is small
// enough to enumerate exactly during canonicalisation. See
// solver/sudoku-classic/canonical.mjs and the Decisions section of STATE.md.

export const ALPHABET = '123456789ABCDEFG';

export const SHAPES = [
  { size: 4, boxH: 2, boxW: 2 },
  { size: 6, boxH: 2, boxW: 3 },
  { size: 6, boxH: 3, boxW: 2 },
  { size: 8, boxH: 2, boxW: 4 },
  { size: 8, boxH: 4, boxW: 2 },
  { size: 9, boxH: 3, boxW: 3 },
];

export function shapeKey(size, boxH, boxW) {
  return `${size}:${boxH}x${boxW}`;
}

export function isSupportedShape(size, boxH, boxW) {
  return SHAPES.some((s) => s.size === size && s.boxH === boxH && s.boxW === boxW);
}

const geomCache = new Map();

export function geometry(size, boxH, boxW) {
  const key = shapeKey(size, boxH, boxW);
  const hit = geomCache.get(key);
  if (hit) return hit;
  if (!Number.isInteger(size) || size < 4 || size > 16) throw new Error(`bad size ${size}`);
  if (boxH * boxW !== size) throw new Error(`box ${boxH}x${boxW} does not tile size ${size}`);

  const N = size;
  const cells = N * N;
  const nBands = N / boxH;   // === boxW
  const nStacks = N / boxW;  // === boxH

  const boxOf = new Int32Array(cells);
  const rowOf = new Int32Array(cells);
  const colOf = new Int32Array(cells);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      rowOf[i] = r;
      colOf[i] = c;
      boxOf[i] = Math.floor(r / boxH) * nStacks + Math.floor(c / boxW);
    }
  }

  // Units: N rows, then N columns, then N boxes.
  const units = [];
  for (let r = 0; r < N; r++) {
    const u = new Int32Array(N);
    for (let c = 0; c < N; c++) u[c] = r * N + c;
    units.push(u);
  }
  for (let c = 0; c < N; c++) {
    const u = new Int32Array(N);
    for (let r = 0; r < N; r++) u[r] = r * N + c;
    units.push(u);
  }
  for (let b = 0; b < N; b++) {
    const u = new Int32Array(N);
    let k = 0;
    const bandStart = Math.floor(b / nStacks) * boxH;
    const stackStart = (b % nStacks) * boxW;
    for (let dr = 0; dr < boxH; dr++) {
      for (let dc = 0; dc < boxW; dc++) u[k++] = (bandStart + dr) * N + stackStart + dc;
    }
    units.push(u);
  }

  // unitsOf[i] = [rowUnit, colUnit, boxUnit] indexes into units
  const unitsOf = [];
  for (let i = 0; i < cells; i++) unitsOf.push([rowOf[i], N + colOf[i], 2 * N + boxOf[i]]);

  // peers[i] = every other cell sharing a unit with i
  const peers = [];
  for (let i = 0; i < cells; i++) {
    const set = new Set();
    for (const ui of unitsOf[i]) for (const j of units[ui]) if (j !== i) set.add(j);
    peers.push(Int32Array.from([...set].sort((a, b) => a - b)));
  }

  const ALL = (1 << N) - 1;
  const g = { size: N, boxH, boxW, cells, nBands, nStacks, boxOf, rowOf, colOf, units, unitsOf, peers, ALL, key };
  geomCache.set(key, g);
  return g;
}

export function bitCount(x) {
  let n = 0;
  while (x) { x &= x - 1; n++; }
  return n;
}

export function lowestBitIndex(x) {
  return 31 - Math.clz32(x & -x);
}

export function bitsToDigits(x) {
  const out = [];
  for (let d = 0; x; d++, x >>= 1) if (x & 1) out.push(d + 1);
  return out;
}

// "53..7...." -> Int8Array, 0 meaning empty. Throws on anything malformed.
export function parseGrid(str, size) {
  if (typeof str !== 'string') throw new Error('grid must be a string');
  if (str.length !== size * size) throw new Error(`grid length ${str.length}, expected ${size * size}`);
  const alpha = ALPHABET.slice(0, size);
  const out = new Int8Array(size * size);
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '.') { out[i] = 0; continue; }
    const d = alpha.indexOf(ch);
    if (d < 0) throw new Error(`bad character ${JSON.stringify(ch)} at ${i}`);
    out[i] = d + 1;
  }
  return out;
}

export function formatGrid(arr, size) {
  const alpha = ALPHABET.slice(0, size);
  let s = '';
  for (let i = 0; i < size * size; i++) s += arr[i] === 0 ? '.' : alpha[arr[i] - 1];
  return s;
}

export function clueCount(arr) {
  let n = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] !== 0) n++;
  return n;
}
