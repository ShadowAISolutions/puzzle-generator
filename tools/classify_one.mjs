#!/usr/bin/env node
// Classify one instance and print the verdict as canonical JSON.
//
// Exists so the determinism pass can compare this process against a fresh one.
// Any dependence on module load order, a warm cache or accumulated state shows
// up here as a mismatch.
import process from 'node:process';
import { solverFor } from '../solver/index.mjs';

const [family, paramsJson, puzzle] = process.argv.slice(2);
const S = solverFor(family);
try {
  const v = S.classify(puzzle, JSON.parse(paramsJson));
  process.stdout.write(JSON.stringify({ verdict: v.verdict, solution: v.solutionString ?? null, difficulty: v.difficulty }));
} catch (e) {
  process.stdout.write(`threw:${e.name}`);
}
