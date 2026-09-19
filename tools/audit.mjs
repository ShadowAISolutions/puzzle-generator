#!/usr/bin/env node
// The audit pass, run every fifth batch.
//
//   node tools/audit.mjs <NNN>
//
// This gathers the evidence. The judgement -- the scores, the running average,
// the diagnosis -- is written by the session into AUDIT/<NNN>.md, because
// scoring "is it pleasant to solve" is not something a script can do. What the
// script does is make it impossible to score honestly without looking:
//
//   - re-solve a weighted sample with the CURRENT reference
//   - recompute every band and score from scratch
//   - re-check canonical hashes across the whole corpus
//   - re-run the band classifier over 200 random records and compare the
//     distribution with the last audit, because a shifted distribution means
//     something that should be frozen has changed
//   - report family balance, band balance and rejection rates
//
// It exits non-zero if anything it can decide by itself is wrong.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { readJson, writeJson, walk } from '../lib/jsonio.mjs';
import { makeRng } from '../lib/prng.mjs';
import { BudgetExceeded } from '../lib/budget.mjs';
import { solverFor, FAMILIES } from '../solver/index.mjs';
import { referenceFor } from '../solver/reference/index.mjs';
import { recordPath } from './record.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CORPUS = path.join(ROOT, 'corpus');
const AUDIT = path.join(ROOT, 'AUDIT');

function allRecords() {
  const out = [];
  for (const p of walk(CORPUS, (f) => f.endsWith('.json') && !f.endsWith('family.json'))) {
    try { out.push({ path: path.relative(ROOT, p), rec: readJson(p) }); } catch { /* schema pass reports it */ }
  }
  return out;
}

// Weighted toward older records: a drift that started early is the one worth
// finding, and the newest puzzles were checked by the gate an hour ago.
function weightedSample(records, n, rng) {
  const ordered = records.slice().sort((a, b) => (a.rec.created_at ?? '') < (b.rec.created_at ?? '') ? -1 : 1);
  const picked = new Set();
  const out = [];
  let guard = 0;
  while (out.length < Math.min(n, ordered.length) && guard++ < n * 50) {
    // square the uniform draw so the front of the list is favoured
    const u = rng.float();
    const i = Math.floor(u * u * ordered.length);
    if (picked.has(i)) continue;
    picked.add(i);
    out.push(ordered[i]);
  }
  return out;
}

function main() {
  const batch = process.argv[2];
  if (!batch) { console.error('usage: node tools/audit.mjs <NNN>'); process.exit(2); }
  const records = allRecords();
  if (!records.length) { console.error('audit: the corpus is empty'); process.exit(2); }
  const rng = makeRng(`audit|${batch}`);
  const problems = [];

  // --- 1 and 2: a weighted sample, re-solved with the current reference -----
  const sample = weightedSample(records, 10, rng);
  const sampleReport = [];
  for (const { path: rel, rec } of sample) {
    const S = solverFor(rec.family);
    const R = referenceFor(rec.family);
    const row = { path: rel, id: rec.id, family: rec.family, band_recorded: rec.difficulty.band };
    try {
      const v = S.classify(rec.puzzle, rec.params);
      row.verdict_now = v.verdict;
      row.band_now = v.difficulty?.band ?? null;
      row.score_recorded = rec.difficulty.score;
      row.score_now = v.difficulty?.score ?? null;
      if (v.verdict !== 'unique') problems.push(`${rel}: the solver now says ${v.verdict}`);
      if (row.band_now !== rec.difficulty.band) problems.push(`${rel}: band was ${rec.difficulty.band}, is now ${row.band_now}`);
      if (row.score_now !== rec.difficulty.score) problems.push(`${rel}: score was ${rec.difficulty.score}, is now ${row.score_now}`);
      if (v.solutionString !== rec.solution) problems.push(`${rel}: the solution has changed`);
    } catch (e) {
      row.verdict_now = e instanceof BudgetExceeded ? 'budget-exceeded' : `threw:${e.message.slice(0, 60)}`;
      problems.push(`${rel}: ${row.verdict_now}`);
    }
    try {
      const conf = R.confirmUnique(rec.puzzle, rec.solution, rec.params, { budget: solverFor(rec.family).makeBudgets(rec.params).referenceBudget() });
      row.reference = conf.ok ? 'confirmed' : conf.reason;
      if (!conf.ok) problems.push(`${rel}: the reference now says ${conf.reason}`);
    } catch (e) {
      row.reference = e instanceof BudgetExceeded ? 'budget-exceeded' : `threw:${e.message.slice(0, 60)}`;
      problems.push(`${rel}: reference ${row.reference}`);
    }
    const shot = path.join(ROOT, '.artifacts', rec.family, `b${rec.difficulty.band}`, `${rec.id}.png`);
    row.screenshot = fs.existsSync(shot) ? path.relative(ROOT, shot) : null;
    row.stored_where_it_belongs = rel === recordPath(rec);
    if (!row.stored_where_it_belongs) problems.push(`${rel}: should be at ${recordPath(rec)}`);
    sampleReport.push(row);
  }

  // --- 3: canonical hashes across the whole corpus --------------------------
  const byHash = new Map();
  for (const { path: rel, rec } of records) {
    if (!byHash.has(rec.canonical_hash)) byHash.set(rec.canonical_hash, []);
    byHash.get(rec.canonical_hash).push(rel);
  }
  const collisions = [...byHash.entries()].filter(([, v]) => v.length > 1);
  for (const [h, paths] of collisions.slice(0, 10)) problems.push(`duplicate canonical hash ${h.slice(0, 16)}: ${paths.join(', ')}`);

  // --- 4: the band classifier over 200 random records -----------------------
  const drifted = [];
  const reband = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const pool = records.slice();
  rng.shuffle(pool);
  const reclass = pool.slice(0, Math.min(200, pool.length));
  for (const { path: rel, rec } of reclass) {
    const S = solverFor(rec.family);
    try {
      const v = S.classify(rec.puzzle, rec.params);
      reband[v.difficulty.band]++;
      if (v.difficulty.band !== rec.difficulty.band) drifted.push(`${rel}: ${rec.difficulty.band} -> ${v.difficulty.band}`);
    } catch { drifted.push(`${rel}: classifier threw`); }
  }
  for (const d of drifted.slice(0, 10)) problems.push(`band drift: ${d}`);

  const recordedBands = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const { rec } of reclass) recordedBands[rec.difficulty.band]++;

  // --- 5: balance and rejection rates ---------------------------------------
  const byFamily = {}, bandsAll = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, shapes = {}, clues = [];
  for (const { rec } of records) {
    byFamily[rec.family] = (byFamily[rec.family] ?? 0) + 1;
    bandsAll[rec.difficulty.band]++;
    const k = `${rec.params.size}x${rec.params.size} ${rec.params.box_h}x${rec.params.box_w}`;
    shapes[k] = (shapes[k] ?? 0) + 1;
    clues.push(rec.clues);
  }
  const familyShare = Object.fromEntries(Object.entries(byFamily).map(([f, n]) => [f, Number((n / records.length * 100).toFixed(1))]));
  const overShare = Object.entries(familyShare).filter(([, p]) => p > 30 && Object.keys(byFamily).length >= 4);
  for (const [f, p] of overShare) problems.push(`family balance: ${f} is ${p}% of the corpus, over the 30% ceiling`);

  const priorAudits = [...walk(AUDIT, (f) => f.endsWith('.json'))].sort();
  const prior = priorAudits.length ? readJson(priorAudits[priorAudits.length - 1]) : null;

  const report = {
    batch,
    generated_at: new Date().toISOString(),
    corpus_size: records.length,
    sample: sampleReport,
    duplicate_hashes: collisions.length,
    reclassified: reclass.length,
    band_distribution_recorded: recordedBands,
    band_distribution_recomputed: reband,
    band_drift: drifted.slice(0, 20),
    previous_audit_band_distribution: prior?.band_distribution_recomputed ?? null,
    corpus_by_family: byFamily,
    corpus_family_share_percent: familyShare,
    corpus_by_band: bandsAll,
    corpus_by_shape: shapes,
    clue_range: clues.length ? [Math.min(...clues), Math.max(...clues)] : null,
    problems,
  };

  fs.mkdirSync(AUDIT, { recursive: true });
  writeJson(path.join(AUDIT, `${batch}.json`), report);

  console.log(`audit ${batch}: ${records.length} records`);
  console.log(`  sampled and re-solved: ${sampleReport.length}`);
  console.log(`  reclassified:          ${reclass.length}, drift: ${drifted.length}`);
  console.log(`  duplicate hashes:      ${collisions.length}`);
  console.log(`  by band:               ${JSON.stringify(bandsAll)}`);
  console.log(`  by family (%):         ${JSON.stringify(familyShare)}`);
  console.log(`  screenshots on disk:   ${sampleReport.filter((r) => r.screenshot).length}/${sampleReport.length}`);
  if (prior) console.log(`  previous distribution: ${JSON.stringify(prior.band_distribution_recomputed)}`);
  console.log(`  wrote AUDIT/${batch}.json`);
  if (problems.length) {
    console.log(`\n  ${problems.length} problem(s):`);
    for (const p of problems.slice(0, 20)) console.log(`    ${p}`);
  }
  console.log('\nNow write AUDIT/' + batch + '.md: scores 1-5 on uniqueness rigour, band accuracy,');
  console.log('puzzle quality, family balance and player rendering, the running average, and any drift.');
  console.log('Hand-trace two of the sampled puzzles far enough to confirm the band is honest.');
  process.exit(problems.length ? 1 : 0);
}

main();
