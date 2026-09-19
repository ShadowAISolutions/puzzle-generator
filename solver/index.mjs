// Registry of independent solvers, one per family.
//
// solver/ imports nothing from generators/. tools/check_imports.mjs enforces
// that statically and CI fails the build if it is ever violated.
import * as sudokuClassic from './sudoku-classic/index.mjs';

export const SOLVERS = {
  'sudoku-classic': sudokuClassic,
};

export const FAMILIES = Object.keys(SOLVERS).sort();

export function solverFor(family) {
  const s = SOLVERS[family];
  if (!s) throw new Error(`no solver for family ${family}; known: ${FAMILIES.join(', ')}`);
  return s;
}
