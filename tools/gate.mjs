#!/usr/bin/env node
// The gate.
//
//   node tools/gate.mjs <path-or-family-or---all>... [--render] [--json]
//   node tools/gate.mjs --from-file <list> [--render] [--json]
//
// --render turns on check 8 for the sampled records. --render-all widens the
// sample to every record in the run; the audit pass uses it, because a
// screenshot review is the only thing that catches a clue printed off the edge
// of a board, and a gate cannot see that.
//
// A puzzle is admitted only if every check passes. There are no exceptions and
// no overrides, and nothing in this file may be relaxed to make a puzzle pass.
// Rejections are normal and expected; a rejection rate that collapses towards
// zero is a reason to suspect the gate, not to congratulate the generator.
//
// Checks, in order:
//   1 schema        the record validates and its versions are current
//   2 solvable      the solver finds a solution, and it matches the record
//   3 unique        the solver proves no second solution exists, counting to 2
//   4 cross-checked the reference brute force confirms the verdict
//   5 banded        the band recomputed from the trace matches the record
//   6 regenerable   (generator_version, seed, params) rebuilds it exactly
//   7 corpus-unique the canonical hash is not already in the corpus
//   8 renderable    the player loads it headlessly, clean, and self-tests
//   9 bounded       every solver call stayed inside its budget
//
// Check 8 is sampled: the first record of each band in the run, plus a
// deterministic 1%. Check 4 is sampled above the family's size threshold, also
// deterministically, so "a random 2%" is the same 2% on every machine.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import { readJson, canonicalJson, walk } from '../lib/jsonio.mjs';
import { BudgetExceeded } from '../lib/budget.mjs';
import { solverFor, FAMILIES } from '../solver/index.mjs';
import { generatorFor } from '../generators/index.mjs';
import { referenceFor } from '../solver/reference/index.mjs';
import { CONTENT_FIELDS, sampleValue, recordPath } from './record.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CORPUS = path.join(ROOT, 'corpus');
const ARTIFACTS = path.join(ROOT, '.artifacts');

// --- schema -----------------------------------------------------------------

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validatePuzzle = ajv.compile(readJson(path.join(ROOT, 'schema/puzzle.schema.json')));

// --- target resolution ------------------------------------------------------

function resolveTargets(arg) {
  if (arg === '--all') return [...walk(CORPUS, (p) => p.endsWith('.json') && !p.endsWith('family.json'))];
  if (FAMILIES.includes(arg)) {
    return [...walk(path.join(CORPUS, arg), (p) => p.endsWith('.json') && !p.endsWith('family.json'))];
  }
  const abs = path.isAbsolute(arg) ? arg : path.join(ROOT, arg);
  if (!fs.existsSync(abs)) throw new Error(`no such path: ${arg}`);
  if (fs.statSync(abs).isDirectory()) {
    return [...walk(abs, (p) => p.endsWith('.json') && !p.endsWith('family.json'))];
  }
  return [abs];
}

// --- the corpus-wide hash index --------------------------------------------

function buildHashIndex() {
  const index = new Map();
  for (const p of walk(CORPUS, (f) => f.endsWith('.json') && !f.endsWith('family.json'))) {
    let rec;
    try { rec = readJson(p); } catch { continue; }
    if (!rec || typeof rec.canonical_hash !== 'string') continue;
    if (!index.has(rec.canonical_hash)) index.set(rec.canonical_hash, []);
    index.get(rec.canonical_hash).push(path.relative(ROOT, p));
  }
  return index;
}

// --- the render check -------------------------------------------------------

let browserPromise = null;
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { launchBrowser } = await import('../lib/browser.mjs');
      return launchBrowser();
    })();
  }
  return browserPromise;
}

// Loads the family's player from disk with no network of any kind, hands it the
// record directly, and runs its self-tests. A console error, a network request
// or a failing self-test fails the check. The viewport is 360px wide, the
// narrowest the site contract has to work at, so a board that overflows a
// phone fails here rather than in front of a reader.
async function renderCheck(record) {
  const player = path.join(ROOT, 'site', 'play', `${record.family}.html`);
  if (!fs.existsSync(player)) return { ok: false, detail: `no player at site/play/${record.family}.html` };
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width: 360, height: 900 }, offline: true });
  const page = await context.newPage();
  const problems = [];
  const requests = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('request', (r) => { if (!r.url().startsWith('file://')) requests.push(r.url()); });
  try {
    await page.goto(`file://${player}`, { waitUntil: 'load' });
    const loaded = await page.evaluate((rec) => {
      if (typeof window.__LOAD_RECORD !== 'function') return 'no __LOAD_RECORD';
      try { window.__LOAD_RECORD(rec); return 'ok'; } catch (e) { return `__LOAD_RECORD threw: ${e.message}`; }
    }, record);
    if (loaded !== 'ok') problems.push(loaded);
    const selftest = await page.evaluate(() => {
      if (typeof window.__SELFTEST !== 'function') return null;
      try { return window.__SELFTEST(); } catch (e) { return [{ name: 'selftest', pass: false, detail: e.message }]; }
    });
    if (!Array.isArray(selftest)) problems.push('__SELFTEST missing or not an array');
    else {
      if (selftest.length < 5) problems.push(`__SELFTEST returned ${selftest.length} entries, need at least 5`);
      for (const t of selftest) if (!t || t.pass !== true) problems.push(`selftest failed: ${t?.name ?? '?'} ${t?.detail ?? ''}`);
    }
    if (requests.length) problems.push(`made ${requests.length} network request(s): ${requests.slice(0, 3).join(', ')}`);
    const shotDir = path.join(ARTIFACTS, record.family, `b${record.difficulty.band}`);
    fs.mkdirSync(shotDir, { recursive: true });
    await page.screenshot({ path: path.join(shotDir, `${record.id}.png`), fullPage: true });
  } catch (e) {
    problems.push(`render threw: ${e.message}`);
  } finally {
    await context.close();
  }
  return { ok: problems.length === 0, detail: problems.join('; ') };
}

// --- one record -------------------------------------------------------------

async function gateRecord(file, ctx) {
  const rel = path.relative(ROOT, file);
  const checks = [];
  const add = (name, ok, detail = '') => { checks.push({ name, ok, detail }); return ok; };

  let record;
  try { record = readJson(file); } catch (e) { add('schema', false, `unparseable: ${e.message}`); return { rel, checks }; }

  // 1 schema, and versions current
  if (!validatePuzzle(record)) {
    add('schema', false, ajv.errorsText(validatePuzzle.errors, { separator: '; ' }).slice(0, 400));
    return { rel, checks };
  }
  if (!FAMILIES.includes(record.family)) { add('schema', false, `unknown family ${record.family}`); return { rel, checks }; }
  const S = solverFor(record.family);
  const G = generatorFor(record.family);
  const R = referenceFor(record.family);
  const versionProblems = [];
  if (record.family_version !== S.FAMILY_VERSION) versionProblems.push(`family_version ${record.family_version} != ${S.FAMILY_VERSION}`);
  if (record.solver_version !== S.SOLVER_VERSION) versionProblems.push(`solver_version ${record.solver_version} != ${S.SOLVER_VERSION}`);
  if (record.generator_version !== G.GENERATOR_VERSION) versionProblems.push(`generator_version ${record.generator_version} != ${G.GENERATOR_VERSION}`);
  if (record.id !== record.canonical_hash.slice(0, 16)) versionProblems.push('id is not the first 16 hex of canonical_hash');
  if (rel !== recordPath(record)) versionProblems.push(`stored at ${rel}, should be ${recordPath(record)}`);
  try { G.validateParams(record.params); } catch (e) { versionProblems.push(`params: ${e.message}`); }
  if (!add('schema', versionProblems.length === 0, versionProblems.join('; '))) return { rel, checks };

  // Does the encoding match the shape the params declare? What that means is
  // the family's own business -- a sudoku's puzzle is size*size cells, a
  // nonogram's is a clue list whose length has nothing to do with its grid --
  // so the family answers it and the gate only records the verdict. A family
  // that does not implement validateEncoding fails here rather than passing.
  try {
    S.validateEncoding(record.puzzle, record.solution, record.params);
  } catch (e) {
    add('schema', false, e.message);
    return { rel, checks };
  }
  if (S.clues(record.puzzle) !== record.clues) { add('schema', false, `clues says ${record.clues}, puzzle has ${S.clues(record.puzzle)}`); return { rel, checks }; }

  // 2, 3, 5, 9 -- one fresh solve covers solvability, uniqueness, the band and
  // the bounds. A budget overrun is a rejection, never a pass.
  let verdict;
  try {
    verdict = S.classify(record.puzzle, record.params);
    add('bounded', true);
  } catch (e) {
    if (e instanceof BudgetExceeded) { add('bounded', false, `solver exceeded its ${e.kind} budget: ${e.message}`); return { rel, checks }; }
    add('bounded', false, `solver threw: ${e.message}`);
    return { rel, checks };
  }
  add('solvable', verdict.verdict !== 'unsolvable' && verdict.solutionString === record.solution,
    verdict.verdict === 'unsolvable' ? 'solver found no solution' :
      verdict.solutionString !== record.solution ? 'solver solution differs from the record' : '');
  add('unique', verdict.verdict === 'unique', verdict.verdict === 'unique' ? '' : `solver says ${verdict.verdict}`);
  if (verdict.verdict !== 'unique') return { rel, checks };

  const d = record.difficulty, v = verdict.difficulty;
  const bandProblems = [];
  if (v.band !== d.band) bandProblems.push(`recomputed band ${v.band}, record says ${d.band}`);
  if (v.score !== d.score) bandProblems.push(`recomputed score ${v.score}, record says ${d.score}`);
  if (v.max_search_depth !== d.max_search_depth) bandProblems.push(`recomputed depth ${v.max_search_depth}, record says ${d.max_search_depth}`);
  if (v.techniques.join(',') !== d.techniques.join(',')) bandProblems.push('recomputed technique trace differs from the record');
  add('banded', bandProblems.length === 0, bandProblems.join('; '));

  // 4 cross-checked by the reference brute force
  const mustCheck = S.needsReferenceCheck(record.params, sampleValue(record.id, 'reference'));
  if (mustCheck) {
    try {
      const conf = R.confirmUnique(record.puzzle, record.solution, record.params, { budget: S.makeBudgets(record.params).referenceBudget() });
      add('cross-checked', conf.ok, conf.ok ? '' : `reference: ${conf.reason}`);
      if (conf.ok && record.uniqueness.reference_checked !== true) {
        add('cross-checked', false, 'reference confirmed but the record says reference_checked false');
      }
    } catch (e) {
      add('cross-checked', false, e instanceof BudgetExceeded ? `reference exceeded its ${e.kind} budget` : `reference threw: ${e.message}`);
    }
  } else {
    add('cross-checked', true, 'above the size threshold and not in the sampled 2%');
  }

  // 6 regenerable, byte for byte, in every content field
  try {
    const regen = G.generate(record.seed, record.params);
    if (!regen.puzzle) add('regenerable', false, `regeneration produced nothing: ${regen.reason}`);
    else if (regen.puzzle !== record.puzzle) add('regenerable', false, 'regenerated a different puzzle');
    else {
      const rebuilt = S.classify(regen.puzzle, record.params);
      const mirror = {
        id: S.hashOf(regen.puzzle, record.params).slice(0, 16),
        family: record.family,
        family_version: S.FAMILY_VERSION,
        generator_version: G.GENERATOR_VERSION,
        solver_version: S.SOLVER_VERSION,
        seed: record.seed,
        params: record.params,
        puzzle: regen.puzzle,
        solution: rebuilt.solutionString,
        clues: regen.clues,
        uniqueness: { ...rebuilt.uniqueness, reference_checked: record.uniqueness.reference_checked },
        difficulty: rebuilt.difficulty,
        canonical_hash: S.hashOf(regen.puzzle, record.params),
      };
      const mine = {};
      for (const k of CONTENT_FIELDS) mine[k] = record[k];
      const a = canonicalJson(mirror), b = canonicalJson(mine);
      add('regenerable', a === b, a === b ? '' : 'regenerated content fields differ from the record');
    }
  } catch (e) {
    add('regenerable', false, `regeneration threw: ${e.message}`);
  }

  // 7 unique in the corpus
  const others = (ctx.hashIndex.get(record.canonical_hash) ?? []).filter((p) => p !== rel);
  add('corpus-unique', others.length === 0, others.length ? `same canonical hash as ${others.slice(0, 2).join(', ')}` : '');

  // 8 renderable, sampled
  if (ctx.renderSet.has(rel)) {
    const r = await renderCheck(record);
    add('renderable', r.ok, r.detail);
  } else {
    add('renderable', true, 'not sampled');
  }

  return { rel, checks };
}

// --- driver -----------------------------------------------------------------

function chooseRenderSample(files, records, renderEnabled, renderAll) {
  const set = new Set();
  if (!renderEnabled && !renderAll) return set;
  if (renderAll) {
    for (const f of files) set.add(path.relative(ROOT, f));
    return set;
  }
  const seenBand = new Set();
  for (const f of files) {
    const rec = records.get(f);
    if (!rec) continue;
    const rel = path.relative(ROOT, f);
    const key = `${rec.family}/b${rec.difficulty?.band}`;
    if (!seenBand.has(key)) { seenBand.add(key); set.add(rel); continue; }
    if (sampleValue(rec.id ?? rel, 'render') < 0.01) set.add(rel);
  }
  return set;
}

async function main() {
  const args = process.argv.slice(2);
  const fromFileAt = args.indexOf('--from-file');
  const fromFile = fromFileAt === -1 ? null : args[fromFileAt + 1];
  const skip = new Set(fromFile ? [fromFile] : []);
  const flags = new Set(args.filter((a) => a.startsWith('--') && a !== '--all'));
  const positional = args.filter((a) => (!a.startsWith('--') || a === '--all') && !skip.has(a));
  const renderAll = flags.has('--render-all');
  const renderEnabled = flags.has('--render') || renderAll;
  const asJson = flags.has('--json');

  let targets = positional;
  if (fromFile) {
    // A list of paths, one per line. CI uses this so that a pull request with
    // hundreds of new records is one gate run, sharing one corpus-wide hash
    // index and one render sample.
    const listed = fs.readFileSync(path.isAbsolute(fromFile) ? fromFile : path.join(ROOT, fromFile), 'utf8')
      .split('\n').map((l) => l.trim()).filter(Boolean);
    targets = targets.concat(listed);
  }
  if (targets.length === 0) {
    console.error('usage: node tools/gate.mjs <path-or-family-or---all>... [--render] [--json]');
    console.error('       node tools/gate.mjs --from-file <list> [--render] [--json]');
    process.exit(2);
  }

  const files = [...new Set(targets.flatMap(resolveTargets))].sort();
  if (files.length === 0) {
    console.log('gate: nothing to check');
    return 0;
  }

  const records = new Map();
  for (const f of files) { try { records.set(f, readJson(f)); } catch { /* reported per record */ } }

  const ctx = {
    hashIndex: buildHashIndex(),
    renderSet: chooseRenderSample(files, records, renderEnabled, renderAll),
  };

  const results = [];
  let passed = 0;
  const reasonCounts = new Map();
  for (const f of files) {
    const r = await gateRecord(f, ctx);
    const failed = r.checks.filter((c) => !c.ok);
    if (failed.length === 0) passed++;
    else for (const c of failed) reasonCounts.set(c.name, (reasonCounts.get(c.name) ?? 0) + 1);
    results.push({ ...r, ok: failed.length === 0 });
    if (!asJson && failed.length) {
      console.log(`FAIL ${r.rel}`);
      for (const c of failed) console.log(`     ${c.name}: ${c.detail}`);
    }
  }

  if (browserPromise) { try { (await browserPromise).close(); } catch { /* ignore */ } }

  const summary = {
    checked: files.length,
    passed,
    failed: files.length - passed,
    rendered: ctx.renderSet.size,
    reasons: Object.fromEntries([...reasonCounts.entries()].sort()),
  };
  if (asJson) console.log(JSON.stringify({ summary, results }, null, 2));
  else {
    console.log(`gate: ${passed}/${files.length} passed` + (ctx.renderSet.size ? `, ${ctx.renderSet.size} render-checked` : ''));
    if (summary.failed) console.log(`      failures by check: ${JSON.stringify(summary.reasons)}`);
  }
  return summary.failed === 0 ? 0 : 1;
}

process.exit(await main());
