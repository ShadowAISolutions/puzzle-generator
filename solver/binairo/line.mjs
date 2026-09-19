// Single-line reasoning for binairo, and the three line tiers built on it.
//
// A binairo line obeys two rules on its own -- never three of a symbol in a
// row, and exactly half of each symbol -- and one rule that involves the rest
// of the grid: no two rows may be identical, and no two columns may be
// identical. The first two are decided here. The third needs to know which
// other lines are already complete, so the caller passes those in.
//
// The three tiers differ in the machinery they reason with, not in what they
// are shown. That distinction matters: a tier defined by hiding information
// cannot iterate, and a tier whose rules are subsumed by a cheaper tier
// labels a band that does not exist.
//
//   tier 1  local_triples   a sliding window of three cells and nothing else:
//                           XX. is XXY, .XX is YXX, X.X is XYX
//   tier 2  line_counts     the above, plus the balance rule -- once a line
//                           holds half its length of one symbol, every
//                           remaining cell is the other
//   tier 3  line_enumerate  every completion of the line that satisfies both
//                           rules and differs from every finished line
//                           parallel to it, intersected
//
// Tier 3 is complete for a single line, so it subsumes the other two. Tier 4
// and band 5 are not line rules and live in solve.mjs.

export const UNKNOWN = 0;
export const ZERO = 1;
export const ONE = 2;

export const LINE_TIERS = { 1: 'local_triples', 2: 'line_counts', 3: 'line_enumerate' };

export const other = (v) => (v === ZERO ? ONE : ZERO);

// --- tier 1: the three-cell window ------------------------------------------

// Returns {ok, cells}. A cell is UNKNOWN where this rule decides nothing.
function localTriples(len, state) {
  const cells = new Int8Array(len);
  const at = (i) => (i >= 0 && i < len ? (cells[i] || state[i]) : UNKNOWN);
  const put = (i, v) => {
    if (i < 0 || i >= len) return true;
    const cur = at(i);
    if (cur === UNKNOWN) { cells[i] = v; return true; }
    return cur === v;
  };
  for (let i = 0; i + 1 < len; i++) {
    const a = at(i), b = at(i + 1);
    if (a !== UNKNOWN && a === b) {
      if (!put(i - 1, other(a))) return { ok: false, cells: null };
      if (!put(i + 2, other(a))) return { ok: false, cells: null };
    }
  }
  for (let i = 0; i + 2 < len; i++) {
    const a = at(i), c = at(i + 2);
    if (a !== UNKNOWN && a === c && at(i + 1) === UNKNOWN) {
      if (!put(i + 1, other(a))) return { ok: false, cells: null };
    }
  }
  // Three of a kind already on the board is a contradiction, not a deduction.
  for (let i = 0; i + 2 < len; i++) {
    const a = at(i);
    if (a !== UNKNOWN && a === at(i + 1) && a === at(i + 2)) return { ok: false, cells: null };
  }
  return { ok: true, cells };
}

// --- tier 2: the balance rule ------------------------------------------------

function lineCounts(len, state, cells) {
  const half = len / 2;
  let z = 0, o = 0;
  for (let i = 0; i < len; i++) {
    const v = cells[i] || state[i];
    if (v === ZERO) z++; else if (v === ONE) o++;
  }
  if (z > half || o > half) return false;
  const fill = z === half ? ONE : o === half ? ZERO : UNKNOWN;
  if (fill === UNKNOWN) return true;
  for (let i = 0; i < len; i++) if (!(cells[i] || state[i])) cells[i] = fill;
  return true;
}

// --- tier 3: enumerate the line ---------------------------------------------

// Every completion of `state` obeying both line rules. `forbidden` holds the
// encodings of finished lines parallel to this one, which this line may not
// repeat. Capped, because an all-unknown line of length 16 has 12,870
// balanced completions before the triple rule thins them and the caller must
// never be surprised by the cost.
export function lineCompletions(len, state, forbidden = null, cap = 200000) {
  const half = len / 2;
  const out = [];
  const buf = new Int8Array(len);
  const rec = (i, z, o) => {
    if (out.length >= cap) return;
    if (z > half || o > half) return;
    if (i === len) {
      if (forbidden && forbidden.has(keyOf(buf))) return;
      out.push(Int8Array.from(buf));
      return;
    }
    for (const v of [ZERO, ONE]) {
      if (state[i] !== UNKNOWN && state[i] !== v) continue;
      if (i >= 2 && buf[i - 1] === v && buf[i - 2] === v) continue;
      buf[i] = v;
      rec(i + 1, z + (v === ZERO ? 1 : 0), o + (v === ONE ? 1 : 0));
      buf[i] = UNKNOWN;
      if (out.length >= cap) return;
    }
  };
  rec(0, 0, 0);
  return out;
}

export function keyOf(cells) {
  let s = '';
  for (const v of cells) s += v === ZERO ? '0' : v === ONE ? '1' : '.';
  return s;
}

// --- the tier entry point ----------------------------------------------------

// Everything the given tier forces about a line. `forbidden` is only consulted
// at tier 3, because repeating a finished line is not something a person spots
// from a three-cell window or a running count.
export function lineDeduce(len, state, tier = 3, forbidden = null) {
  if (tier >= 3) {
    const all = lineCompletions(len, state, forbidden);
    if (!all.length) return { ok: false, cells: null };
    const cells = new Int8Array(len);
    for (let i = 0; i < len; i++) {
      if (state[i] !== UNKNOWN) continue;
      const v = all[0][i];
      let same = true;
      for (const c of all) if (c[i] !== v) { same = false; break; }
      if (same) cells[i] = v;
    }
    return { ok: true, cells };
  }

  const t1 = localTriples(len, state);
  if (!t1.ok) return { ok: false, cells: null };
  if (tier <= 1) return { ok: true, cells: t1.cells };
  if (!lineCounts(len, state, t1.cells)) return { ok: false, cells: null };
  // The fill may have created a triple the window had not seen yet.
  const merged = new Int8Array(len);
  for (let i = 0; i < len; i++) merged[i] = t1.cells[i] || state[i];
  for (let i = 0; i + 2 < len; i++) {
    const a = merged[i];
    if (a !== UNKNOWN && a === merged[i + 1] && a === merged[i + 2]) return { ok: false, cells: null };
  }
  return { ok: true, cells: t1.cells };
}
