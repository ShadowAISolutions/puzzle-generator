#!/usr/bin/env node
// Validate every record and manifest against the schemas.
//
//   node tools/validate_schema.mjs
//
// Cheap and total: the gate does this too, but only for what it is pointed at,
// and CI wants a whole-corpus answer.

import path from 'node:path';
import process from 'node:process';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import fs from 'node:fs';
import { readJson, walk } from '../lib/jsonio.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const puzzle = ajv.compile(readJson(path.join(ROOT, 'schema/puzzle.schema.json')));
const family = ajv.compile(readJson(path.join(ROOT, 'schema/family.schema.json')));

let records = 0, manifests = 0, bad = 0;
const MAX_RECORD_BYTES = 16 * 1024;

for (const p of walk(path.join(ROOT, 'corpus'), (f) => f.endsWith('.json'))) {
  const rel = path.relative(ROOT, p);
  let doc;
  try { doc = readJson(p); } catch (e) { console.error(`  ${rel}: unparseable: ${e.message}`); bad++; continue; }
  const isManifest = path.basename(p) === 'family.json';
  const check = isManifest ? family : puzzle;
  if (!check(doc)) {
    console.error(`  ${rel}: ${ajv.errorsText(check.errors, { separator: '; ' }).slice(0, 300)}`);
    bad++;
  }
  if (!isManifest) {
    records++;
    const bytes = Buffer.byteLength(JSON.stringify(doc));
    if (bytes > MAX_RECORD_BYTES) { console.error(`  ${rel}: ${bytes} bytes, over the 16KB limit`); bad++; }
  } else manifests++;
}

// Family indexes must stay under 5MB.
const MAX_INDEX_BYTES = 5 * 1024 * 1024;
for (const p of walk(path.join(ROOT, 'downloads'), (f) => f.endsWith('.json'))) {
  const bytes = Buffer.byteLength(fs.readFileSync(p, 'utf8'));
  if (bytes > MAX_INDEX_BYTES) { console.error(`  ${path.relative(ROOT, p)}: ${bytes} bytes, over the 5MB index limit`); bad++; }
}

console.log(`schema: ${records} record(s), ${manifests} manifest(s), ${bad} problem(s)`);
process.exit(bad === 0 ? 0 : 1);
