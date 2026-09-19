#!/usr/bin/env node
// Regenerate index.html, corpus.json and the per-family indexes from corpus/.
//
//   node tools/build_index.mjs
//
// Everything this writes is derived from the records on disk. Nothing here is
// hand-maintained, and nothing here is authoritative: if the index and the
// records disagree, the records are right and this should be re-run.
//
// The site has no build step and makes no external request, so the downloads
// it offers are written here as plain JSON next to the pages that use them.

import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, walk, canonicalJson } from '../lib/jsonio.mjs';
import { solverFor, FAMILIES } from '../solver/index.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CORPUS = path.join(ROOT, 'corpus');
const DOWNLOADS = path.join(ROOT, 'downloads');

const BAND_NAMES = { 1: 'Gentle', 2: 'Easy', 3: 'Medium', 4: 'Hard', 5: 'Brutal' };

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function collect() {
  const byFamily = new Map();
  for (const p of walk(CORPUS, (f) => f.endsWith('.json') && !f.endsWith('family.json'))) {
    let rec;
    try { rec = readJson(p); } catch { continue; }
    if (!rec?.family) continue;
    if (!byFamily.has(rec.family)) byFamily.set(rec.family, []);
    byFamily.get(rec.family).push(rec);
  }
  for (const list of byFamily.values()) list.sort((a, b) => (a.id < b.id ? -1 : 1));
  return byFamily;
}

// How a family's grid shape reads in an index row. A sudoku is described by
// its box tiling; a family without boxes is described by its grid, and saying
// "undefinedxundefined" for it would be worse than saying nothing.
function shapeLabel(rec) {
  const p = rec.params ?? {};
  if (p.box_h != null && p.box_w != null) return `${p.box_h}x${p.box_w}`;
  if (p.rows != null && p.cols != null) return `${p.rows}x${p.cols}`;
  if (p.size != null) return `${p.size}x${p.size}`;
  return '';
}

// One compact row per puzzle. Kept small on purpose: a family index must stay
// under 5MB, and these are what the browse page filters over.
function row(rec) {
  return {
    id: rec.id,
    band: rec.difficulty.band,
    score: rec.difficulty.score,
    clues: rec.clues,
    size: rec.params.size,
    box: shapeLabel(rec),
    depth: rec.difficulty.max_search_depth,
  };
}

function main() {
  const byFamily = collect();
  const families = [...byFamily.keys()].sort();
  fs.mkdirSync(DOWNLOADS, { recursive: true });

  // Deliberately no timestamp: everything this writes is a pure function of the
  // records on disk, so CI can rebuild it and diff it to prove it is current.
  const summary = { families: [], totals: { puzzles: 0, by_band: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } } };

  for (const family of families) {
    const list = byFamily.get(family);
    const S = FAMILIES.includes(family) ? solverFor(family) : null;

    // The manifest is regenerated from the solver adapter, never hand-written.
    if (S) writeJson(path.join(CORPUS, family, 'family.json'), S.manifest());

    const byBand = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    const sizes = new Map();
    let clueMin = Infinity, clueMax = -Infinity;
    for (const rec of list) {
      byBand[rec.difficulty.band].push(row(rec));
      const p = rec.params;
      const k = p.box_h != null && p.box_w != null
        ? `${p.size}x${p.size} (${p.box_h}x${p.box_w})`
        : p.rows != null && p.cols != null ? `${p.rows}x${p.cols}` : `${p.size}x${p.size}`;
      sizes.set(k, (sizes.get(k) ?? 0) + 1);
      clueMin = Math.min(clueMin, rec.clues);
      clueMax = Math.max(clueMax, rec.clues);
    }

    // Per-family index, and per-band bundles for download.
    const famIndex = {
      family,
      count: list.length,
      by_band: Object.fromEntries(Object.entries(byBand).map(([b, r]) => [b, r.length])),
      clue_range: list.length ? [clueMin, clueMax] : null,
      shapes: Object.fromEntries([...sizes.entries()].sort()),
      puzzles: list.map(row),
    };
    writeJson(path.join(DOWNLOADS, `${family}.json`), famIndex);
    for (const [band, rows] of Object.entries(byBand)) {
      if (!rows.length) continue;
      const full = list.filter((r) => r.difficulty.band === Number(band));
      writeJson(path.join(DOWNLOADS, `${family}-b${band}.json`), { family, band: Number(band), count: full.length, puzzles: full });
    }

    summary.families.push({
      family,
      display_name: S ? S.manifest().display_name : family,
      count: list.length,
      by_band: famIndex.by_band,
      clue_range: famIndex.clue_range,
      shapes: famIndex.shapes,
      player: `site/play/${family}.html`,
      index: `downloads/${family}.json`,
    });
    summary.totals.puzzles += list.length;
    for (const [b, n] of Object.entries(famIndex.by_band)) summary.totals.by_band[b] += n;
  }

  writeJson(path.join(ROOT, 'corpus.json'), summary);
  fs.writeFileSync(path.join(ROOT, 'index.html'), renderIndex(summary, byFamily));
  console.log(`built index: ${summary.totals.puzzles} puzzles across ${families.length} famil${families.length === 1 ? 'y' : 'ies'}`);
  console.log(`  by band: ${JSON.stringify(summary.totals.by_band)}`);
}

function renderIndex(summary, byFamily) {
  const famRows = summary.families.map((f) => {
    const bands = Object.entries(f.by_band).map(([b, n]) => `<td class="num">${n.toLocaleString('en')}</td>`).join('');
    return `<tr><th scope="row"><a href="${esc(f.player)}">${esc(f.display_name)}</a></th>${bands}<td class="num"><b>${f.count.toLocaleString('en')}</b></td></tr>`;
  }).join('\n        ');

  const totalBands = Object.entries(summary.totals.by_band).map(([b, n]) => `<td class="num">${n.toLocaleString('en')}</td>`).join('');

  // The browse table's data goes inline, so the page needs no network at all.
  const inline = JSON.stringify({
    families: summary.families.map((f) => ({ family: f.family, display_name: f.display_name, player: f.player })),
    puzzles: [...byFamily.entries()].flatMap(([family, list]) =>
      list.map((r) => [family, r.id, r.difficulty.band, r.clues, r.params.size, shapeLabel(r), r.difficulty.score])),
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Puzzle Corpus — logic puzzles with a proven unique solution</title>
<meta name="description" content="A machine-generated corpus of logic puzzles. Every puzzle has been validated by an independent solver for solvability, solution uniqueness and difficulty band.">
<style>
  :root {
    color-scheme: light dark;
    --bg:#fbfaf8; --panel:#fff; --ink:#1c1b19; --ink-soft:#5c584f; --line:#d8d3c8;
    --line-strong:#46433c; --accent:#2f6f57; --focus:#b9822c; --radius:10px;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#16151a; --panel:#1f1e24; --ink:#eceaf2; --ink-soft:#a5a1b0; --line:#3a3843;
            --line-strong:#8c8798; --accent:#7fd3ab; --focus:#e0b45f; }
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%}
  .wrap{max-width:900px;margin:0 auto;padding:32px 16px 72px}
  h1{font-size:1.7rem;margin:0 0 6px;letter-spacing:-0.02em}
  h2{font-size:1.05rem;margin:36px 0 10px;letter-spacing:-0.01em}
  .lede{color:var(--ink-soft);margin:0 0 4px;max-width:62ch}
  a{color:var(--accent)}
  table{border-collapse:collapse;width:100%;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;font-size:0.92rem}
  th,td{padding:9px 12px;text-align:left;border-bottom:1px solid var(--line)}
  thead th{font-size:0.74rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--ink-soft);font-weight:600}
  tbody tr:last-child td,tbody tr:last-child th{border-bottom:0}
  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
  tfoot td,tfoot th{border-top:2px solid var(--line-strong);font-weight:600}
  .controls{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 14px;align-items:flex-end}
  .field{display:flex;flex-direction:column;gap:3px}
  .field label{font-size:0.74rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--ink-soft)}
  select,input{font:inherit;padding:7px 9px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink);min-height:40px}
  select:focus-visible,input:focus-visible,a:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
  .count{color:var(--ink-soft);font-size:0.88rem;margin:10px 0}
  .note{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:16px 18px;color:var(--ink-soft);font-size:0.88rem}
  .note h2{margin-top:0;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--ink)}
  .note p{margin:0 0 9px} .note p:last-child{margin-bottom:0}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:0.9em}
  ul.dl{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:8px}
  ul.dl a{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:4px 12px;text-decoration:none;font-size:0.85rem;background:var(--panel)}
  @media(max-width:520px){ .wrap{padding:20px 12px 56px} th,td{padding:8px} }
</style>
</head>
<body>
<div class="wrap">
  <h1>Puzzle Corpus</h1>
  <p class="lede">Machine-generated logic puzzles. <strong>Every one has been validated by an independent
    solver</strong> for solvability, solution uniqueness and difficulty band, before it entered this corpus.</p>

  <h2>What is here</h2>
  <table>
    <thead><tr><th scope="col">Family</th><th scope="col" class="num">1 Gentle</th><th scope="col" class="num">2 Easy</th><th scope="col" class="num">3 Medium</th><th scope="col" class="num">4 Hard</th><th scope="col" class="num">5 Brutal</th><th scope="col" class="num">Total</th></tr></thead>
    <tbody>
        ${famRows || '<tr><td colspan="7">No puzzles yet.</td></tr>'}
    </tbody>
    <tfoot><tr><th scope="row">All families</th>${totalBands}<td class="num">${summary.totals.puzzles.toLocaleString('en')}</td></tr></tfoot>
  </table>

  <h2>Browse</h2>
  <div class="controls">
    <div class="field"><label for="f-family">Family</label><select id="f-family"><option value="">All</option></select></div>
    <div class="field"><label for="f-band">Band</label><select id="f-band"><option value="">All</option><option value="1">1 Gentle</option><option value="2">2 Easy</option><option value="3">3 Medium</option><option value="4">4 Hard</option><option value="5">5 Brutal</option></select></div>
    <div class="field"><label for="f-size">Grid</label><select id="f-size"><option value="">All</option></select></div>
    <div class="field"><label for="f-cmin">Clues from</label><input id="f-cmin" type="number" inputmode="numeric" min="0" step="1" style="width:7.5em"></div>
    <div class="field"><label for="f-cmax">to</label><input id="f-cmax" type="number" inputmode="numeric" min="0" step="1" style="width:7.5em"></div>
  </div>
  <p class="count" id="count" role="status" aria-live="polite"></p>
  <table>
    <thead><tr><th scope="col">Puzzle</th><th scope="col">Family</th><th scope="col" class="num">Band</th><th scope="col" class="num">Grid</th><th scope="col" class="num">Clues</th><th scope="col" class="num">Score</th></tr></thead>
    <tbody id="rows"></tbody>
  </table>

  <h2>Download</h2>
  <p class="lede">Use the corpus without cloning the repository. <code>corpus.json</code> is the corpus-wide index;
    the rest are per-family and per-band bundles of whole records.</p>
  <ul class="dl">
    <li><a href="corpus.json">corpus.json</a></li>
    ${summary.families.map((f) => `<li><a href="downloads/${esc(f.family)}.json">${esc(f.family)} index</a></li>` +
      Object.entries(f.by_band).filter(([, n]) => n > 0).map(([b]) => `<li><a href="downloads/${esc(f.family)}-b${b}.json">${esc(f.family)} band ${b}</a></li>`).join('')).join('\n    ')}
  </ul>

  <h2>The guarantee</h2>
  <div class="note">
    <p>Every puzzle here is <strong>machine-generated</strong> by this repository. It was then checked by an
      <strong>independent solver</strong>, which shares no code with the generator: the solver imports nothing
      from the generator, and continuous integration fails the build if that ever changes.</p>
    <p>Uniqueness is <strong>proven by exhaustive counting</strong>. The solver counts solutions and stops at
      two, so "unique" means the search established that a second solution cannot exist, not that it failed to
      find one. A separate brute-force reference — deliberately slow, with no heuristics — confirms the verdict
      independently.</p>
    <p>Difficulty is <strong>measured by technique</strong>, not asserted by the generator. A puzzle's band is
      the highest technique tier needed by the easiest complete solution path the solver can find. Bands 1 to 4
      need no guessing at all. Band 5 is the only band that requires bounded search, and every band-5 record
      carries the search depth it needed.</p>
    <p><strong>What this does not cover:</strong> the guarantee is about solvability, uniqueness and the measured
      band. It is not a claim that a puzzle is enjoyable, that its band matches any other publisher's scale, or
      that the band would be identical under a different technique ladder — the ladder is published in each
      family's <code>family.json</code> and frozen.</p>
  </div>
</div>

<script id="data" type="application/json">${inline.replace(/</g, '\\u003c')}</script>
<script>
(function(){
  'use strict';
  var DATA = JSON.parse(document.getElementById('data').textContent);
  var BANDS = {1:'1 Gentle',2:'2 Easy',3:'3 Medium',4:'4 Hard',5:'5 Brutal'};
  var players = {};
  var famSel = document.getElementById('f-family');
  DATA.families.forEach(function(f){
    players[f.family] = f.player;
    var o = document.createElement('option'); o.value = f.family; o.textContent = f.display_name; famSel.appendChild(o);
  });
  var sizes = {};
  DATA.puzzles.forEach(function(p){ sizes[p[4] + 'x' + p[4] + ' (' + p[5] + ')'] = p[4]; });
  var sizeSel = document.getElementById('f-size');
  Object.keys(sizes).sort().forEach(function(k){ var o=document.createElement('option'); o.value=k; o.textContent=k; sizeSel.appendChild(o); });

  var els = ['f-family','f-band','f-size','f-cmin','f-cmax'].map(function(id){ return document.getElementById(id); });
  var rows = document.getElementById('rows');
  var count = document.getElementById('count');
  var LIMIT = 300;

  function draw(){
    var fam = els[0].value, band = els[1].value, size = els[2].value;
    var cmin = els[3].value === '' ? -Infinity : Number(els[3].value);
    var cmax = els[4].value === '' ? Infinity : Number(els[4].value);
    var hits = DATA.puzzles.filter(function(p){
      if (fam && p[0] !== fam) return false;
      if (band && String(p[2]) !== band) return false;
      if (size && (p[4] + 'x' + p[4] + ' (' + p[5] + ')') !== size) return false;
      return p[3] >= cmin && p[3] <= cmax;
    });
    count.textContent = hits.length.toLocaleString('en') + ' puzzle' + (hits.length === 1 ? '' : 's') +
      (hits.length > LIMIT ? ' — showing the first ' + LIMIT : '');
    var html = '';
    hits.slice(0, LIMIT).forEach(function(p){
      var href = players[p[0]] + '?id=' + p[1] + '&band=' + p[2] + '&family=' + p[0];
      html += '<tr><th scope="row"><a href="' + href + '"><code>' + p[1] + '</code></a></th>' +
        '<td>' + p[0] + '</td><td class="num">' + BANDS[p[2]] + '</td><td class="num">' + p[4] + '&times;' + p[4] +
        '</td><td class="num">' + p[3] + '</td><td class="num">' + p[6] + '</td></tr>';
    });
    rows.innerHTML = html || '<tr><td colspan="6">Nothing matches those filters.</td></tr>';
  }
  els.forEach(function(e){ e.addEventListener('input', draw); e.addEventListener('change', draw); });
  draw();
})();
</script>
</body>
</html>
`;
}

main();
