// Canonical JSON serialisation.
//
// A puzzle record has to regenerate byte for byte, so serialisation cannot
// depend on JavaScript's object key insertion order. Keys are emitted in
// lexicographic order at every level, with a fixed two-space indent and a
// trailing newline.
import fs from 'node:fs';
import path from 'node:path';

export function canonicalJson(value) {
  return JSON.stringify(sortKeys(value), null, 2) + '\n';
}

export function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object' && v.constructor === Object) {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

export function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function writeJson(p, value) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, canonicalJson(value));
}

// Walk a directory tree and yield every path matching the predicate.
export function* walk(dir, match = () => true) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, match);
    else if (match(p)) yield p;
  }
}
