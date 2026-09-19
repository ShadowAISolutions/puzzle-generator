// Candidate-grid state for killer sudoku.
//
// The candidate machinery is the frozen classic one, unchanged: a killer grid
// is a sudoku grid, and the cage constraint reaches it through the peer
// relation that solver/killer-sudoku/geometry.mjs extends. What this module
// adds is the completeness check, because a filled killer grid has to satisfy
// the cage sums as well as the rows, columns and boxes.

import {
  CONTRADICTION, makeState, cloneState, assign, eliminate, restrict,
  isSolved, gridOf, verifyComplete as verifyClassic,
} from '../sudoku-classic/state.mjs';

export { CONTRADICTION, makeState, cloneState, assign, eliminate, restrict, isSolved, gridOf };

// An empty board: killer sudoku has no given digits, only cages.
export function emptyGrid(g) {
  return new Int8Array(g.cells);
}

// Belt and braces. A state built through assign() on a killer geometry cannot
// violate the row, column, box or cage-distinctness constraints, but nothing
// in the candidate machinery knows about sums, so this is the only place the
// arithmetic is checked against a finished grid.
export function verifyComplete(st) {
  if (!verifyClassic(st)) return false;
  return cageSumsSatisfied(st.g, st.val);
}

export function cageSumsSatisfied(g, val) {
  for (let c = 0; c < g.nCages; c++) {
    const cells = g.cageCells[c];
    let total = 0;
    const seen = new Set();
    for (let k = 0; k < cells.length; k++) {
      const d = val[cells[k]];
      if (d === 0) return false;
      if (seen.has(d)) return false;
      seen.add(d);
      total += d;
    }
    if (total !== g.cageSum[c]) return false;
  }
  return true;
}
