// Reference brute force for sudoku-classic.
//
// This is deliberately the dumbest correct thing. It has no candidate sets, no
// propagation, no minimum-remaining-values heuristic and no bitmasks. It fills
// the first empty cell in reading order, tries digits in ascending order, and
// checks legality by scanning the row, the column and the box directly.
//
// It exists only to be right. It shares no code with solver/sudoku-classic/ --
// not the geometry, not the encoding, nothing -- because a bug the two solvers
// share is a bug the differential test cannot see.
//
// When the two disagree, the solver is wrong until proven otherwise in
// writing, in HARDENING/<family>.md. Never adjust this file to agree with the
// solver.

import { Budget } from '../../lib/budget.mjs';

const DIGITS = '123456789ABCDEFG';

function decode(str, size) {
  if (typeof str !== 'string') throw new Error('grid must be a string');
  if (str.length !== size * size) throw new Error('wrong grid length');
  const cells = [];
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '.') { cells.push(0); continue; }
    const d = DIGITS.indexOf(ch);
    if (d < 0 || d >= size) throw new Error(`bad character ${JSON.stringify(ch)}`);
    cells.push(d + 1);
  }
  return cells;
}

function encode(cells, size) {
  let s = '';
  for (const v of cells) s += v === 0 ? '.' : DIGITS[v - 1];
  return s;
}

// Is placing `d` at (r, c) legal, given the board as it stands? Scans.
function legal(cells, size, boxH, boxW, r, c, d) {
  for (let x = 0; x < size; x++) {
    if (x !== c && cells[r * size + x] === d) return false;
  }
  for (let y = 0; y < size; y++) {
    if (y !== r && cells[y * size + c] === d) return false;
  }
  const r0 = Math.floor(r / boxH) * boxH;
  const c0 = Math.floor(c / boxW) * boxW;
  for (let y = r0; y < r0 + boxH; y++) {
    for (let x = c0; x < c0 + boxW; x++) {
      if ((y !== r || x !== c) && cells[y * size + x] === d) return false;
    }
  }
  return true;
}

// Do the givens already break a constraint?
function givensLegal(cells, size, boxH, boxW) {
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const d = cells[r * size + c];
      if (d === 0) continue;
      if (!legal(cells, size, boxH, boxW, r, c, d)) return false;
    }
  }
  return true;
}

// Count solutions, stopping once `limit` have been found. A returned count
// below `limit` means the search exhausted the whole tree.
export function count(gridString, params, { limit = 2, budget } = {}) {
  const size = params.size, boxH = params.box_h, boxW = params.box_w;
  if (boxH * boxW !== size) throw new Error('box does not tile the grid');
  const b = budget ?? new Budget({ nodes: 30_000_000, ms: 60_000 });
  const cells = decode(gridString, size);
  const solutions = [];

  if (!givensLegal(cells, size, boxH, boxW)) return { count: 0, solutions: [], nodes: b.nodes };

  const rec = () => {
    b.tick();
    let at = -1;
    for (let i = 0; i < cells.length; i++) if (cells[i] === 0) { at = i; break; }
    if (at === -1) { solutions.push(encode(cells, size)); return; }
    const r = Math.floor(at / size), c = at % size;
    for (let d = 1; d <= size; d++) {
      if (!legal(cells, size, boxH, boxW, r, c, d)) continue;
      cells[at] = d;
      rec();
      cells[at] = 0;
      if (solutions.length >= limit) return;
    }
  };

  rec();
  return { count: solutions.length, solutions, nodes: b.nodes };
}

// 'unsolvable' | 'unique' | 'multiple'
export function verdict(gridString, params, opts = {}) {
  const r = count(gridString, params, { ...opts, limit: 2 });
  return { verdict: r.count === 0 ? 'unsolvable' : r.count === 1 ? 'unique' : 'multiple', ...r };
}

// Confirm independently that no second solution exists. Used by the gate's
// cross-check and by the hardening suite's uniqueness adversarial pass.
export function confirmUnique(gridString, expectedSolution, params, opts = {}) {
  const r = count(gridString, params, { ...opts, limit: 2 });
  if (r.count !== 1) return { ok: false, reason: r.count === 0 ? 'reference-found-no-solution' : 'reference-found-second-solution', count: r.count, nodes: r.nodes };
  if (expectedSolution != null && r.solutions[0] !== expectedSolution) {
    return { ok: false, reason: 'reference-solution-differs', count: 1, nodes: r.nodes, got: r.solutions[0] };
  }
  return { ok: true, count: 1, nodes: r.nodes };
}
