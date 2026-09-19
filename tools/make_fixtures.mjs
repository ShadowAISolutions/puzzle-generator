#!/usr/bin/env node
// Build the fixture set for a family.
//
//   node tools/make_fixtures.mjs sudoku-classic
//
// A fixture is an instance with a known expected verdict. The verdict is never
// taken from the solver being tested -- it comes from the reference brute
// force, or from a structural argument that makes it obvious (an empty grid
// has many solutions; a grid with a digit twice in one row has none).
//
// Expected bands are a separate matter. A band is a property of the solver's
// own technique ladder, so it is recorded here at calibration time and then
// frozen, exactly so that a later change to the ladder shows up as a fixture
// failure instead of silently reclassifying the corpus.
//
// Deterministic: re-running this writes byte-identical files.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { writeJson, canonicalJson } from '../lib/jsonio.mjs';
import { solverFor } from '../solver/index.mjs';
import { generatorFor } from '../generators/index.mjs';
import { referenceFor } from '../solver/reference/index.mjs';
import { makeRng } from '../lib/prng.mjs';
import { BudgetExceeded } from '../lib/budget.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const ALPHABET = '123456789ABCDEFG';

// Puzzles that circulate widely enough to be worth testing against. They are
// research material: the verdict below is established here by the reference
// brute force, never copied from wherever the grid came from, and none of them
// ever enters corpus/. Sources go in fixtures/<family>/SOURCES.md.
const PUBLISHED = [
  {
    slug: 'wikipedia-sample',
    note: 'The sample grid used in the Wikipedia article on Sudoku.',
    params: { size: 9, box_h: 3, box_w: 3 },
    puzzle: '53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79',
  },
  {
    slug: 'inkala-escargot',
    note: 'Widely circulated as Arto Inkala\'s "AI Escargot".',
    params: { size: 9, box_h: 3, box_w: 3 },
    puzzle: '1....7.9..3..2...8..96..5....53..9...1..8...26....4...3......1..4......7..7...3..',
  },
  {
    slug: 'seventeen-clue',
    note: 'A seventeen-clue grid; seventeen is the proven minimum for a 9x9 with a unique solution.',
    params: { size: 9, box_h: 3, box_w: 3 },
    puzzle: '.......1.4.........2...........5.4.7..8...3....1.9....3..4..2...5.1........8.6...',
  },
  {
    slug: 'near-worst-case-backtracking',
    note: 'A grid constructed to be slow for naive row-major backtracking, commonly quoted as an anti-brute-force case.',
    params: { size: 9, box_h: 3, box_w: 3 },
    puzzle: '..............3.85..1.2.......5.7.....4...1...9.......5......73..2.1........4...9',
  },
];

function format(cells, size) {
  let s = '';
  for (const v of cells) s += v === 0 ? '.' : ALPHABET[v - 1];
  return s;
}

function main() {
  const family = process.argv[2] ?? 'sudoku-classic';
  const S = solverFor(family);
  const G = generatorFor(family);
  const R = referenceFor(family);
  const dir = path.join(ROOT, 'fixtures', family);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) fs.unlinkSync(path.join(dir, f));

  const fixtures = [];
  const rng = makeRng(`fixtures|${family}|1`);

  // The reference is the oracle for every verdict. If it cannot finish inside
  // its budget the fixture still earns its place: it becomes the case that
  // proves the gate rejects rather than waves through what it could not check.
  const oracle = (puzzle, params) => {
    try {
      const r = R.verdict(puzzle, params, { budget: S.makeBudgets(params).referenceBudget() });
      return { verdict: r.verdict, solution: r.count === 1 ? r.solutions[0] : null, reference: 'confirmed' };
    } catch (e) {
      if (e instanceof BudgetExceeded) return { verdict: null, solution: null, reference: 'budget-exceeded' };
      throw e;
    }
  };

  const add = (slug, source, note, params, puzzle, extra = {}) => {
    const o = oracle(puzzle, params);
    let band = null, techniques = null;
    if (o.verdict === 'unique') {
      const c = S.classify(puzzle, params);
      band = c.difficulty.band;
      techniques = c.difficulty.techniques;
    }
    fixtures.push({
      slug,
      source,
      note,
      params,
      puzzle,
      expect: {
        verdict: o.verdict,
        reference: o.reference,
        solution: o.solution,
        band,
        techniques,
      },
      ...extra,
    });
  };

  // --- degenerate shapes ----------------------------------------------------
  for (const shape of [{ size: 4, box_h: 2, box_w: 2 }, { size: 6, box_h: 2, box_w: 3 }, { size: 9, box_h: 3, box_w: 3 }]) {
    add(`degenerate-empty-${shape.size}`, 'constructed',
      'An empty grid. Every valid completion is a solution, so the verdict must be multiple.',
      shape, '.'.repeat(shape.size * shape.size));
  }

  // A fully filled valid grid: the maximum clue count, and trivially unique.
  const fullGrids = {};
  for (const shape of [{ size: 4, box_h: 2, box_w: 2 }, { size: 6, box_h: 2, box_w: 3 }, { size: 9, box_h: 3, box_w: 3 }]) {
    const gen = G.generate(`fixture-full-${shape.size}`, { ...shape, symmetry: 'none', min_clues: shape.size * shape.size, band_target: 1, dig_passes: 1 });
    const full = gen.solution;
    fullGrids[shape.size] = full;
    add(`degenerate-full-${shape.size}`, 'constructed',
      'A completely filled valid grid: the maximum clue count. Nothing is left to deduce.',
      shape, full);
  }

  // Contradictory grids: a digit twice in a row, a column, a box; and a full
  // grid with one cell changed.
  for (const shape of [{ size: 4, box_h: 2, box_w: 2 }, { size: 6, box_h: 2, box_w: 3 }, { size: 9, box_h: 3, box_w: 3 }]) {
    const n = shape.size;
    const rowDup = ('1' + '.'.repeat(n - 2) + '1').padEnd(n * n, '.');
    add(`contradiction-row-${n}`, 'constructed', 'The same symbol twice in one row. No completion can exist.', shape, rowDup);
    const colCells = new Array(n * n).fill('.');
    colCells[0] = '1'; colCells[(n - 1) * n] = '1';
    add(`contradiction-column-${n}`, 'constructed', 'The same symbol twice in one column.', shape, colCells.join(''));
    const boxCells = new Array(n * n).fill('.');
    boxCells[0] = '1'; boxCells[shape.box_w - 1 + n * (shape.box_h - 1)] = '1';
    add(`contradiction-box-${n}`, 'constructed', 'The same symbol twice in one box.', shape, boxCells.join(''));
    const full = fullGrids[n].split('');
    full[0] = full[0] === '1' ? '2' : '1';
    add(`contradiction-altered-full-${n}`, 'constructed', 'A complete valid grid with one cell overwritten, so the grid contradicts itself.', shape, full.join(''));
  }

  // --- unique instances across shapes and bands -----------------------------
  const shapes = [
    { size: 4, box_h: 2, box_w: 2, min: 4, bands: [1] },
    { size: 6, box_h: 2, box_w: 3, min: 8, bands: [1, 4, 5] },
    { size: 6, box_h: 3, box_w: 2, min: 8, bands: [1, 5] },
    { size: 8, box_h: 2, box_w: 4, min: 14, bands: [1, 5] },
    { size: 9, box_h: 3, box_w: 3, min: 17, bands: [1, 2, 3, 4, 5] },
  ];
  const uniques = [];
  for (const sh of shapes) {
    for (const band of sh.bands) {
      const params = { size: sh.size, box_h: sh.box_h, box_w: sh.box_w, symmetry: 'none', min_clues: sh.min, band_target: band, dig_passes: 6 };
      let made = 0;
      for (let attempt = 0; attempt < 4000 && made < 1; attempt++) {
        const g = G.generate(`fixture-u-${sh.size}-${sh.box_h}x${sh.box_w}-b${band}-${attempt}`, params);
        if (!g.puzzle) continue;
        const slug = `unique-${sh.size}-${sh.box_h}x${sh.box_w}-b${band}`;
        add(slug, 'generated',
          `A machine-generated instance with a unique solution, ${sh.size}x${sh.size} boxes ${sh.box_h}x${sh.box_w}, produced targeting band ${band}.`,
          { size: sh.size, box_h: sh.box_h, box_w: sh.box_w }, g.puzzle);
        uniques.push({ slug, params: { size: sh.size, box_h: sh.box_h, box_w: sh.box_w }, puzzle: g.puzzle, solution: g.solution });
        made++;
      }
      if (made === 0) console.warn(`  (no band-${band} instance found for ${sh.size} ${sh.box_h}x${sh.box_w}; skipping)`);
    }
  }

  // --- near misses ----------------------------------------------------------
  // A unique instance with one given removed, and with one given altered. The
  // reference decides what each actually is.
  const nearSources = uniques.filter((u) => u.params.size >= 6).slice(0, 6);
  for (const u of nearSources) {
    const given = [];
    for (let i = 0; i < u.puzzle.length; i++) if (u.puzzle[i] !== '.') given.push(i);
    const at = given[rng.int(given.length)];
    const removed = u.puzzle.slice(0, at) + '.' + u.puzzle.slice(at + 1);
    add(`nearmiss-removed-${u.slug}`, 'generated',
      `${u.slug} with one given removed. Removing a clue can only ever widen the solution set.`,
      u.params, removed, { derived_from: u.slug });

    const at2 = given[rng.int(given.length)];
    const alpha = ALPHABET.slice(0, u.params.size);
    let alt = alpha[(alpha.indexOf(u.puzzle[at2]) + 1) % u.params.size];
    const altered = u.puzzle.slice(0, at2) + alt + u.puzzle.slice(at2 + 1);
    add(`nearmiss-altered-${u.slug}`, 'generated',
      `${u.slug} with one given changed to a different symbol.`,
      u.params, altered, { derived_from: u.slug });
  }

  // --- multiple-solution instances -----------------------------------------
  // Dig a unique instance past the point of uniqueness.
  for (const u of uniques.filter((x) => x.params.size >= 6).slice(0, 6)) {
    const cells = u.puzzle.split('');
    const given = [];
    for (let i = 0; i < cells.length; i++) if (cells[i] !== '.') given.push(i);
    const drop = rng.shuffle(given.slice()).slice(0, Math.max(2, Math.floor(given.length * 0.25)));
    for (const i of drop) cells[i] = '.';
    add(`multiple-${u.slug}`, 'generated',
      `${u.slug} with a quarter of its givens removed, well past the point where the solution stops being forced.`,
      u.params, cells.join(''), { derived_from: u.slug });
  }

  // --- published ------------------------------------------------------------
  for (const p of PUBLISHED) {
    add(`published-${p.slug}`, 'published', p.note, p.params, p.puzzle);
  }

  // --- write ----------------------------------------------------------------
  fixtures.sort((a, b) => (a.slug < b.slug ? -1 : 1));
  for (const f of fixtures) writeJson(path.join(dir, `${f.slug}.json`), f);

  const byVerdict = {};
  const bySource = {};
  const byBand = {};
  for (const f of fixtures) {
    byVerdict[f.expect.verdict] = (byVerdict[f.expect.verdict] ?? 0) + 1;
    bySource[f.source] = (bySource[f.source] ?? 0) + 1;
    if (f.expect.band) byBand[f.expect.band] = (byBand[f.expect.band] ?? 0) + 1;
  }
  console.log(`wrote ${fixtures.length} fixtures to fixtures/${family}/`);
  console.log(`  verdicts: ${JSON.stringify(byVerdict)}`);
  console.log(`  sources:  ${JSON.stringify(bySource)}`);
  console.log(`  bands:    ${JSON.stringify(byBand)}`);
  return fixtures;
}

main();
