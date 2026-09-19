// Reference brute force for killer sudoku.
//
// It exists only to be right. It shares no code with the solver: it parses the
// encoding itself, keeps no candidate sets, builds no unit or peer tables,
// consults no combination tables, and fills cells in plain reading order with
// plain loops. Where the solver is clever, this is slow on purpose, because
// the two agreeing is only evidence if they disagree about nothing but speed.
//
// Its one concession to arithmetic is the obvious one: a cage cannot be
// completed if what is in it already is too much or too little for its target.
// Without that the search would not finish on an empty grid, and a reference
// that cannot answer is not a reference. The bound is stated in two lines and
// needs no table.
//
// Never adjust this file to agree with the solver. When the two disagree the
// solver is wrong until proven otherwise, in writing.

import { BudgetExceeded } from '../../lib/budget.mjs';

const CAGE_IDS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const DIGITS = '123456789ABCDEFG';

// Parse "<size*size cage labels>|<fixed width sums>" without help from the
// family's own decoder.
function parse(puzzleString, size) {
  const cells = size * size;
  if (typeof puzzleString !== 'string') throw new Error('puzzle must be a string');
  const parts = puzzleString.split('|');
  if (parts.length !== 2) throw new Error('expected exactly one | in a killer-sudoku encoding');
  const [layout, sumText] = parts;
  if (layout.length !== cells) throw new Error(`layout length ${layout.length}, expected ${cells}`);

  const cageOf = [];
  const labels = [];
  for (let i = 0; i < cells; i++) {
    const at = CAGE_IDS.indexOf(layout[i]);
    if (at < 0) throw new Error(`bad cage label ${JSON.stringify(layout[i])}`);
    let known = labels.indexOf(at);
    if (known < 0) { labels.push(at); known = labels.length - 1; }
    cageOf.push(known);
  }
  const nCages = labels.length;

  const maxSum = (size * (size + 1)) / 2;
  const width = String(maxSum).length;
  if (sumText.length !== nCages * width) {
    throw new Error(`sums length ${sumText.length}, expected ${nCages * width}`);
  }
  const sums = [];
  for (let c = 0; c < nCages; c++) {
    const field = sumText.slice(c * width, (c + 1) * width);
    if (!/^[0-9]+$/.test(field)) throw new Error(`bad sum field ${JSON.stringify(field)}`);
    sums.push(Number(field));
  }
  return { cageOf, sums, nCages };
}

function encodeGrid(val, size) {
  let s = '';
  for (let i = 0; i < size * size; i++) s += val[i] === 0 ? '.' : DIGITS[val[i] - 1];
  return s;
}

// Does digit d break anything if written at cell i?
function legal(val, cageOf, size, boxH, boxW, i, d) {
  const r = Math.floor(i / size);
  const c = i % size;
  const bandTop = Math.floor(r / boxH) * boxH;
  const stackLeft = Math.floor(c / boxW) * boxW;
  for (let k = 0; k < size; k++) {
    if (val[r * size + k] === d) return false;
    if (val[k * size + c] === d) return false;
  }
  for (let dr = 0; dr < boxH; dr++) {
    for (let dc = 0; dc < boxW; dc++) {
      if (val[(bandTop + dr) * size + stackLeft + dc] === d) return false;
    }
  }
  // A cage holds distinct digits.
  for (let k = 0; k < size * size; k++) {
    if (cageOf[k] === cageOf[i] && val[k] === d) return false;
  }
  return true;
}

// Can the cage containing cell i still reach its target, given what is in it?
// The remaining cells must take distinct digits not already used in the cage,
// so the smallest and largest they can total is found by taking the unused
// digits from each end.
function cageStillPossible(val, cageOf, sums, size, i) {
  const cage = cageOf[i];
  let have = 0;
  let empty = 0;
  const used = [];
  for (let k = 0; k < size * size; k++) {
    if (cageOf[k] !== cage) continue;
    if (val[k] === 0) { empty++; continue; }
    have += val[k];
    used.push(val[k]);
  }
  if (empty === 0) return have === sums[cage];
  const free = [];
  for (let d = 1; d <= size; d++) if (!used.includes(d)) free.push(d);
  if (free.length < empty) return false;
  let lo = 0;
  for (let k = 0; k < empty; k++) lo += free[k];
  let hi = 0;
  for (let k = 0; k < empty; k++) hi += free[free.length - 1 - k];
  return have + lo <= sums[cage] && sums[cage] <= have + hi;
}

export function count(puzzleString, params, { limit = 2, budget } = {}) {
  const size = params.size;
  const boxH = params.box_h;
  const boxW = params.box_w;
  if (boxH * boxW !== size) throw new Error(`box ${boxH}x${boxW} does not tile ${size}`);
  const { cageOf, sums, nCages } = parse(puzzleString, size);

  // A layout whose sums cannot total a full grid has no solution at all, and
  // saying so here costs nothing.
  let total = 0;
  for (const s of sums) total += s;
  if (total !== size * ((size * (size + 1)) / 2)) return { count: 0, solutions: [], nodes: 0 };
  for (let c = 0; c < nCages; c++) {
    let n = 0;
    for (let k = 0; k < size * size; k++) if (cageOf[k] === c) n++;
    if (n > size) return { count: 0, solutions: [], nodes: 0 };
    const lo = (n * (n + 1)) / 2;
    const hi = (n * (2 * size - n + 1)) / 2;
    if (sums[c] < lo || sums[c] > hi) return { count: 0, solutions: [], nodes: 0 };
  }

  const cells = size * size;
  const val = new Array(cells).fill(0);
  const found = [];

  // Cells are visited cage by cage, in cage order, rather than in reading
  // order. That is still a fixed order fixed in advance -- no candidate counts,
  // no heuristics, nothing read off the board -- but it means a cage's target
  // is checked the moment its last cell is written instead of tens of cells
  // later, which is the difference between this finishing and not. Reading
  // order was measured first and did not finish on a sparsely caged 9x9;
  // fixtures/killer-sudoku/SOURCES.md records the numbers.
  const order = [];
  for (let c = 0; c < nCages; c++) {
    for (let k = 0; k < cells; k++) if (cageOf[k] === c) order.push(k);
  }

  function rec(at) {
    if (budget) budget.tick();
    if (at === cells) { found.push(encodeGrid(val, size)); return; }
    const i = order[at];
    for (let d = 1; d <= size; d++) {
      if (!legal(val, cageOf, size, boxH, boxW, i, d)) continue;
      val[i] = d;
      if (cageStillPossible(val, cageOf, sums, size, i)) {
        rec(at + 1);
      }
      val[i] = 0;
      if (found.length >= limit) return;
    }
  }

  rec(0);
  return { count: found.length, solutions: found, nodes: budget ? budget.nodes : 0 };
}

export function verdict(puzzleString, params, opts = {}) {
  const r = count(puzzleString, params, { ...opts, limit: 2 });
  return { verdict: r.count === 0 ? 'unsolvable' : r.count === 1 ? 'unique' : 'multiple', ...r };
}

// Confirm independently that no second solution exists. Used by the gate's
// cross-check and by the hardening suite's uniqueness adversarial pass.
export function confirmUnique(puzzleString, expectedSolution, params, opts = {}) {
  const r = count(puzzleString, params, { ...opts, limit: 2 });
  if (r.count !== 1) return { ok: false, reason: r.count === 0 ? 'reference-found-no-solution' : 'reference-found-second-solution', count: r.count, nodes: r.nodes };
  if (expectedSolution != null && r.solutions[0] !== expectedSolution) {
    return { ok: false, reason: 'reference-solution-differs', count: 1, nodes: r.nodes, got: r.solutions[0] };
  }
  return { ok: true, count: 1, nodes: r.nodes };
}

export { BudgetExceeded };
