// Reference brute force for nonograms.
//
// This shares no code with solver/nonogram/. It imports nothing from there --
// not the encoder, not the line reasoner, not a constant -- and it is written
// from the rules rather than from that implementation, so that agreement
// between the two is evidence rather than a tautology. Only lib/budget.mjs is
// shared, and that bounds work rather than deciding anything.
//
// The method is row by row. Every arrangement of a row's clue is enumerated
// directly by placing runs left to right, and a partial grid is abandoned the
// moment any column's filled cells can no longer match that column's clue. No
// propagation, no line solving, no tiers: it is the obvious exhaustive search a
// person would write if they had never seen the real solver.
//
// It is exponential and it is meant to be. The gate runs it on every small
// instance and a sample of the large ones precisely because it is dumb enough
// to be obviously right.

import { Budget } from '../../lib/budget.mjs';

// Decoding, written here rather than imported, for the reason above.
function decode(puzzle) {
  if (typeof puzzle !== 'string') throw new Error('puzzle must be a string');
  const halves = puzzle.split('|');
  if (halves.length !== 2) throw new Error('puzzle must hold exactly one |');
  const readSide = (s) => s.split(',').map((group) => {
    const runs = [];
    for (const ch of group) {
      const n = parseInt(ch, 36);
      if (!Number.isInteger(n) || n < 1) throw new Error('bad run length');
      runs.push(n);
    }
    return runs;
  });
  const rowRuns = readSide(halves[0]);
  const colRuns = readSide(halves[1]);
  return { rowRuns, colRuns, rows: rowRuns.length, cols: colRuns.length };
}

// Every arrangement of one clue in a line of the given length, as arrays of 0
// and 1. Runs are placed left to right with at least one gap between them.
function arrangements(len, clue) {
  const out = [];
  const line = new Array(len).fill(0);
  const place = (at, j) => {
    if (j === clue.length) {
      for (let i = at; i < len; i++) line[i] = 0;
      out.push(line.slice());
      return;
    }
    const L = clue[j];
    // The runs still to come need their own cells plus a gap before each.
    let tail = 0;
    for (let k = j + 1; k < clue.length; k++) tail += clue[k] + 1;
    for (let start = at; start + L + tail <= len; start++) {
      for (let i = at; i < start; i++) line[i] = 0;
      for (let i = start; i < start + L; i++) line[i] = 1;
      if (start + L < len) line[start + L] = 0;
      place(start + L + 1, j + 1);
    }
  };
  place(0, 0);
  return out;
}

// Can the column still match its clue, given the rows filled in so far?
//
// Rows 0..done-1 are fixed. The runs entirely above row `done` must match a
// prefix of the clue exactly; a run still touching row done-1 may yet grow, so
// it only has to be no longer than the clue entry it is working on. What
// remains of the clue must then fit in the rows left.
function columnStillPossible(grid, rows, cols, c, done, clue) {
  const runs = [];
  let n = 0;
  for (let r = 0; r < done; r++) {
    if (grid[r * cols + c] === 1) n++;
    else if (n) { runs.push(n); n = 0; }
  }
  const open = n; // a run still in progress at the boundary
  for (let i = 0; i < runs.length; i++) {
    if (i >= clue.length || runs[i] !== clue[i]) return false;
  }
  let j = runs.length;
  if (open) {
    if (j >= clue.length || open > clue[j]) return false;
  }
  if (done === rows) return open ? (j === clue.length - 1 && open === clue[j]) : j === clue.length;
  // What is left to place, and the room left to place it in.
  let need = 0;
  if (open) {
    need += clue[j] - open;
    for (let k = j + 1; k < clue.length; k++) need += clue[k] + 1;
  } else {
    for (let k = j; k < clue.length; k++) need += clue[k] + (k > j ? 1 : 0);
  }
  return need <= rows - done;
}

export function count(puzzle, params, opts = {}) {
  const b = opts.budget ?? new Budget({ nodes: 40_000_000, ms: 90_000 });
  const limit = opts.limit ?? 2;
  const { rowRuns, colRuns, rows, cols } = decode(puzzle);
  if (params) {
    if (rows !== params.rows || cols !== params.cols) {
      throw new Error('clue shape does not match params');
    }
  }
  for (const line of rowRuns) for (const n of line) if (n > cols) return { count: 0, solutions: [], nodes: b.nodes };
  for (const line of colRuns) for (const n of line) if (n > rows) return { count: 0, solutions: [], nodes: b.nodes };

  const rowOptions = rowRuns.map((clue) => arrangements(cols, clue));
  for (const opts_ of rowOptions) if (!opts_.length) return { count: 0, solutions: [], nodes: b.nodes };

  const grid = new Int8Array(rows * cols);
  const solutions = [];

  const rec = (r) => {
    if (solutions.length >= limit) return;
    b.tick();
    if (r === rows) {
      let s = '';
      for (const v of grid) s += v === 1 ? '#' : '.';
      solutions.push(s);
      return;
    }
    for (const line of rowOptions[r]) {
      b.tick();
      for (let c = 0; c < cols; c++) grid[r * cols + c] = line[c];
      let ok = true;
      for (let c = 0; c < cols; c++) {
        if (!columnStillPossible(grid, rows, cols, c, r + 1, colRuns[c])) { ok = false; break; }
      }
      if (ok) rec(r + 1);
      if (solutions.length >= limit) return;
    }
    for (let c = 0; c < cols; c++) grid[r * cols + c] = 0;
  };

  rec(0);
  return { count: solutions.length, solutions, nodes: b.nodes };
}

// 'unsolvable' | 'unique' | 'multiple'
export function verdict(puzzle, params, opts = {}) {
  const r = count(puzzle, params, { ...opts, limit: 2 });
  return { verdict: r.count === 0 ? 'unsolvable' : r.count === 1 ? 'unique' : 'multiple', ...r };
}

// Confirm independently that no second solution exists. Used by the gate's
// cross-check and by the hardening suite's uniqueness adversarial pass.
export function confirmUnique(puzzle, expectedSolution, params, opts = {}) {
  const r = count(puzzle, params, { ...opts, limit: 2 });
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
