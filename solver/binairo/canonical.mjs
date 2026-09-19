// Canonical form and hash for binairo.
//
// Two puzzles are the same puzzle if one can be turned into the other without
// changing a single deduction a solver would make. For binairo that is a group
// of sixteen: the eight symmetries of the square, each with or without
// exchanging the two symbols.
//
// Every one of those preserves all three rules. The triple rule and the
// balance rule are symmetric in the two symbols and blind to which way the
// board is turned; the distinctness rule survives a transpose because it
// applies to rows and columns alike. Nothing else does. Permuting two rows
// looks harmless and is not: it keeps every row legal while wrecking the
// columns, so it is not in the group and two puzzles related by it are
// genuinely different puzzles.
//
// The canonical form is the lexicographically smallest of the sixteen
// encodings. The hash is taken over that plus the family, its version and the
// grid size, so a 10x10 and a 12x12 can never collide.

import { sha256hex } from '../../lib/hash.mjs';

const FLIP = { '0': '1', '1': '0', '.': '.' };

// The eight symmetries of the square, as index maps into a size*size string.
function transforms(size) {
  const at = (r, c) => r * size + c;
  const last = size - 1;
  const maps = [
    (r, c) => at(r, c),                 // identity
    (r, c) => at(c, last - r),          // rotate 90
    (r, c) => at(last - r, last - c),   // rotate 180
    (r, c) => at(last - c, r),          // rotate 270
    (r, c) => at(r, last - c),          // flip horizontal
    (r, c) => at(last - r, c),          // flip vertical
    (r, c) => at(c, r),                 // transpose
    (r, c) => at(last - c, last - r),   // anti-transpose
  ];
  return maps.map((m) => {
    const idx = new Int32Array(size * size);
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) idx[at(r, c)] = m(r, c);
    return idx;
  });
}

const CACHE = new Map();
function transformsFor(size) {
  if (!CACHE.has(size)) CACHE.set(size, transforms(size));
  return CACHE.get(size);
}

export function canonicalForm(gridString, size) {
  if (typeof gridString !== 'string' || gridString.length !== size * size) {
    throw new Error(`canonical form needs a ${size * size} character grid`);
  }
  let best = null;
  for (const idx of transformsFor(size)) {
    let a = '', b = '';
    for (let i = 0; i < idx.length; i++) {
      const ch = gridString[idx[i]];
      a += ch;
      b += FLIP[ch];
    }
    if (best === null || a < best) best = a;
    if (b < best) best = b;
  }
  return best;
}

export function canonicalHash(gridString, size, familyVersion = 1) {
  return sha256hex(`binairo|${familyVersion}|${size}|${canonicalForm(gridString, size)}`);
}
