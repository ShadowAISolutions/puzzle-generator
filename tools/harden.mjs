#!/usr/bin/env node
// The solver hardening suite.
//
//   node tools/harden.mjs <family> [--write-report] [--quick]
//
// A family generates nothing until this passes and HARDENING/<family>.md is
// committed. Seven passes:
//
//   1 fixtures      every fixture classified correctly
//   2 differential  2,000 random instances, solver against the reference
//   3 uniqueness    every instance the solver calls unique, confirmed by the
//                   reference independently
//   4 mutation      remove one given from a unique instance; the two solvers
//                   must still agree on what the result is
//   5 determinism   same instance, same verdict, trace and band, on repeat
//                   runs and in a separate process
//   6 fuzz          10,000 malformed, oversized and adversarial inputs, each
//                   bounded; no crash, no hang, no unhandled rejection
//   7 band stability the technique trace for each fixture still matches its
//                   recorded band
//
// When the solver and the reference disagree, the solver is wrong until proven
// otherwise in writing. Never change the reference to agree with the solver.
//
// --quick shrinks the random passes. It is for iterating while developing and
// is never how a committed report is produced; a report generated under
// --quick says so on its face.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

import { readJson, walk } from '../lib/jsonio.mjs';
import { makeRng } from '../lib/prng.mjs';
import { Budget, BudgetExceeded } from '../lib/budget.mjs';
import { solverFor } from '../solver/index.mjs';
import { generatorFor } from '../generators/index.mjs';
import { referenceFor } from '../solver/reference/index.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ALPHABET = '123456789ABCDEFG';

const DIFFERENTIAL_N = 2000;
const FUZZ_N = 10000;
const QUICK_DIFFERENTIAL_N = 120;
const QUICK_FUZZ_N = 600;

// Per-instance wall clock cap for the fuzz pass. Anything slower is a hang.
const FUZZ_CAP_MS = 2000;

const SHAPES = [
  { size: 4, box_h: 2, box_w: 2, weight: 3 },
  { size: 6, box_h: 2, box_w: 3, weight: 3 },
  { size: 6, box_h: 3, box_w: 2, weight: 1 },
  { size: 8, box_h: 2, box_w: 4, weight: 1 },
  { size: 9, box_h: 3, box_w: 3, weight: 3 },
];

function pickShape(rng) {
  const total = SHAPES.reduce((a, s) => a + s.weight, 0);
  let k = rng.int(total);
  for (const s of SHAPES) { k -= s.weight; if (k < 0) return s; }
  return SHAPES[SHAPES.length - 1];
}

// A complete valid grid, built here so the differential pass does not depend
// on the generator's search succeeding.
function completeGrid(rng, size, boxH, boxW) {
  const nStacks = size / boxW;
  const cells = new Int8Array(size * size);
  const rowM = new Int32Array(size), colM = new Int32Array(size), boxM = new Int32Array(size);
  const digits = Array.from({ length: size }, (_, i) => i + 1);
  const rec = (at) => {
    if (at === cells.length) return true;
    const r = (at / size) | 0, c = at % size;
    const b = ((r / boxH) | 0) * nStacks + ((c / boxW) | 0);
    for (const d of rng.shuffle(digits.slice())) {
      const bit = 1 << (d - 1);
      if ((rowM[r] | colM[c] | boxM[b]) & bit) continue;
      cells[at] = d; rowM[r] |= bit; colM[c] |= bit; boxM[b] |= bit;
      if (rec(at + 1)) return true;
      cells[at] = 0; rowM[r] &= ~bit; colM[c] &= ~bit; boxM[b] &= ~bit;
    }
    return false;
  };
  if (!rec(0)) throw new Error('could not build a complete grid');
  return cells;
}

function format(cells, size) {
  let s = '';
  for (const v of cells) s += v === 0 ? '.' : ALPHABET[v - 1];
  return s;
}

// A random instance. Three kinds, so the differential pass sees satisfiable
// grids, contradictory ones and outright noise.
function randomInstance(rng) {
  const sh = pickShape(rng);
  const n = sh.size, cells = n * n;
  const roll = rng.float();
  if (roll < 0.15) {
    // noise: scatter symbols at random, no attempt at consistency
    const grid = new Array(cells).fill('.');
    const k = 1 + rng.int(Math.max(2, Math.floor(cells * 0.35)));
    for (let i = 0; i < k; i++) grid[rng.int(cells)] = ALPHABET[rng.int(n)];
    return { kind: 'noise', params: { size: n, box_h: sh.box_h, box_w: sh.box_w }, puzzle: grid.join('') };
  }
  const full = completeGrid(rng, n, sh.box_h, sh.box_w);
  const keep = 0.15 + rng.float() * 0.75;
  const grid = Array.from(full, (v) => (rng.float() < keep ? ALPHABET[v - 1] : '.'));
  if (roll < 0.40) {
    // corrupted: change one given, usually making the grid unsolvable
    const at = [];
    for (let i = 0; i < grid.length; i++) if (grid[i] !== '.') at.push(i);
    if (at.length) {
      const i = at[rng.int(at.length)];
      let d = ALPHABET[rng.int(n)];
      if (d === grid[i]) d = ALPHABET[(ALPHABET.indexOf(d) + 1) % n];
      grid[i] = d;
    }
    return { kind: 'corrupted', params: { size: n, box_h: sh.box_h, box_w: sh.box_w }, puzzle: grid.join('') };
  }
  return { kind: 'dug', params: { size: n, box_h: sh.box_h, box_w: sh.box_w }, puzzle: grid.join('') };
}

// A *minimal* unique instance: dug to a fixpoint, so that removing any single
// given breaks uniqueness. The mutation pass needs these. A random instance is
// no use there -- it is usually so heavily clued that a clue can be dropped
// with the solution still forced, which tests nothing.
//
// The dig uses the solver's uniqueness verdict, which is not circular: what
// the mutation pass asserts is that the reference agrees with it, and that
// every removal really does break uniqueness. If the dig's minimality claim
// were wrong, that second assertion is what catches it.
function minimalUniqueInstance(rng, S, shapes = [1, 2, 4]) {
  const sh = SHAPES[shapes[rng.int(shapes.length)]];
  const n = sh.size;
  const params = { size: n, box_h: sh.box_h, box_w: sh.box_w };
  const cells = completeGrid(rng, n, sh.box_h, sh.box_w);
  const order = rng.shuffle(Array.from({ length: n * n }, (_, i) => i));
  for (let pass = 0; pass < 3; pass++) {
    let progress = false;
    for (const i of order) {
      if (cells[i] === 0) continue;
      const saved = cells[i];
      cells[i] = 0;
      if (S.uniquenessOf(format(cells, n), params).verdict === 'unique') progress = true;
      else cells[i] = saved;
    }
    if (!progress) break;
  }
  return { kind: 'minimal', params, puzzle: format(cells, n) };
}

// --- malformed inputs for the fuzz pass -------------------------------------

function fuzzCase(rng, i) {
  const sh = pickShape(rng);
  const n = sh.size;
  const params = { size: n, box_h: sh.box_h, box_w: sh.box_w };
  const good = format(completeGrid(rng, n, sh.box_h, sh.box_w), n);
  const kinds = [
    () => ({ why: 'too short', params, puzzle: good.slice(0, rng.int(good.length)) }),
    () => ({ why: 'too long', params, puzzle: good + '.'.repeat(1 + rng.int(40)) }),
    () => ({ why: 'oversized', params, puzzle: '.'.repeat(100000) }),
    () => ({ why: 'bad character', params, puzzle: good.slice(0, -1) + rng.pick(['Z', '0', ' ', '\n', '\u0000', '\u{1F600}', '-', '#']) }),
    () => ({ why: 'symbol above the grid size', params, puzzle: good.slice(0, -1) + ALPHABET[n + rng.int(16 - n)] }),
    () => ({ why: 'empty string', params, puzzle: '' }),
    () => ({ why: 'not a string', params, puzzle: rng.pick([null, undefined, 42, {}, [], true, NaN]) }),
    () => ({ why: 'box does not tile the grid', params: { size: n, box_h: 5, box_w: 5 }, puzzle: good }),
    () => ({ why: 'unsupported size', params: { size: rng.pick([0, 1, 3, 5, 7, 11, 25, -9, 1e6]), box_h: 3, box_w: 3 }, puzzle: good }),
    () => ({ why: 'non-integer size', params: { size: 9.5, box_h: 3, box_w: 3 }, puzzle: good }),
    () => ({ why: 'params not an object', params: rng.pick([null, undefined, 'nine', 9, []]), puzzle: good }),
    () => ({ why: 'all one symbol', params, puzzle: '1'.repeat(n * n) }),
    () => ({ why: 'unicode padding', params, puzzle: '́'.repeat(n * n) }),
    () => ({ why: 'whitespace grid', params, puzzle: ' '.repeat(n * n) }),
    () => ({ why: 'prototype-looking keys', params: { size: n, box_h: sh.box_h, box_w: sh.box_w, __proto__: { size: 99 } }, puzzle: good }),
  ];
  return kinds[i % kinds.length]();
}

// --- passes ------------------------------------------------------------------

function pass(name) { return { name, ok: true, checked: 0, failures: [], notes: {}, ms: 0 }; }
function fail(p, detail) { p.ok = false; if (p.failures.length < 20) p.failures.push(detail); }

// Where a pass gets its test material.
//
// Four of the seven passes build their own instances, and until 2026-09-19
// every one of those instances was a string of digits and dots on a sudoku
// shape. That made the suite unable to harden any family with another
// encoding: the differential pass failed on every instance, the uniqueness
// adversarial pass threw, and -- the dangerous part -- the fuzz pass reported
// `pass` while testing nothing, because a solver for another family correctly
// rejects fifteen malformed sudoku grids.
//
// A family may now supply its own. Each hook falls back to the sudoku
// implementation above, so `sudoku-classic` draws exactly the instances it
// always did, from the same seeds, in the same order.
function instanceSource(S) {
  return {
    randomInstance: S.randomInstance ?? randomInstance,
    minimalUniqueInstance: S.minimalUniqueInstance ?? minimalUniqueInstance,
    fuzzCase: S.fuzzCase ?? fuzzCase,
    // One-step weakenings of an instance, in a stable order: the mutation pass
    // removes one unit of given information and demands that uniqueness break.
    // For a sudoku that unit is a given; for another family it might be a
    // merged pair of cages or a dropped constraint, which is why a family can
    // override it.
    weakenings: S.weakenings ?? ((inst) => {
      const out = [];
      for (let k = 0; k < inst.puzzle.length; k++) {
        if (inst.puzzle[k] === '.') continue;
        out.push({ at: k, puzzle: `${inst.puzzle.slice(0, k)}.${inst.puzzle.slice(k + 1)}` });
      }
      return out;
    }),
  };
}

function fixturesPass(S, dir) {
  const p = pass('fixtures');
  const t = Date.now();
  const files = [...walk(dir, (f) => f.endsWith('.json'))];
  for (const f of files) {
    const fx = readJson(f);
    p.checked++;
    let got;
    try {
      got = S.classify(fx.puzzle, fx.params);
    } catch (e) {
      if (e instanceof BudgetExceeded) { fail(p, `${fx.slug}: solver exceeded its ${e.kind} budget`); continue; }
      fail(p, `${fx.slug}: solver threw ${e.message}`);
      continue;
    }
    if (fx.expect.verdict === null) {
      // The reference could not decide this one inside its budget. The solver
      // must still answer, and the gate must reject for want of a cross-check.
      p.notes.reference_undecided = (p.notes.reference_undecided ?? 0) + 1;
      if (!['unique', 'multiple', 'unsolvable'].includes(got.verdict)) fail(p, `${fx.slug}: solver returned ${got.verdict}`);
      continue;
    }
    if (got.verdict !== fx.expect.verdict) {
      fail(p, `${fx.slug}: solver says ${got.verdict}, fixture expects ${fx.expect.verdict}`);
      continue;
    }
    if (fx.expect.verdict === 'unique' && got.solutionString !== fx.expect.solution) {
      fail(p, `${fx.slug}: solver's solution differs from the reference's`);
    }
  }
  p.ms = Date.now() - t;
  return p;
}

function bandStabilityPass(S, dir) {
  const p = pass('band stability');
  const t = Date.now();
  for (const f of walk(dir, (x) => x.endsWith('.json'))) {
    const fx = readJson(f);
    if (fx.expect.band == null) continue;
    p.checked++;
    let got;
    try { got = S.classify(fx.puzzle, fx.params); } catch (e) { fail(p, `${fx.slug}: ${e.message}`); continue; }
    if (got.difficulty.band !== fx.expect.band) fail(p, `${fx.slug}: band is now ${got.difficulty.band}, calibrated at ${fx.expect.band}`);
    else if (got.difficulty.techniques.join(',') !== (fx.expect.techniques ?? []).join(',')) {
      fail(p, `${fx.slug}: technique trace changed; was [${(fx.expect.techniques ?? []).join(', ')}], now [${got.difficulty.techniques.join(', ')}]`);
    }
  }
  p.ms = Date.now() - t;
  return p;
}

function differentialPass(S, R, n, I) {
  const p = pass('differential');
  const t = Date.now();
  const rng = makeRng('harden|differential|1');
  const byKind = {};
  for (let i = 0; i < n; i++) {
    const inst = I.randomInstance(rng);
    byKind[inst.kind] = (byKind[inst.kind] ?? 0) + 1;
    p.checked++;
    let mine, theirs;
    try { mine = S.classify(inst.puzzle, inst.params).verdict; }
    catch (e) {
      if (e instanceof BudgetExceeded) { p.notes.solver_budget = (p.notes.solver_budget ?? 0) + 1; continue; }
      fail(p, `solver threw on ${inst.kind} ${inst.puzzle}: ${e.message}`); continue;
    }
    try { theirs = R.verdict(inst.puzzle, inst.params, { budget: S.makeBudgets(inst.params).referenceBudget() }).verdict; }
    catch (e) {
      if (e instanceof BudgetExceeded) { p.notes.reference_budget = (p.notes.reference_budget ?? 0) + 1; continue; }
      fail(p, `reference threw on ${inst.kind} ${inst.puzzle}: ${e.message}`); continue;
    }
    if (mine !== theirs) fail(p, `DISAGREEMENT (${inst.kind}, ${inst.params.size}x${inst.params.size} ${inst.params.box_h}x${inst.params.box_w}): solver ${mine}, reference ${theirs}: ${inst.puzzle}`);
  }
  p.notes.kinds = byKind;
  p.ms = Date.now() - t;
  return p;
}

function uniquenessAdversarialPass(S, R, n, I) {
  const p = pass('uniqueness adversarial');
  const t = Date.now();
  const rng = makeRng('harden|uniqueness|2');
  let confirmed = 0, fromMinimal = 0;

  const confirm = (inst, v) => {
    // Every supported size sits at or below the family's threshold, so every
    // one of these is confirmed outright rather than sampled.
    if (!S.needsReferenceCheck(inst.params, 1)) { p.notes.sampled_out = (p.notes.sampled_out ?? 0) + 1; return; }
    p.checked++;
    try {
      const conf = R.confirmUnique(inst.puzzle, v.solutionString, inst.params, { budget: S.makeBudgets(inst.params).referenceBudget() });
      if (!conf.ok) fail(p, `solver called it unique, reference says ${conf.reason}: ${inst.puzzle}`);
      else confirmed++;
    } catch (e) {
      if (e instanceof BudgetExceeded) { p.notes.reference_budget = (p.notes.reference_budget ?? 0) + 1; return; }
      fail(p, `reference threw: ${e.message}`);
    }
  };

  // Minimal instances first: these are the ones where uniqueness is actually
  // at risk, because there is no spare clue holding the solution in place.
  for (let i = 0; i < Math.max(20, Math.floor(n / 8)); i++) {
    const inst = I.minimalUniqueInstance(rng, S);
    let v;
    try { v = S.classify(inst.puzzle, inst.params); } catch { continue; }
    if (v.verdict !== 'unique') { fail(p, `a grid dug to uniqueness-minimality classified as ${v.verdict}: ${inst.puzzle}`); continue; }
    fromMinimal++;
    confirm(inst, v);
  }

  for (let i = 0; i < n; i++) {
    const inst = I.randomInstance(rng);
    let v;
    try { v = S.classify(inst.puzzle, inst.params); } catch { continue; }
    if (v.verdict !== 'unique') continue;
    confirm(inst, v);
  }

  p.notes.confirmed = confirmed;
  p.notes.from_minimal_instances = fromMinimal;
  p.ms = Date.now() - t;
  return p;
}

function mutationPass(S, R, n, I) {
  const p = pass('mutation');
  const t = Date.now();
  const rng = makeRng('harden|mutation|2');
  let stayedUnique = 0, minimalChecked = 0, minimalRemovals = 0;

  // The strict half: minimal instances, where every removal must break
  // uniqueness, and both solvers must say so.
  const nMinimal = Math.max(12, Math.floor(n / 4));
  for (let i = 0; i < nMinimal; i++) {
    const inst = I.minimalUniqueInstance(rng, S);
    minimalChecked++;
    const weaker = I.weakenings(inst);
    for (const { puzzle: mutated } of weaker) {
      p.checked++; minimalRemovals++;
      let mine, theirs;
      try { mine = S.classify(mutated, inst.params).verdict; }
      catch (e) { if (e instanceof BudgetExceeded) { p.notes.solver_budget = (p.notes.solver_budget ?? 0) + 1; continue; } fail(p, `solver threw: ${e.message}`); continue; }
      try { theirs = R.verdict(mutated, inst.params, { budget: S.makeBudgets(inst.params).referenceBudget() }).verdict; }
      catch (e) { if (e instanceof BudgetExceeded) { p.notes.reference_budget = (p.notes.reference_budget ?? 0) + 1; continue; } fail(p, `reference threw: ${e.message}`); continue; }
      if (mine !== theirs) { fail(p, `DISAGREEMENT after removing a given from a minimal instance: solver ${mine}, reference ${theirs}: ${mutated}`); continue; }
      if (mine === 'unique') {
        fail(p, `removing a given from a minimal instance left it unique under both solvers, so the dig's minimality claim is wrong: ${mutated}`);
      } else if (mine !== 'multiple' && mine !== 'unsolvable') {
        fail(p, `unexpected verdict ${mine} after removing a given`);
      }
    }
  }

  // The broad half: random unique instances, mostly not minimal. Here the
  // invariant is only that the two solvers never diverge -- a clue can be
  // dropped from an over-clued grid with the solution still forced.
  let instances = 0;
  for (let i = 0; i < n; i++) {
    const inst = I.randomInstance(rng);
    let v;
    try { v = S.classify(inst.puzzle, inst.params); } catch { continue; }
    if (v.verdict !== 'unique') continue;
    instances++;
    // Shuffling the weakenings rather than the positions keeps the draw count,
    // and therefore the seeded stream, exactly what it was.
    const weaker = I.weakenings(inst);
    for (const { puzzle: mutated } of rng.shuffle(weaker.slice()).slice(0, Math.min(6, weaker.length))) {
      p.checked++;
      let mine, theirs;
      try { mine = S.classify(mutated, inst.params).verdict; } catch (e) { if (e instanceof BudgetExceeded) continue; fail(p, `solver threw: ${e.message}`); continue; }
      try { theirs = R.verdict(mutated, inst.params, { budget: S.makeBudgets(inst.params).referenceBudget() }).verdict; } catch (e) { if (e instanceof BudgetExceeded) continue; fail(p, `reference threw: ${e.message}`); continue; }
      if (mine !== theirs) { fail(p, `DISAGREEMENT after removing a given: solver ${mine}, reference ${theirs}: ${mutated}`); continue; }
      if (mine === 'unique') stayedUnique++;
      else if (mine !== 'multiple' && mine !== 'unsolvable') fail(p, `unexpected verdict ${mine} after removing a given`);
    }
  }

  p.notes.minimal_instances = minimalChecked;
  p.notes.removals_from_minimal_instances = minimalRemovals;
  p.notes.over_clued_instances = instances;
  p.notes.removals_from_over_clued_that_stayed_unique = stayedUnique;
  p.ms = Date.now() - t;
  return p;
}

function determinismPass(S, family, dir) {
  const p = pass('determinism');
  const t = Date.now();
  const files = [...walk(dir, (f) => f.endsWith('.json'))];
  const sample = files.filter((_, i) => i % 3 === 0);
  for (const f of sample) {
    const fx = readJson(f);
    p.checked++;
    const runs = [];
    for (let k = 0; k < 3; k++) {
      try {
        const v = S.classify(fx.puzzle, fx.params);
        runs.push(JSON.stringify({ verdict: v.verdict, solution: v.solutionString ?? null, difficulty: v.difficulty }));
      } catch (e) { runs.push(`threw:${e.name}`); }
    }
    if (new Set(runs).size !== 1) { fail(p, `${fx.slug}: repeat runs in the same process differ`); continue; }

    // And in a separate process, to catch anything that depends on module load
    // order, a warm cache or accumulated state.
    let out;
    try {
      out = execFileSync(process.execPath, ['tools/classify_one.mjs', family, JSON.stringify(fx.params), fx.puzzle], { cwd: ROOT, encoding: 'utf8', timeout: 120000 }).trim();
    } catch (e) { fail(p, `${fx.slug}: child process failed: ${String(e.message).slice(0, 200)}`); continue; }
    if (out !== runs[0]) fail(p, `${fx.slug}: a separate process disagrees with this one`);
  }
  p.ms = Date.now() - t;
  return p;
}

function fuzzPass(S, n, I) {
  const p = pass('fuzz');
  const t = Date.now();
  const rng = makeRng('harden|fuzz|1');
  const outcomes = {};
  let slowest = 0;
  for (let i = 0; i < n; i++) {
    const c = I.fuzzCase(rng, i);
    p.checked++;
    const t0 = Date.now();
    let outcome;
    try {
      const v = S.classify(c.puzzle, c.params);
      outcome = `verdict:${v.verdict}`;
    } catch (e) {
      if (e instanceof BudgetExceeded) outcome = 'budget-exceeded';
      else if (e instanceof RangeError && /call stack/i.test(e.message)) { fail(p, `${c.why}: stack overflow`); outcome = 'stack-overflow'; }
      else if (e instanceof Error) outcome = 'rejected';
      else { fail(p, `${c.why}: threw a non-Error ${String(e)}`); outcome = 'threw-non-error'; }
    }
    const took = Date.now() - t0;
    if (took > slowest) slowest = took;
    if (took > FUZZ_CAP_MS) fail(p, `${c.why}: took ${took}ms, over the ${FUZZ_CAP_MS}ms cap`);
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  p.notes.outcomes = outcomes;
  p.notes.slowest_ms = slowest;
  p.ms = Date.now() - t;
  return p;
}

// --- report ------------------------------------------------------------------

function renderReport(family, S, G, passes, opts) {
  const now = new Date().toISOString().slice(0, 10);
  const total = passes.reduce((a, p) => a + p.ms, 0);
  const allOk = passes.every((p) => p.ok);
  const lines = [];
  lines.push(`# Hardening report — ${family}`);
  lines.push('');
  lines.push(`- **Date:** ${now}`);
  lines.push(`- **Solver version:** ${S.SOLVER_VERSION}`);
  lines.push(`- **Generator version:** ${G.GENERATOR_VERSION}`);
  lines.push(`- **Family version:** ${S.FAMILY_VERSION}`);
  lines.push(`- **Result:** ${allOk ? '**PASS**' : '**FAIL**'}`);
  lines.push(`- **Wall clock:** ${(total / 1000).toFixed(1)}s`);
  if (opts.quick) lines.push(`- **Profile:** \`--quick\`. This is a development run with reduced sample sizes and **is not a valid committed report.**`);
  lines.push('');
  lines.push('Generated by `node tools/harden.mjs ' + family + (opts.quick ? ' --quick' : '') + ' --write-report`. Do not edit by hand.');
  lines.push('');
  lines.push('## Passes');
  lines.push('');
  lines.push('| Pass | Result | Checked | Time |');
  lines.push('|---|---|---:|---:|');
  for (const p of passes) lines.push(`| ${p.name} | ${p.ok ? 'pass' : '**fail**'} | ${p.checked} | ${(p.ms / 1000).toFixed(1)}s |`);
  lines.push('');
  for (const p of passes) {
    if (Object.keys(p.notes).length === 0 && p.ok) continue;
    lines.push(`### ${p.name}`);
    lines.push('');
    if (Object.keys(p.notes).length) {
      lines.push('```json');
      lines.push(JSON.stringify(p.notes, null, 2));
      lines.push('```');
      lines.push('');
    }
    if (!p.ok) {
      lines.push(`**${p.failures.length} failure${p.failures.length === 1 ? '' : 's'} shown (first 20):**`);
      lines.push('');
      for (const f of p.failures) lines.push(`- ${f}`);
      lines.push('');
    }
  }
  lines.push('## Failures found and fixed');
  lines.push('');
  lines.push('Anything this suite caught while the family was being built, and what was done about it,');
  lines.push('is recorded in `STATE.md` under `## Decisions`. This section is regenerated on every run and');
  lines.push('reports only the state of the run above.');
  lines.push('');
  lines.push('## What a failure here means');
  lines.push('');
  lines.push('When the solver and the reference disagree, **the solver is wrong until proven otherwise**,');
  lines.push('in writing, in this file. The reference is never adjusted to agree with the solver. A budget');
  lines.push('overrun is a rejection, never a pass.');
  lines.push('');
  return lines.join('\n');
}

// --- main ---------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const family = args.find((a) => !a.startsWith('--'));
  if (!family) { console.error('usage: node tools/harden.mjs <family> [--write-report] [--quick]'); process.exit(2); }
  const quick = args.includes('--quick');
  const write = args.includes('--write-report');

  const S = solverFor(family);
  const G = generatorFor(family);
  const R = referenceFor(family);
  const I = instanceSource(S);
  const dir = path.join(ROOT, 'fixtures', family);
  if (!fs.existsSync(dir)) { console.error(`no fixtures at fixtures/${family}/`); process.exit(2); }

  const nDiff = quick ? QUICK_DIFFERENTIAL_N : DIFFERENTIAL_N;
  const nFuzz = quick ? QUICK_FUZZ_N : FUZZ_N;

  const passes = [];
  const run = (fn) => { const p = fn(); passes.push(p); console.log(`  ${p.ok ? 'pass' : 'FAIL'}  ${p.name.padEnd(24)} ${String(p.checked).padStart(6)} checked  ${(p.ms / 1000).toFixed(1)}s`); return p; };

  console.log(`harden ${family}${quick ? ' (quick)' : ''}:`);
  run(() => fixturesPass(S, dir));
  run(() => differentialPass(S, R, nDiff, I));
  run(() => uniquenessAdversarialPass(S, R, Math.max(200, Math.floor(nDiff / 2)), I));
  run(() => mutationPass(S, R, Math.max(80, Math.floor(nDiff / 8)), I));
  run(() => determinismPass(S, family, dir));
  run(() => fuzzPass(S, nFuzz, I));
  run(() => bandStabilityPass(S, dir));

  const ok = passes.every((p) => p.ok);
  if (!ok) {
    console.log('\nfailures:');
    for (const p of passes.filter((x) => !x.ok)) for (const f of p.failures) console.log(`  [${p.name}] ${f}`);
  }
  if (write) {
    if (quick) console.log('\nrefusing to write a report from a --quick run is not enforced, but the report will say it is invalid');
    const out = path.join(ROOT, 'HARDENING', `${family}.md`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, renderReport(family, S, G, passes, { quick }));
    console.log(`\nwrote HARDENING/${family}.md`);
  }
  console.log(`\nharden ${family}: ${ok ? 'PASS' : 'FAIL'}`);
  process.exit(ok ? 0 : 1);
}

main();
