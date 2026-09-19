#!/usr/bin/env node
// Batch generation driver.
//
//   node tools/generate.mjs --plans queue/in-progress --batch 001
//   node tools/generate.mjs --plan queue/003-sudoku-classic-b4-40.md --batch 001
//
// Reads plan files, generates puzzles, runs each one through the solver and
// the reference, and writes the records that clear. Everything that does not
// clear is counted by reason and reported; rejections are a normal outcome and
// the counts are a health signal.
//
// A plan asks for a band. The band a record carries is whatever the solver's
// trace says, so a puzzle that comes out at a different band is not forced to
// match: it is offered to any other plan in the batch that still wants that
// band, and discarded only when nothing wants it. The plan is never evidence.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { writeJson, readJson, walk } from '../lib/jsonio.mjs';
import { BudgetExceeded } from '../lib/budget.mjs';
import { solverFor } from '../solver/index.mjs';
import { buildRecord, recordPath } from './record.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CORPUS = path.join(ROOT, 'corpus');

// A plan is a markdown file with a fenced json block. Prose around it is for
// humans; the block is what this reads.
export function parsePlan(file) {
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(/```json\s*([\s\S]*?)```/);
  if (!m) throw new Error(`${path.basename(file)}: no fenced json block`);
  const spec = JSON.parse(m[1]);
  for (const k of ['family', 'band', 'count', 'params']) {
    if (spec[k] === undefined) throw new Error(`${path.basename(file)}: plan is missing "${k}"`);
  }
  return { file, name: path.basename(file, '.md'), ...spec };
}

function existingHashes() {
  const set = new Set();
  for (const p of walk(CORPUS, (f) => f.endsWith('.json') && !f.endsWith('family.json'))) {
    try { const r = readJson(p); if (r?.canonical_hash) set.add(r.canonical_hash); } catch { /* the gate will catch it */ }
  }
  return set;
}

function bump(counts, key) { counts[key] = (counts[key] ?? 0) + 1; }

export function runPlans(plans, { batch, now, wallClockMs = 45 * 60 * 1000, onProgress } = {}) {
  const seen = existingHashes();
  const wanted = new Map(); // band -> [plan, ...] still short
  const accepted = new Map(); // plan name -> [records]
  const rejects = {};
  for (const p of plans) {
    accepted.set(p.name, []);
    if (p.kind === 'onboarding' || p.count === 0) continue;
    if (!wanted.has(p.band)) wanted.set(p.band, []);
    wanted.get(p.band).push(p);
  }

  const started = Date.now();
  const outOfTime = () => Date.now() - started > wallClockMs;

  // A puzzle that comes out at a band some other plan still wants goes there
  // rather than being thrown away.
  const placeRecord = (rec) => {
    const band = rec.difficulty.band;
    const takers = (wanted.get(band) ?? []).filter((p) => accepted.get(p.name).length < p.count && p.family === rec.family);
    if (!takers.length) return null;
    const taker = takers[0];
    accepted.get(taker.name).push(rec);
    return taker;
  };

  for (const plan of plans) {
    // An onboarding plan produces no puzzles of its own: it exists to hold the
    // FAMILY ONBOARDING CONTRACT open until the family's solver, fixtures,
    // hardening report, bands and player are committed. Asking for a solver
    // that does not exist yet would take the whole batch down with it.
    if (plan.kind === 'onboarding' || plan.count === 0) {
      plan.result = { attempts: 0, accepted: 0, target: 0, rejects: {}, exhausted: false, out_of_time: false, kind: 'onboarding' };
      continue;
    }
    const S = solverFor(plan.family);
    const attemptsAllowed = plan.max_attempts ?? Math.max(400, plan.count * 80);
    let attempts = 0;
    let consecutiveFailures = 0;
    const planRejects = {};

    while (accepted.get(plan.name).length < plan.count && attempts < attemptsAllowed && !outOfTime()) {
      const seed = `${batch}|${plan.name}|${attempts}`;
      attempts++;
      let built;
      try {
        built = buildRecord({ family: plan.family, seed, params: plan.params, batch, now, referenceCheck: true });
      } catch (e) {
        if (e instanceof BudgetExceeded) { bump(rejects, 'timeout'); bump(planRejects, 'timeout'); consecutiveFailures++; continue; }
        bump(rejects, `error:${e.message.slice(0, 60)}`); bump(planRejects, 'error'); consecutiveFailures++; continue;
      }
      if (!built.record) {
        const reason = built.reason.startsWith('generator:') ? 'band-mismatch' : built.reason.startsWith('reference:') ? 'reference-disagreed' : 'not-unique';
        bump(rejects, reason); bump(planRejects, reason);
        consecutiveFailures++;
        continue;
      }
      const rec = built.record;
      if (seen.has(rec.canonical_hash)) { bump(rejects, 'duplicate-hash'); bump(planRejects, 'duplicate-hash'); consecutiveFailures++; continue; }

      const taker = placeRecord(rec);
      if (!taker) { bump(rejects, 'band-surplus'); bump(planRejects, 'band-surplus'); consecutiveFailures++; continue; }
      seen.add(rec.canonical_hash);
      consecutiveFailures = 0;
      if (onProgress) onProgress(plan, accepted.get(plan.name).length, attempts);
    }

    plan.result = {
      attempts,
      accepted: accepted.get(plan.name).length,
      target: plan.count,
      rejects: planRejects,
      exhausted: attempts >= attemptsAllowed,
      out_of_time: outOfTime(),
    };
  }

  return { accepted, rejects, plans };
}

function writeAccepted(accepted) {
  let written = 0;
  const byBand = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const byFamily = {};
  for (const [, records] of accepted) {
    for (const rec of records) {
      writeJson(path.join(ROOT, recordPath(rec)), rec);
      written++;
      byBand[rec.difficulty.band]++;
      byFamily[rec.family] = (byFamily[rec.family] ?? 0) + 1;
    }
  }
  return { written, byBand, byFamily };
}

function main() {
  const args = process.argv.slice(2);
  const get = (flag, dflt) => { const i = args.indexOf(flag); return i === -1 ? dflt : args[i + 1]; };
  const batch = get('--batch', 'phase0');
  const planDir = get('--plans', null);
  const planFile = get('--plan', null);
  const wall = Number(get('--wall-minutes', '45')) * 60 * 1000;
  const now = get('--now', null);

  let files = [];
  if (planFile) files = [path.isAbsolute(planFile) ? planFile : path.join(ROOT, planFile)];
  else if (planDir) files = [...walk(path.isAbsolute(planDir) ? planDir : path.join(ROOT, planDir), (f) => f.endsWith('.md') && !f.endsWith('.notes.md'))];
  else { console.error('usage: node tools/generate.mjs (--plans <dir> | --plan <file>) --batch <NNN>'); process.exit(2); }

  if (!files.length) { console.log('generate: no plans to run'); return 0; }
  const plans = files.sort().map(parsePlan);
  console.log(`generate: ${plans.length} plan(s), batch ${batch}`);

  const t0 = Date.now();
  const { accepted, rejects } = runPlans(plans, { batch, now, wallClockMs: wall });
  const out = writeAccepted(accepted);

  for (const p of plans) {
    const r = p.result;
    console.log(`  ${p.name.padEnd(40)} ${String(r.accepted).padStart(4)}/${String(r.target).padEnd(4)} in ${String(r.attempts).padStart(6)} attempts${r.accepted < r.target ? '  SHORT' : ''}`);
  }
  console.log(`generate: wrote ${out.written} records in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`  by band:   ${JSON.stringify(out.byBand)}`);
  console.log(`  by family: ${JSON.stringify(out.byFamily)}`);
  console.log(`  rejected:  ${JSON.stringify(rejects)}`);

  const summaryPath = path.join(ROOT, '.artifacts', `generate-${batch}.json`);
  writeJson(summaryPath, {
    batch,
    wrote: out.written,
    by_band: out.byBand,
    by_family: out.byFamily,
    rejects,
    plans: plans.map((p) => ({ name: p.name, family: p.family, band: p.band, target: p.count, ...p.result })),
  });
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
