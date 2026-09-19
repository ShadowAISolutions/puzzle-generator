// Reference brute force for binairo.
//
// This is deliberately the dumbest correct thing. It has no line enumeration,
// no propagation, no technique ladder and no candidate sets. It fills the
// first empty cell in reading order, tries 0 then 1, and checks legality by
// scanning the row and the column directly.
//
// It exists only to be right. It shares no code with solver/binairo/ -- not
// the encoding, not the rules, nothing -- because a bug the two solvers share
// is a bug the differential test cannot see.
//
// When the two disagree, the solver is wrong until proven otherwise in
// writing, in HARDENING/<family>.md. Never adjust this file to agree with the
// solver.

import { Budget } from '../../lib/budget.mjs';

function decode(str, size) {
  if (typeof str !== 'string') throw new Error('grid must be a string');
  if (str.length !== size * size) throw new Error('wrong grid length');
  const cells = [];
  for (const ch of str) {
    if (ch === '.') cells.push(-1);
    else if (ch === '0') cells.push(0);
    else if (ch === '1') cells.push(1);
    else throw new Error(`bad character ${JSON.stringify(ch)}`);
  }
  return cells;
}

function encode(cells) {
  let s = '';
  for (const v of cells) s += v === -1 ? '.' : String(v);
  return s;
}

// Is the board legal as it stands, looking only at row r and column c? Checks
// all three rules by scanning, and treats -1 as "not yet decided".
function legal(cells, size, r, c) {
  const half = size / 2;

  for (const isRow of [true, false]) {
    const n = isRow ? r : c;
    const line = [];
    for (let i = 0; i < size; i++) line.push(isRow ? cells[n * size + i] : cells[i * size + n]);

    let zeros = 0, ones = 0, done = true;
    for (let i = 0; i < size; i++) {
      if (line[i] === 0) zeros++;
      else if (line[i] === 1) ones++;
      else done = false;
      if (i >= 2 && line[i] !== -1 && line[i] === line[i - 1] && line[i] === line[i - 2]) return false;
    }
    if (zeros > half || ones > half) return false;

    // A finished line may not repeat another finished line parallel to it.
    if (done) {
      for (let m = 0; m < size; m++) {
        if (m === n) continue;
        let same = true;
        for (let i = 0; i < size; i++) {
          const v = isRow ? cells[m * size + i] : cells[i * size + m];
          if (v === -1) { same = false; break; }
          if (v !== line[i]) { same = false; break; }
        }
        if (same) return false;
      }
    }
  }
  return true;
}

// Do the givens already break a rule?
function givensLegal(cells, size) {
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!legal(cells, size, r, c)) return false;
    }
  }
  return true;
}

// Count solutions, stopping once `limit` have been found. A returned count
// below `limit` means the search exhausted the whole tree.
export function count(gridString, params, { limit = 2, budget } = {}) {
  const size = params.size;
  if (size % 2 !== 0) throw new Error('binairo needs an even size');
  const b = budget ?? new Budget({ nodes: 40_000_000, ms: 90_000 });
  const cells = decode(gridString, size);
  const solutions = [];

  if (!givensLegal(cells, size)) return { count: 0, solutions: [], nodes: b.nodes };

  const rec = () => {
    b.tick();
    let at = -1;
    for (let i = 0; i < cells.length; i++) if (cells[i] === -1) { at = i; break; }
    if (at === -1) { solutions.push(encode(cells)); return; }
    const r = Math.floor(at / size), c = at % size;
    for (const v of [0, 1]) {
      cells[at] = v;
      if (legal(cells, size, r, c)) rec();
      cells[at] = -1;
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
  if (r.count !== 1) {
    return {
      ok: false,
      reason: r.count === 0 ? 'reference-found-no-solution' : 'reference-found-second-solution',
      count: r.count,
      nodes: r.nodes,
    };
  }
  if (expectedSolution != null && r.solutions[0] !== expectedSolution) {
    return { ok: false, reason: 'reference-solution-differs', count: 1, nodes: r.nodes, got: r.solutions[0] };
  }
  return { ok: true, count: 1, nodes: r.nodes };
}
