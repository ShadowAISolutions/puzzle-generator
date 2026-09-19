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

// The roster in CLAUDE.md, in "rough order of onboarding" as the mission puts it.
// Reordered once, and only in that rough order: the three sudoku variants are pulled
// forward because they have boxes, so `schema/puzzle.schema.json` can express their
// params as frozen. The sixteen box-less families after them cannot be onboarded until
// `params` is widened. See PROPOSALS/2026-09-19-family-agnostic-params.md and STATE.md.
export const ROSTER = [
  'sudoku-classic', 'killer-sudoku', 'thermo-sudoku', 'sandwich-sudoku',
  'nonogram', 'slitherlink', 'kakuro', 'star-battle', 'hitori', 'masyu',
  'akari', 'nurikabe', 'skyscrapers', 'futoshiki', 'binairo', 'shikaku', 'heyawake', 'yajilin',
  'tents', 'norinori',
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

// Binairo grids are square and always even-sided, so every symmetry of the
// square is available at every size. Bands were measured on 2026-09-19 by
// generating against each target in turn while building the fixture set.
// Bands 1 to 4 came out readily at every size. Band 5 appeared only at 12x12,
// and not at 6, 8 or 10 in any attempt: reaching it means defeating
// cell-by-cell case analysis, which on a small board finishes almost anything
// that has one solution at all. It is listed only where it was actually seen,
// and marked scarce there rather than promised.
const BINAIRO_SHAPES = [
  { size: 6, min_clues: 0, bands: { 1: 'plentiful', 2: 'plentiful', 3: 'plentiful', 4: 'plentiful' } },
  { size: 8, min_clues: 0, bands: { 1: 'plentiful', 2: 'plentiful', 3: 'plentiful', 4: 'plentiful' } },
  { size: 10, min_clues: 0, bands: { 1: 'plentiful', 2: 'plentiful', 3: 'plentiful', 4: 'plentiful' } },
  { size: 12, min_clues: 0, bands: { 1: 'plentiful', 2: 'plentiful', 3: 'plentiful', 4: 'plentiful', 5: 'scarce' } },
  { size: 14, min_clues: 0, bands: { 1: 'plentiful', 2: 'plentiful', 3: 'plentiful', 4: 'plentiful' } },
];

function binairoSymmetries(shape, band) {
  return ['none', 'rot180', 'mirror_h', 'mirror_v', 'diagonal', 'rot90'].filter((sym) => {
    const orbit = SYMMETRY_ORBIT[sym];
    if (orbit === 1) return true;
    if (orbit === 4) return band <= 2 || shape.size >= 10;
    return true;
  });
}

// What a planner has to know about a family: the shapes it can produce, how to
// name a shape, and how to turn one into generator params. Everything else --
// the thinnest-cell ordering, the band interleave, the duplicate check -- is
// the same for every family and lives below.
// Nonogram shapes. "density" and "smooth" are the levers that pick which grid
// the climb starts from, and they vary by shape: a big grid needs a lower fill
// and more smoothing to keep its clue string inside the schema's 256 characters.
//
// Band 5 appears in no cell here. It has never been observed for this family at
// any supported shape -- a hypothesis on one cell, worked out with full line
// reasoning, resolves every unique nonogram measured so far -- so queueing a
// band-5 plan would queue a plan that cannot be met. Band 4 is marked scarce
// because it is: roughly one climb in thirty at 12x12.
const NONOGRAM_SHAPES = [
  { rows: 5, cols: 5, density: 0.5, smooth: 0, bands: { 1: 'plentiful', 2: 'plentiful', 3: 'plentiful' } },
  { rows: 6, cols: 6, density: 0.5, smooth: 0, bands: { 1: 'plentiful', 2: 'plentiful', 3: 'plentiful' } },
  { rows: 8, cols: 8, density: 0.48, smooth: 1, bands: { 1: 'plentiful', 2: 'plentiful', 3: 'plentiful' } },
  { rows: 10, cols: 10, density: 0.46, smooth: 1, bands: { 1: 'plentiful', 2: 'plentiful', 3: 'plentiful', 4: 'scarce' } },
  { rows: 12, cols: 12, density: 0.45, smooth: 1, bands: { 1: 'plentiful', 2: 'plentiful', 3: 'plentiful', 4: 'scarce' } },
  { rows: 14, cols: 14, density: 0.44, smooth: 2, bands: { 1: 'plentiful', 2: 'plentiful', 3: 'plentiful', 4: 'scarce' } },
  { rows: 5, cols: 8, density: 0.48, smooth: 0, bands: { 1: 'plentiful', 2: 'plentiful', 3: 'plentiful' } },
  { rows: 6, cols: 10, density: 0.47, smooth: 1, bands: { 1: 'plentiful', 2: 'plentiful', 3: 'plentiful' } },
  { rows: 8, cols: 12, density: 0.46, smooth: 1, bands: { 1: 'plentiful', 2: 'plentiful', 3: 'plentiful' } },
  { rows: 10, cols: 15, density: 0.45, smooth: 2, bands: { 1: 'plentiful', 2: 'plentiful', 3: 'plentiful' } },
];

const PLANNERS = {
  'sudoku-classic': {
    shapes: SUDOKU_SHAPES,
    symmetries: symmetriesFor,
    shapeKey: (sh) => `${sh.size}:${sh.box_h}x${sh.box_w}`,
    paramsKey: (p) => `${p.size}:${p.box_h}x${p.box_w}`,
    slug: (sh) => `${sh.size}${sh.box_h}x${sh.box_w}`,
    describe: (sh) => `**${sh.size}×${sh.size}** grid with **${sh.box_h}×${sh.box_w}** boxes`,
    params: (sh, band, symmetry) => ({
      size: sh.size, box_h: sh.box_h, box_w: sh.box_w,
      symmetry, min_clues: sh.min_clues, band_target: band, dig_passes: 6,
    }),
    countFor: (c) => (c.shape.size >= 9 ? 60 : 50),
  },
  binairo: {
    shapes: BINAIRO_SHAPES,
    symmetries: binairoSymmetries,
    shapeKey: (sh) => `${sh.size}:binairo`,
    paramsKey: (p) => `${p.size}:binairo`,
    slug: (sh) => `${sh.size}x${sh.size}`,
    describe: (sh) => `**${sh.size}×${sh.size}** grid`,
    params: (sh, band, symmetry) => ({
      size: sh.size, symmetry, min_clues: sh.min_clues, band_target: band, dig_passes: 6,
    }),
    // A scarce cell asks for far fewer. Batch 011 measured band 5 at 12x12 at
    // roughly one puzzle per 325 attempts, over 4,391 rejections; asking that
    // cell for 40 guarantees a plan that runs out of time every time and
    // reports short. Twelve is about what its time share actually buys.
    countFor: (c) => (c.plenty === 'scarce' ? 12 : c.shape.size >= 12 ? 40 : 50),
  },
  nonogram: {
    shapes: NONOGRAM_SHAPES,
    // A nonogram has no givens to lay out, so there is no symmetry to choose:
    // its clues are a function of its solution. The single entry keeps the
    // shared plan machinery, which iterates symmetries, working unchanged.
    symmetries: () => ['none'],
    shapeKey: (sh) => `${sh.rows}x${sh.cols}:nonogram`,
    paramsKey: (p) => `${p.rows}x${p.cols}:nonogram`,
    slug: (sh) => `${sh.rows}x${sh.cols}`,
    describe: (sh) => `**${sh.rows}×${sh.cols}** grid`,
    params: (sh, band) => ({
      rows: sh.rows, cols: sh.cols, density: sh.density, smooth: sh.smooth,
      band_target: band, climb_steps: band >= 4 ? 700 : 300,
    }),
    // Every accepted nonogram costs a hill climb, and a climb at 14x14 costs
    // seconds rather than the milliseconds a binairo dig costs. These counts
    // are what a plan's share of the batch clock actually buys.
    countFor: (c) => (c.plenty === 'scarce' ? 6 : c.shape.rows * c.shape.cols >= 144 ? 25 : 40),
  },
};

// A plan's identity is the cell it fills -- family, band, shape, symmetry --
// not its filename. The sequence number and the requested count are bookkeeping.
// Comparing whole filenames made the duplicate check a no-op, because a freshly
// numbered plan never collides with an existing one: batch 005 found
// 054 plans covering only 040 cells, and re-queued a cell the corpus had
// already exhausted.
function cellOf(name) {
  return name.replace(/\.md$/, '').replace(/^\d+-/, '').replace(/-\d+$/, '');
}

function existingPlanCells() {
  const cells = new Set();
  for (const dir of [QUEUE, path.join(QUEUE, 'in-progress'), path.join(QUEUE, 'blocked')]) {
    for (const f of walk(dir, (p) => p.endsWith('.md'))) cells.add(cellOf(path.basename(f).replace(/\.notes\.md$/, '.md')));
  }
  return cells;
}

// Cells the generator has measurably exhausted. A small shape holds only so
// many puzzles that are distinct under the family's symmetry group, and once
// the corpus holds them a plan for that cell spends its whole budget producing
// duplicates. queue/saturated.json records the measurement that established it.
function saturatedCells() {
  const f = path.join(QUEUE, 'saturated.json');
  if (!fs.existsSync(f)) return new Set();
  try { return new Set((readJson(f).cells ?? []).map((c) => c.cell)); } catch { return new Set(); }
}

function corpusCounts() {
  const counts = {};
  for (const p of walk(CORPUS, (f) => f.endsWith('.json') && !f.endsWith('family.json'))) {
    let r; try { r = readJson(p); } catch { continue; }
    if (!r?.family) continue;
    counts[r.family] ??= { total: 0, bands: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, shapes: {}, cells: {} };
    counts[r.family].total++;
    counts[r.family].bands[r.difficulty.band]++;
    const planner = PLANNERS[r.family];
    const k = planner ? planner.paramsKey(r.params) : `${r.params.size}:unknown`;
    counts[r.family].shapes[k] = (counts[r.family].shapes[k] ?? 0) + 1;
    // The band/shape cell, which is what a plan actually fills. A shape total
    // hides a starved cell inside a well-stocked shape: 9x9 held 377 records
    // and ten of them were band 1.
    const ck = `${k}|${r.difficulty.band}`;
    counts[r.family].cells[ck] = (counts[r.family].cells[ck] ?? 0) + 1;
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
function candidatesFor(family, counts) {
  const planner = PLANNERS[family];
  if (!planner) return [];
  const have = counts[family] ?? { bands: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, shapes: {}, cells: {} };
  const out = [];
  for (const sh of planner.shapes) {
    for (const [band, plenty] of Object.entries(sh.bands)) {
      for (const symmetry of planner.symmetries(sh, Number(band))) {
        const shapeKey = planner.shapeKey(sh);
        out.push({
          family,
          planner,
          band: Number(band),
          plenty,
          shape: sh,
          symmetry,
          have_band: have.bands[band] ?? 0,
          have_shape: have.shapes[shapeKey] ?? 0,
          have_cell: have.cells?.[`${shapeKey}|${band}`] ?? 0,
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
    // Thinnest CELL first, not thinnest shape. Sorting on the shape total
    // offered the same exhausted 4x4 band-1 cells every refill, because 4x4
    // is the smallest shape overall, while 9x9 band 1 -- ten records, the
    // thinnest cell in the corpus -- sorted last behind its own well-stocked
    // bands 2 to 5. The shape total stays as the tie-break so a batch still
    // spreads across shapes when two cells are equally thin.
    list.sort((a, b) => a.have_cell - b.have_cell || a.have_shape - b.have_shape ||
      (a.shape.size - b.shape.size) || (a.symmetry < b.symmetry ? -1 : 1));
  }

  // Then weave the shapes together inside each band, for the same reason the
  // bands are woven together below: a batch claims consecutive plans. On an
  // empty family every cell is equally thin, so the sort above falls through
  // to grid size and hands out all six symmetries of the smallest grid before
  // reaching the next size at all. Binairo's first refill produced 6x6 plans
  // for twenty of its first twenty-five. That is the corpus CLAUDE.md warns
  // about -- one puzzle repeated ten thousand times -- arriving by accident on
  // day one. Weaving costs nothing when the cells are unequal, because the
  // thinnest cell still sorts first within its shape.
  for (const [band, list] of byBand) {
    const byShape = new Map();
    for (const c of list) {
      const k = c.planner.shapeKey(c.shape);
      if (!byShape.has(k)) byShape.set(k, []);
      byShape.get(k).push(c);
    }
    // Each band starts the rotation at a different shape. Without the offset
    // every band's first plan is the smallest grid, and since a batch takes
    // one plan per band, its five plans come out as four 6x6s and whatever
    // shape band 5 happens to live on. With it, a batch spans five grid sizes.
    const buckets = [...byShape.values()];
    const start = (Number(band) - 1) % Math.max(1, buckets.length);
    const rotated = buckets.slice(start).concat(buckets.slice(0, start));
    const woven = [];
    for (let round = 0; ; round++) {
      let emitted = false;
      for (const bucket of rotated) {
        if (round < bucket.length) { woven.push(bucket[round]); emitted = true; }
      }
      if (!emitted) break;
    }
    byBand.set(band, woven);
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
  const planner = c.planner ?? PLANNERS[c.family];
  const scarce = c.plenty === 'scarce';
  const maxAttempts = scarce ? count * 400 : count * 60;
  const spec = {
    family: c.family,
    band: c.band,
    count,
    max_attempts: maxAttempts,
    params: planner.params(sh, c.band, c.symmetry),
  };
  const name = `${String(index).padStart(3, '0')}-${c.family}-b${c.band}-${planner.slug(sh)}-${c.symmetry}-${count}`;
  const bandNames = { 1: 'Gentle', 2: 'Easy', 3: 'Medium', 4: 'Hard', 5: 'Brutal' };
  const body = `# ${name}

Generate **${count}** ${c.family} puzzles in **band ${c.band} (${bandNames[c.band]})** on a
${planner.describe(sh)} with **${c.symmetry}** symmetry.

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
  // Families that may be planned for, and families that may be offered for
  // onboarding. The owner's instruction on 2026-09-19 was "no more sudoku pls,
  // different families moving forward", read as covering the boxed variants
  // too, which is the stricter reading and the one the owner was told of in
  // the build thread. The 2,498 sudoku records already in the corpus stay
  // exactly as they are: the instruction is about what gets generated next,
  // not about what has already been validated. See STATE.md, ## Standing
  // corrections. Nothing else is excluded, so a family is skipped here only
  // by an explicit owner instruction, never by a session's own judgement.
  const EXCLUDED = new Set(['sudoku-classic', 'killer-sudoku', 'thermo-sudoku', 'sandwich-sudoku']);

  const existing = existingPlanCells();
  const saturated = saturatedCells();
  const counts = corpusCounts();
  let index = nextIndex();
  const written = [];

  // At least one onboarding task while the roster is incomplete. A family whose
  // onboarding plan is already queued, in progress or blocked is skipped, so a
  // family that cannot be onboarded yet does not stop the next one from being
  // offered. Without this the whole roster stalls behind one blocked family.
  const missing = ROSTER.filter((f) => !FAMILIES.includes(f) && !EXCLUDED.has(f));
  const queued = (f) => [...existing].some((n) => n.includes(`onboard-${f}`));
  const target = missing.find((f) => !queued(f));
  if (target) {
    const o = onboardingBody(target, index);
    fs.writeFileSync(path.join(QUEUE, `${o.name}.md`), o.body);
    existing.add(cellOf(o.name));
    written.push(o.name);
    index++;
  }

  // Families that may be planned for. A family needs a planner here and an
  // onboarded solver, and sudoku-classic is excluded whatever else is true:
  // the owner's instruction on 2026-09-19 was "no more sudoku pls, different
  // families moving forward". Its 2,498 existing records stay exactly as they
  // are -- the instruction is about what gets generated next, not about what
  // has already been validated. See STATE.md under ## Standing corrections.
  const plannable = Object.keys(PLANNERS).filter((f) => FAMILIES.includes(f) && !EXCLUDED.has(f));

  // Round-robin across families, so a refill never hands the next batch five
  // plans from one family. CLAUDE.md caps a family at 40% of a batch, and with
  // one family onboarded that cap cannot be met; the interleave is what makes
  // it start being met the moment a second family exists.
  const perFamily = plannable.map((f) => candidatesFor(f, counts));
  const candidates = [];
  for (let round = 0; ; round++) {
    let emitted = false;
    for (const list of perFamily) {
      if (round < list.length) { candidates.push(list[round]); emitted = true; }
    }
    if (!emitted) break;
  }
  if (!candidates.length) {
    console.log('no plannable family: every onboarded family is excluded, or none has a planner');
  }
  let ci = 0;
  while (written.length < want && ci < candidates.length * 4) {
    const c = candidates[ci % candidates.length];
    ci++;
    // Sized so that the five plans a batch claims land inside the 200-400
    // accepted-puzzle target in CLAUDE.md, allowing for one of the five being
    // an onboarding task that produces no puzzles of its own.
    //
    // A scarce band gets the same count as a plentiful one. It used to get 20,
    // which held band 3 at 9.2% of the corpus against roughly 22.6% for every
    // other band. Scarcity is already paid for in the attempt budget, which is
    // 400 per puzzle rather than 60; the count was a second, unmeasured tax on
    // top of it. Batch 008 measured the real cost of a 60-puzzle band-3 plan at
    // 9x9: 3,326 attempts, 55 per puzzle, 14% of the budget it was given.
    const count = (c.planner ?? PLANNERS[c.family]).countFor(c);
    const { name, body } = planBody(c, count, index);
    const cell = cellOf(name);
    if (existing.has(cell) || saturated.has(cell)) continue;
    fs.writeFileSync(path.join(QUEUE, `${name}.md`), body);
    existing.add(cell);
    written.push(name);
    index++;
  }

  console.log(`wrote ${written.length} plan(s) to queue/`);
  for (const n of written) console.log(`  ${n}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
