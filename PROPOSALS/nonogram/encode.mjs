// Nonogram encoding. A record's `puzzle` is the clue lists; its `solution` is
// the grid. Both are strings inside the schema's 16..256 character window.
//
//   puzzle   "<row clues>|<col clues>"
//            each side is one group per line, joined by ','
//            each group is that line's run lengths, one base-36 digit each
//            an empty group means a line with no filled cells
//
//   solution one character per cell in reading order, '#' filled, '.' empty
//
// A run length is a single base-36 digit, so no line may be longer than 35
// cells. That is far above any shape this family generates and is checked
// rather than assumed.

export const FILLED = '#';
export const EMPTY = '.';

const d36 = (n) => n.toString(36);
const p36 = (c) => parseInt(c, 36);

export function runsOfLine(cells) {
  const runs = [];
  let n = 0;
  for (const c of cells) {
    if (c === 1) n++;
    else if (n) { runs.push(n); n = 0; }
  }
  if (n) runs.push(n);
  return runs;
}

// The clue lists a grid implies. Rows first, then columns.
export function cluesOf(grid, rows, cols) {
  const rowRuns = [];
  for (let r = 0; r < rows; r++) rowRuns.push(runsOfLine(grid.slice(r * cols, r * cols + cols)));
  const colRuns = [];
  for (let c = 0; c < cols; c++) {
    const line = [];
    for (let r = 0; r < rows; r++) line.push(grid[r * cols + c]);
    colRuns.push(runsOfLine(line));
  }
  return { rowRuns, colRuns };
}

export function encodePuzzle(rowRuns, colRuns) {
  const side = (runs) => runs.map((line) => {
    for (const n of line) {
      if (!Number.isInteger(n) || n < 1 || n > 35) throw new Error(`run length ${n} is not encodable`);
    }
    return line.map(d36).join('');
  }).join(',');
  return `${side(rowRuns)}|${side(colRuns)}`;
}

export function decodePuzzle(puzzle) {
  const parts = puzzle.split('|');
  if (parts.length !== 2) throw new Error('puzzle must hold exactly one | separating rows from columns');
  const side = (s) => s.split(',').map((group) => {
    const out = [];
    for (const ch of group) {
      const n = p36(ch);
      if (!Number.isInteger(n) || n < 1) throw new Error(`bad run length ${JSON.stringify(ch)}`);
      out.push(n);
    }
    return out;
  });
  const rowRuns = side(parts[0]);
  const colRuns = side(parts[1]);
  if (!rowRuns.length || !colRuns.length) throw new Error('puzzle must name at least one row and one column');
  return { rowRuns, colRuns, rows: rowRuns.length, cols: colRuns.length };
}

export function encodeGrid(grid, rows, cols) {
  if (grid.length !== rows * cols) throw new Error(`grid is ${grid.length} cells, expected ${rows * cols}`);
  let s = '';
  for (const v of grid) s += v === 1 ? FILLED : EMPTY;
  return s;
}

export function decodeGrid(s, rows, cols) {
  if (s.length !== rows * cols) throw new Error(`solution is ${s.length} characters, expected ${rows * cols}`);
  const grid = new Int8Array(rows * cols);
  for (let i = 0; i < s.length; i++) {
    if (s[i] === FILLED) grid[i] = 1;
    else if (s[i] === EMPTY) grid[i] = 0;
    else throw new Error(`solution holds ${JSON.stringify(s[i])}, expected ${FILLED} or ${EMPTY}`);
  }
  return grid;
}

// A clue set is only well formed if the two sides agree on how many cells are
// filled, and if no line's runs plus its mandatory single-cell gaps overflow
// the line. Neither check proves solvability; both catch a malformed encoding
// before the solver wastes a budget on it.
export function checkShape(rowRuns, colRuns) {
  const rows = rowRuns.length, cols = colRuns.length;
  const sum = (ls) => ls.reduce((a, l) => a + l.reduce((x, y) => x + y, 0), 0);
  if (sum(rowRuns) !== sum(colRuns)) throw new Error('row clues and column clues disagree on the number of filled cells');
  const fits = (line, len) => (line.length === 0 ? 0 : line.reduce((a, b) => a + b, 0) + line.length - 1) <= len;
  for (const [i, line] of rowRuns.entries()) if (!fits(line, cols)) throw new Error(`row ${i} clues cannot fit in ${cols} cells`);
  for (const [i, line] of colRuns.entries()) if (!fits(line, rows)) throw new Error(`column ${i} clues cannot fit in ${rows} cells`);
  return true;
}
