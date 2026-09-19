// Assembling a puzzle record.
//
// The generator supplies the instance. Every other field comes from a fresh
// solve by the independent solver, so the generator's intent never reaches the
// record. If the generator asked for band 4 and the solver's trace says band
// 2, the record says band 2.

import { solverFor } from '../solver/index.mjs';
import { generatorFor } from '../generators/index.mjs';
import { referenceFor } from '../solver/reference/index.mjs';

// Fields that describe the puzzle, as opposed to when it was made. Only these
// have to survive a regeneration byte for byte.
export const CONTENT_FIELDS = [
  'id', 'family', 'family_version', 'generator_version', 'solver_version',
  'seed', 'params', 'puzzle', 'solution', 'clues', 'uniqueness', 'difficulty',
  'canonical_hash',
];

export const PROVENANCE_FIELDS = ['created_at', 'batch'];

// Deterministic per-record sampling, so that "a random 2%" means the same 2%
// on every run and every machine.
export function sampleValue(id, salt) {
  let h = 2166136261;
  const s = `${salt}|${id}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return (h >>> 0) / 4294967296;
}

// Build a record, or return { record: null, reason } if the instance does not
// clear the solver. `referenceCheck` runs the brute force too.
export function buildRecord({ family, seed, params, batch, now, referenceCheck = true }) {
  const S = solverFor(family);
  const G = generatorFor(family);
  const R = referenceFor(family);

  const gen = G.generate(seed, params);
  if (!gen.puzzle) return { record: null, reason: `generator: ${gen.reason}` };

  const verdict = S.classify(gen.puzzle, params);
  if (verdict.verdict !== 'unique') return { record: null, reason: `solver: ${verdict.verdict}` };
  if (verdict.solutionString !== gen.solution) {
    // The solver's unique solution differs from the grid the generator dug
    // out of. That is a contradiction, not a puzzle: fail loudly.
    throw new Error('solver solution differs from the generator source grid');
  }

  let referenceChecked = false;
  if (referenceCheck) {
    const conf = R.confirmUnique(gen.puzzle, verdict.solutionString, params, { budget: S.makeBudgets(params).referenceBudget() });
    if (!conf.ok) return { record: null, reason: `reference: ${conf.reason}` };
    referenceChecked = true;
  }

  const canonical = S.hashOf(gen.puzzle, params);
  const id = canonical.slice(0, 16);

  const record = {
    id,
    family: S.FAMILY,
    family_version: S.FAMILY_VERSION,
    generator_version: G.GENERATOR_VERSION,
    solver_version: S.SOLVER_VERSION,
    seed: String(seed),
    params,
    puzzle: gen.puzzle,
    solution: verdict.solutionString,
    clues: gen.clues,
    uniqueness: { ...verdict.uniqueness, reference_checked: referenceChecked },
    difficulty: verdict.difficulty,
    canonical_hash: canonical,
    created_at: now ?? new Date().toISOString(),
    batch,
  };
  return { record, generated: gen };
}

export function recordPath(record) {
  return `corpus/${record.family}/b${record.difficulty.band}/${record.id.slice(0, 2)}/${record.id}.json`;
}
