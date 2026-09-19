// Registry of generators, one per family.
//
// Generators may call a solver through its public verdict functions. Nothing
// in solver/ may import from here; tools/check_imports.mjs enforces it.
import * as sudokuClassic from './sudoku-classic/index.mjs';
import * as binairo from './binairo/index.mjs';

export const GENERATORS = {
  'sudoku-classic': sudokuClassic,
  binairo,
};

export const FAMILIES = Object.keys(GENERATORS).sort();

export function generatorFor(family) {
  const gen = GENERATORS[family];
  if (!gen) throw new Error(`no generator for family ${family}; known: ${FAMILIES.join(', ')}`);
  return gen;
}
