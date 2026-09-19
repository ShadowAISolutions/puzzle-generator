#!/usr/bin/env node
// Solver independence, enforced statically.
//
// The uniqueness guarantee is only worth something if the thing checking a
// puzzle is not the thing that made it. So: nothing under solver/ may import
// anything under generators/, directly or through a re-export. A violation
// fails the build.
//
// The reverse is allowed and expected -- a generator calls the solver to
// search for a unique instance.

import fs from 'node:fs';
import path from 'node:path';
import { walk } from '../lib/jsonio.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const IMPORT_RE = /(?:^|[^\w$.])(?:import\s*(?:[\s\S]*?\sfrom\s*)?|export\s*[\s\S]*?\sfrom\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;

function importsOf(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  for (const m of src.matchAll(IMPORT_RE)) out.push(m[1]);
  return out;
}

const violations = [];
for (const file of walk(path.join(ROOT, 'solver'), (p) => p.endsWith('.mjs') || p.endsWith('.js'))) {
  for (const spec of importsOf(file)) {
    if (!spec.startsWith('.')) continue;
    const resolved = path.resolve(path.dirname(file), spec);
    const relToRoot = path.relative(ROOT, resolved);
    if (relToRoot.startsWith('generators')) {
      violations.push(`${path.relative(ROOT, file)} imports ${spec} (resolves into generators/)`);
    }
  }
}

// A generator must not reach past a solver's public adapter into its internals.
const INTERNAL_RE = /^solver\/[a-z0-9-]+\/(?!index\.mjs$|bands\.json$)/;
for (const file of walk(path.join(ROOT, 'generators'), (p) => p.endsWith('.mjs') || p.endsWith('.js'))) {
  for (const spec of importsOf(file)) {
    if (!spec.startsWith('.')) continue;
    const relToRoot = path.relative(ROOT, path.resolve(path.dirname(file), spec));
    if (INTERNAL_RE.test(relToRoot)) {
      violations.push(`${path.relative(ROOT, file)} imports ${spec}, a solver internal; generators may only use solver/index.mjs and a family's index.mjs`);
    }
  }
}

if (violations.length) {
  console.error('import isolation broken:');
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}
console.log('import isolation: solver/ imports nothing from generators/, generators/ touches no solver internals');
