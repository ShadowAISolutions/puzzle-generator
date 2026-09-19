#!/usr/bin/env node
// Refill the queue.
//
//   node tools/make_plans.mjs [n]
//
// Spreads plans across families, bands and grid shapes, favouring whatever the
// corpus is thin on, and always including an onboarding task while the roster
// is incomplete. Skips any plan whose name already exists anywhere in queue/.
//
// Band reachability is not uniform. Measured at calibration (see STATE.md,
// Decisions, 2026-09-19): a 4x4 sudoku admits band 1 and nothing else, because
// singles finish every 4x4 with a unique solution. Band 3 is scarce everywhere
// and only really available at 9x9. Writing a plan that cannot succeed just
// produces a blocked plan, so the table below is consulted instead.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { readJson, walk } from '../lib/jsonio.mjs';
import { FAMILIES } from '../solver/index.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const QUEUE = path.join(ROOT, 'queue');
const CORPUS = path.join(ROOT, 'corpus');

export const ROSTER = [
  'sudoku-classic', 'nonogram', 'slitherlink', 'kakuro', 'star-battle', 'hitori', 'masyu',
  'akari', 'nurikabe', 'skyscrapers', 'futoshiki', 'binairo', 'shikaku', 'heyawake', 'yajilin',
  'tents', 'killer-sudoku', 'thermo-sudoku', 'sandwich-sudoku', 'norinori',
];

// shape -> bands that shape can actually produce, and how plentiful each is.
// "scarce" bands get a much larger attempt budget.
const SUDOKU_SHAPES = [
  { size: 4, box_h: 2, box_w: 2, min_clues: 4, bands: { 1: 'plentiful' } },
  { size: 6, box_h: 2, box_w: 3, min_clues: 8, bands: { 1: 'plentiful', 4: 'plentiful' } },
  { size: 6, box_h: 3, box_w: 2, min_clues: 8, bands: { 1: 'plentiful', 4: 'plentiful' } },
  { size: 8, box_h: 2, box_w: 4, min_clues: 14, bands: { 1: 'plentiful', 2: 'plentiful', 4: 'plentiful', 5: 'plentiful' } },
  { size: 8, box_h: 4, box_w: 2, min_clues: 14, bands: { 1: 'plentiful', 2: 'plentiful', 4: 'plentiful', 5: 'plentiful' } },
  { size: 9, box_h: 3, box_w: 3, min_clues: 17, bands: { 1: 'plentiful', 2: 'plentiful', 3: 'scarce', 4: 'plentiful', 5: 'plentiful' } },
];

// Symmetry constrains reachability as much as grid shape does, because digging
// removes a whole orbit at a time: a rot180 orbit is two cells, a rot90 orbit
// is four, and a puzzle that has to give up four clues at once cannot be pushed
// as far. Measured: 6x6 mirror_h at band 4 produced nothing in 120 attempts,
// while 6x6 'none' at band 4 is plentiful. So the harder bands are only offered
// the lighter symmetries, and only on the larger grids.
const SYMMETRY_ORBIT = { none: 1, rot180: 2, mirror_h: 2, mirror_v: 2, diagonal: 2, rot90: 4 };

function symmetriesFor(shape, band) {
  const all = shape.box_h === shape.box_w
    ? ['none', 'rot180', 'mirror_h', 'mirror_v', 'diagonal', 'rot90']
    : ['none', 'rot180', 'mirror_h', 'mirror_v'];
  return all.filter((sym) => {
    const orbit = SYMMETRY_ORBIT[sym];
    if (orbit === 1) return true;
    if (orbit === 4) return band === 1;      // rot90 only ever reaches band 1
    return band <= 3 || shape.size >= 8;     // orbit 2: band 4-5 needs room to dig
  });
}

function existingPlanNames() {
  const names = new Set();
  for (const dir of [QUEUE, path.join(QUEUE, 'in-progress'), path.join(QUEUE, 'blocked')]) {
    for (const f of walk(dir, (p) => p.endsWith('.md'))) names.add(path.basename(f).replace(/\.notes\.md$/, '.md'));
  }
  return names;
}

function corpusCounts() {
  const counts = {};
  for (const p of walk(CORPUS, (f) => f.endsWith('.json') && !f.endsWith('family.json'))) {
    let r; try { r = readJson(p); } catch { continue; }
    if (!r?.family) continue;
    counts[r.family] ??= { total: 0, bands: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, shapes: {} };
    counts[r.family].total++;
    counts[r.family].bands[r.difficulty.band]++;
    const k = `${r.params.size}:${r.params.box_h}x${r.params.box_w}`;
    counts[r.family].shapes[k] = (counts[r.family].shapes[k] ?? 0) + 1;
  }
  return counts;
}

function nextIndex() {
  let max = 0;
  for (const dir of [QUEUE, path.join(QUEUE, 'in-progress'), path.join(QUEUE, 'blocked')]) {
    for (const f of walk(dir, (p) => p.endsWith('.md'))) {
      const m = path.basename(f).match(/^(\d{3})-/);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return max + 1;
}

// Every combination this family can produce, ordered so that whatever the
// corpus has least of comes first.
function sudokuCandidates(counts) {
  const have = counts['sudoku-classic'] ?? { bands: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, shapes: {} };
  const out = [];
  for (const sh of SUDOKU_SHAPES) {
    for (const [band, plenty] of Object.entries(sh.bands)) {
      for (const symmetry of symmetriesFor(sh, Number(band))) {
        const shapeKey = `${sh.size}:${sh.box_h}x${sh.box_w}`;
        out.push({
          family: 'sudoku-classic',
          band: Number(band),
          plenty,
          shape: sh,
          symmetry,
          have_band: have.bands[band] ?? 0,
          have_shape: have.shapes[shapeKey] ?? 0,
        });
      }
    }
  }
  // Thinnest first within each band, then interleaved across bands. The
  // interleave matters: a batch claims five consecutive plans, and every batch
  // has to touch all five bands. Sorting purely by thinness would hand a batch
  // five band-4 plans on the same grid shape.
  const byBand = new Map();
  for (const c of out) {
    if (!byBand.has(c.band)) byBand.set(c.band, []);
    byBand.get(c.band).push(c);
  }
  for (const list of byBand.values()) {
    list.sort((a, b) => a.have_shape - b.have_shape || (a.shape.size - b.shape.size) ||
      (a.symmetry < b.symmetry ? -1 : 1));
  }
  const bands = [...byBand.keys()].sort((a, b) =>
    (byBand.get(a)[0].have_band - byBand.get(b)[0].have_band) || (a - b));
  const woven = [];
  for (let round = 0; ; round++) {
    let emitted = false;
    for (const band of bands) {
      const list = byBand.get(band);
      if (round < list.length) { woven.push(list[round]); emitted = true; }
    }
    if (!emitted) break;
  }
  return woven;
}

function planBody(c, count, index) {
  const sh = c.shape;
  const scarce = c.plenty === 'scarce';
  const maxAttempts = scarce ? count * 400 : count * 60;
  const spec = {
    family: c.family,
    band: c.band,
    count,
    max_attempts: maxAttempts,
    params: {
      size: sh.size,
      box_h: sh.box_h,
      box_w: sh.box_w,
      symmetry: c.symmetry,
      min_clues: sh.min_clues,
      band_target: c.band,
      dig_passes: 6,
    },
  };
  const name = `${String(index).padStart(3, '0')}-${c.family}-b${c.band}-${sh.size}${sh.box_h}x${sh.box_w}-${c.symmetry}-${count}`;
  const bandNames = { 1: 'Gentle', 2: 'Easy', 3: 'Medium', 4: 'Hard', 5: 'Brutal' };
  const body = `# ${name}

Generate **${count}** ${c.family} puzzles in **band ${c.band} (${bandNames[c.band]})** on a
**${sh.size}×${sh.size}** grid with **${sh.box_h}×${sh.box_w}** boxes and **${c.symmetry}** symmetry.

- Dig no further than **${sh.min_clues}** clues.
- Band ${c.band} is **${c.plenty}** at this shape, so the attempt budget is **${maxAttempts}**.
- The band written to each record is whatever the solver's trace says. If this plan yields puzzles
  at a different band, the plan was wrong, not the solver: the driver offers them to another plan
  in the batch that wants that band, and discards them otherwise.

**This plan has failed if** it accepts fewer than ${Math.max(1, Math.floor(count * 0.5))} puzzles
within its attempt budget, or if any accepted puzzle fails \`tools/gate.mjs\`.

\`\`\`json
${JSON.stringify(spec, null, 2)}
\`\`\`
`;
  return { name, body };
}

function onboardingBody(family, index) {
  const name = `${String(index).padStart(3, '0')}-onboard-${family}`;
  const body = `# ${name}

Onboard the **${family}** family. It generates **nothing** until every item below exists and is
committed — this is the FAMILY ONBOARDING CONTRACT in \`CLAUDE.md\`, and it is the reason the
guarantee holds across families rather than only for the first one.

1. \`solver/${family}/\` — the independent solver, with a technique ladder and a documented
   canonical encoding and symmetry group.
2. Reference support for ${family} in \`solver/reference/\` — deliberately dumb, obviously correct,
   sharing no code with the solver.
3. \`fixtures/${family}/\` — at least 40 fixtures with known verdicts, covering unique, multiple,
   unsolvable, near-misses and degenerate shapes. Sources in \`fixtures/${family}/SOURCES.md\`.
4. A green \`node tools/harden.mjs ${family} --write-report\`, with \`HARDENING/${family}.md\`
   committed.
5. \`solver/${family}/bands.json\` — calibrated once against the fixtures and frozen.
6. \`site/play/${family}.html\` — a working player passing at least five of its own selftests,
   self-contained and readable at 360px.
7. \`corpus/${family}/family.json\` — regenerated by \`tools/build_index.mjs\`.

**This plan has failed if** any puzzle of this family is generated before all seven exist, or if
the hardening report is not green.

\`\`\`json
{
  "family": "${family}",
  "band": 0,
  "count": 0,
  "kind": "onboarding",
  "params": { "size": 0, "box_h": 0, "box_w": 0 }
}
\`\`\`
`;
  return { name, body };
}

function main() {
  const want = Number(process.argv[2] ?? 40);
  fs.mkdirSync(QUEUE, { recursive: true });
  const existing = existingPlanNames();
  const counts = corpusCounts();
  let index = nextIndex();
  const written = [];

  // At least one onboarding task while the roster is incomplete.
  const missing = ROSTER.filter((f) => !FAMILIES.includes(f));
  if (missing.length) {
    const target = missing[0];
    const o = onboardingBody(target, index);
    if (![...existing].some((n) => n.includes(`onboard-${target}`))) {
      fs.writeFileSync(path.join(QUEUE, `${o.name}.md`), o.body);
      existing.add(`${o.name}.md`);
      written.push(o.name);
      index++;
    }
  }

  const candidates = sudokuCandidates(counts);
  let ci = 0;
  while (written.length < want && ci < candidates.length * 4) {
    const c = candidates[ci % candidates.length];
    ci++;
    // Sized so that the five plans a batch claims land inside the 200-400
    // accepted-puzzle target in CLAUDE.md, allowing for one of the five being
    // an onboarding task that produces no puzzles of its own.
    const count = c.plenty === 'scarce' ? 20 : c.shape.size >= 9 ? 60 : 50;
    const { name, body } = planBody(c, count, index);
    if (existing.has(`${name}.md`)) continue;
    fs.writeFileSync(path.join(QUEUE, `${name}.md`), body);
    existing.add(`${name}.md`);
    written.push(name);
    index++;
  }

  console.log(`wrote ${written.length} plan(s) to queue/`);
  for (const n of written) console.log(`  ${n}`);
}

main();
