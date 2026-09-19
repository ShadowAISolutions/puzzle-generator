// Exact canonical form for a killer sudoku cage layout.
//
// Two puzzles are the same puzzle if one can be turned into the other by a
// symmetry of the family. For killer sudoku that group is
//
//   * permuting the bands, and the rows inside each band,
//   * permuting the stacks, and the columns inside each stack,
//   * transposition, when the boxes are square.
//
// Rotations and reflections are all inside that group, so they need no
// separate handling.
//
// What is NOT in the group, and is in the classic family's, is relabelling the
// symbols. A cage's target is a sum of the symbols themselves, so renaming 1
// to 9 changes the puzzle. That single difference is why this file exists
// rather than reusing solver/sudoku-classic/canonical.mjs.
//
// The canonical form is the lexicographically smallest encoding over the whole
// group, and the search for it is exact: every orientation is either evaluated
// or pruned because a prefix already proved it cannot win. An approximate
// canonical form would let the same puzzle in disguise into the corpus twice,
// which is the one thing deduplication exists to stop.
//
// Rows are chosen one at a time rather than enumerated, because a first row
// that already loses prunes every completion behind it: on a 9x9 that is 143
// orientations dismissed per comparison. The encoding decides the ordering in
// two parts, layout then sums, and both are compared, which matters -- a
// layout of many small cages looks the same from every angle, and only the
// sums separate the orientations.

import { sha256hex } from '../../lib/hash.mjs';
import { decode, CAGE_IDS, sumWidth } from './geometry.mjs';

function permutations(items) {
  if (items.length <= 1) return [items.slice()];
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const rest = items.slice(0, i).concat(items.slice(i + 1));
    for (const p of permutations(rest)) out.push([items[i], ...p]);
  }
  return out;
}

// Every ordering of `size` lines that permutes groups of `groupSize`
// consecutive lines and the lines inside each group.
const lineCache = new Map();
function lineOrderings(size, groupSize) {
  const key = `${size}:${groupSize}`;
  const hit = lineCache.get(key);
  if (hit) return hit;
  const nGroups = size / groupSize;
  const groups = [];
  for (let gi = 0; gi < nGroups; gi++) {
    const lines = [];
    for (let k = 0; k < groupSize; k++) lines.push(gi * groupSize + k);
    groups.push(lines);
  }
  const groupPerms = permutations([...Array(nGroups).keys()]);
  const withinPerms = permutations([...Array(groupSize).keys()]);
  const out = [];
  for (const gp of groupPerms) {
    const build = (gi, acc) => {
      if (gi === nGroups) { out.push(Int32Array.from(acc)); return; }
      const lines = groups[gp[gi]];
      for (const w of withinPerms) build(gi + 1, [...acc, ...w.map((k) => lines[k])]);
    };
    build(0, []);
  }
  lineCache.set(key, out);
  return out;
}

function transposeCages(cageOf, size) {
  const out = new Int32Array(size * size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) out[c * size + r] = cageOf[r * size + c];
  }
  return out;
}

// Label indices are compared as numbers rather than as characters. That is the
// same ordering, because CAGE_IDS is in ascending character order, and it
// avoids building a string for an orientation that is about to be discarded.
export function canonicalForm(puzzleString, size, boxH, boxW) {
  const { cageOf, sums, nCages } = decode(puzzleString, size);
  const cells = size * size;
  const nBands = size / boxH;

  const colOrders = lineOrderings(size, boxW);
  const orientations = boxH === boxW ? [cageOf, transposeCages(cageOf, size)] : [cageOf];

  let bestLabels = null;   // Uint8Array(cells)
  let bestSums = null;     // Int32Array(nCages), in label order

  const labelOf = new Int32Array(nCages);
  const origOf = new Int32Array(nCages);
  const labels = new Uint8Array(cells);
  const rowUsed = new Uint8Array(size);
  const bandUsed = new Uint8Array(nBands);

  const currentBand = new Int32Array(nBands).fill(-1);
  let next = 0;

  // How the prefix written so far compares with the best found so far:
  // -1 smaller, 0 equal, 1 larger. Recomputed from position zero every time
  // rather than carried down the recursion, because the best it is measured
  // against changes during the search: a leaf deeper in the tree can replace
  // it, and a comparison inherited from the previous best is then a statement
  // about a string that is no longer the one to beat. Carrying it was wrong in
  // exactly that case, and the brute-force reference in the hardening suite is
  // what caught it.
  const comparePrefix = (len) => {
    if (bestLabels === null) return -1;
    for (let i = 0; i < len; i++) {
      if (labels[i] < bestLabels[i]) return -1;
      if (labels[i] > bestLabels[i]) return 1;
    }
    return 0;
  };

  const takeIfBetter = () => {
    if (bestLabels !== null) {
      const c = comparePrefix(cells);
      if (c > 0) return;
      if (c === 0) {
        // The layout ties, so the sums decide.
        let smaller = false;
        for (let lab = 0; lab < next; lab++) {
          const mine = sums[origOf[lab]];
          const other = bestSums[lab];
          if (mine > other) return;
          if (mine < other) { smaller = true; break; }
        }
        if (!smaller) return;              // identical to the best
      }
    }
    bestLabels = Uint8Array.from(labels);
    bestSums = Int32Array.from({ length: next }, (_, lab) => sums[origOf[lab]]);
  };

  for (const cg of orientations) {
    for (const co of colOrders) {
      labelOf.fill(-1);
      rowUsed.fill(0);
      bandUsed.fill(0);
      currentBand.fill(-1);
      next = 0;

      const place = (p) => {
        if (p === size) { takeIfBetter(); return; }
        const bandIndex = Math.floor(p / boxH);
        const posInBand = p % boxH;
        const bands = [];
        if (posInBand === 0) { for (let b = 0; b < nBands; b++) if (!bandUsed[b]) bands.push(b); }
        else bands.push(currentBand[bandIndex]);

        for (const band of bands) {
          for (let k = 0; k < boxH; k++) {
            const r = band * boxH + k;
            if (rowUsed[r]) continue;
            const savedNext = next;
            const base = r * size;
            for (let c = 0; c < size; c++) {
              const cage = cg[base + co[c]];
              let lab = labelOf[cage];
              if (lab === -1) { lab = next; labelOf[cage] = next; origOf[next] = cage; next++; }
              labels[p * size + c] = lab;
            }
            // A prefix already larger than the best cannot become smaller, so
            // every completion behind it is dismissed here. On a 9x9 that is
            // up to 143 orientations per comparison.
            if (comparePrefix((p + 1) * size) <= 0) {
              rowUsed[r] = 1;
              bandUsed[band] = 1;
              currentBand[bandIndex] = band;
              place(p + 1);
              rowUsed[r] = 0;
              if (posInBand === 0) bandUsed[band] = 0;
            }
            for (let lab = savedNext; lab < next; lab++) labelOf[origOf[lab]] = -1;
            next = savedNext;
          }
        }
      };

      place(0);
    }
  }

  if (bestLabels === null) throw new Error('no orientation produced a canonical form');
  const w = sumWidth(size);
  let layout = '';
  for (let i = 0; i < cells; i++) layout += CAGE_IDS[bestLabels[i]];
  let sumsStr = '';
  for (let k = 0; k < bestSums.length; k++) sumsStr += String(bestSums[k]).padStart(w, '0');
  return `${layout}|${sumsStr}`;
}

export function canonicalHash(puzzleString, size, boxH, boxW, familyVersion) {
  const form = canonicalForm(puzzleString, size, boxH, boxW);
  const shape = [boxH, boxW].slice().sort((a, b) => a - b).join('x');
  return sha256hex(`killer-sudoku|${familyVersion}|${size}|${shape}|${form}`);
}
