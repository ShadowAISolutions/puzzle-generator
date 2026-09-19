// Canonical form and hash for nonograms.
//
// Two puzzles are the same puzzle if one can be turned into the other without
// changing a single deduction a solver would make. For a nonogram that is a
// group of eight: the four symmetries of the rectangle -- identity, mirror
// left-right, mirror top-bottom, half turn -- each with or without transposing.
//
// Transposing is in the group and is the interesting member of it. A nonogram's
// two clue lists play exactly the same role, so swapping them gives a puzzle
// whose solver does the identical work in the identical order with the axes
// relabelled. On a non-square grid the transpose has the transposed shape,
// which is fine: the encoding names its own shape through the number of clue
// groups on each side, so a 10x15 and its 15x10 transpose reduce to one form
// and one hash, as they should.
//
// Exchanging filled for empty is deliberately NOT in the group, and this is
// where a nonogram differs from a binairo. The clues count runs of filled cells
// and say nothing whatever about the empty ones, so the two states are not
// interchangeable and the inverted grid is a different puzzle with different
// clues.
//
// Working on the clue string rather than the solution grid is on purpose. The
// clues are what the puzzle *is*; the solution is a consequence of them. Two
// records with the same clues are the same puzzle whatever else differs.

import { sha256hex } from '../../lib/hash.mjs';
import { decodePuzzle, encodePuzzle } from './encode.mjs';

const rev = (a) => a.slice().reverse();
const revEach = (lines) => lines.map(rev);

// Mirror left-right: every row's runs come in the other order, and the columns
// themselves swap places while each keeps its own runs.
function flipH({ rowRuns, colRuns }) {
  return { rowRuns: revEach(rowRuns), colRuns: rev(colRuns) };
}

// Mirror top-bottom: the mirror image of the above.
function flipV({ rowRuns, colRuns }) {
  return { rowRuns: rev(rowRuns), colRuns: revEach(colRuns) };
}

// Transpose: the two clue lists change places and nothing else happens.
function transpose({ rowRuns, colRuns }) {
  return { rowRuns: colRuns, colRuns: rowRuns };
}

export function variants(clues) {
  const base = [
    clues,
    flipH(clues),
    flipV(clues),
    flipH(flipV(clues)),
  ];
  return [...base, ...base.map(transpose)];
}

// The lexicographically smallest of the eight encodings.
export function canonicalForm(puzzleString) {
  const clues = decodePuzzle(puzzleString);
  let best = null;
  for (const v of variants(clues)) {
    const s = encodePuzzle(v.rowRuns, v.colRuns);
    if (best === null || s < best) best = s;
  }
  return best;
}

export function canonicalHash(puzzleString, familyVersion = 1) {
  return sha256hex(`nonogram|${familyVersion}|${canonicalForm(puzzleString)}`);
}
