// Registry of reference brute-force solvers, one per family.
import * as sudokuClassic from './sudoku-classic.mjs';
import * as binairo from './binairo.mjs';

export const REFERENCES = {
  'sudoku-classic': sudokuClassic,
  binairo,
};

export function referenceFor(family) {
  const r = REFERENCES[family];
  if (!r) throw new Error(`no reference solver for family ${family}`);
  return r;
}
