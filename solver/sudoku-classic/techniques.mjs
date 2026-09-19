// The technique ladder.
//
// Each technique inspects the candidate grid and, if it applies, makes at
// least one deduction and returns true. Returning false means "does not apply
// here"; returning CONTRADICTION means the grid is inconsistent.
//
// Every technique iterates in a fixed order over fixed index arrays. Nothing
// here consults a clock, a random source or a hash order, which is what makes
// the trace, and so the band, reproducible.
//
// Tiers map onto the five difficulty bands. The tier of a technique is its
// position on the ladder of human solving skill, and a puzzle's band is the
// highest tier the easiest complete path needs. Bands 1-4 are pure deduction;
// only band 5 permits search, and that is not a technique in this list.

import { CONTRADICTION, assign, eliminate, restrict } from './state.mjs';
import { bitCount, lowestBitIndex } from './geometry.mjs';

// ---------------------------------------------------------------- tier 1

function nakedSingle(st) {
  const g = st.g;
  for (let i = 0; i < g.cells; i++) {
    if (st.val[i] !== 0) continue;
    const c = st.cand[i];
    if (bitCount(c) !== 1) continue;
    const r = assign(st, i, lowestBitIndex(c) + 1);
    if (r === CONTRADICTION) return CONTRADICTION;
    if (r) return true;
  }
  return false;
}

function hiddenSingle(st) {
  const g = st.g;
  for (let ui = 0; ui < g.units.length; ui++) {
    const u = g.units[ui];
    for (let d = 1; d <= g.size; d++) {
      const bit = 1 << (d - 1);
      let where = -1, count = 0, placed = false;
      for (let k = 0; k < u.length; k++) {
        const i = u[k];
        if (st.val[i] === d) { placed = true; break; }
        if (st.val[i] === 0 && (st.cand[i] & bit)) { where = i; count++; if (count > 1) break; }
      }
      if (placed) continue;
      if (count === 0) return CONTRADICTION;
      if (count === 1) {
        const r = assign(st, where, d);
        if (r === CONTRADICTION) return CONTRADICTION;
        if (r) return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------- tier 2

// Candidates for d inside a box confined to one row or column: clear the rest
// of that line.
function lockedPointing(st) {
  const g = st.g;
  for (let b = 0; b < g.size; b++) {
    const u = g.units[2 * g.size + b];
    for (let d = 1; d <= g.size; d++) {
      const bit = 1 << (d - 1);
      let rows = 0, cols = 0, n = 0, placed = false;
      for (let k = 0; k < u.length; k++) {
        const i = u[k];
        if (st.val[i] === d) { placed = true; break; }
        if (st.val[i] === 0 && (st.cand[i] & bit)) { rows |= 1 << g.rowOf[i]; cols |= 1 << g.colOf[i]; n++; }
      }
      if (placed || n < 2) continue;
      let changed = false;
      if (bitCount(rows) === 1) {
        const r = lowestBitIndex(rows);
        const line = g.units[r];
        for (let k = 0; k < line.length; k++) {
          const i = line[k];
          if (g.boxOf[i] === b) continue;
          const res = eliminate(st, i, d);
          if (res === CONTRADICTION) return CONTRADICTION;
          if (res) changed = true;
        }
      }
      if (bitCount(cols) === 1) {
        const c = lowestBitIndex(cols);
        const line = g.units[g.size + c];
        for (let k = 0; k < line.length; k++) {
          const i = line[k];
          if (g.boxOf[i] === b) continue;
          const res = eliminate(st, i, d);
          if (res === CONTRADICTION) return CONTRADICTION;
          if (res) changed = true;
        }
      }
      if (changed) return true;
    }
  }
  return false;
}

// Candidates for d inside a row or column confined to one box: clear the rest
// of that box.
function lockedClaiming(st) {
  const g = st.g;
  for (let li = 0; li < 2 * g.size; li++) {
    const u = g.units[li];
    for (let d = 1; d <= g.size; d++) {
      const bit = 1 << (d - 1);
      let boxes = 0, n = 0, placed = false;
      for (let k = 0; k < u.length; k++) {
        const i = u[k];
        if (st.val[i] === d) { placed = true; break; }
        if (st.val[i] === 0 && (st.cand[i] & bit)) { boxes |= 1 << g.boxOf[i]; n++; }
      }
      if (placed || n < 2 || bitCount(boxes) !== 1) continue;
      const b = lowestBitIndex(boxes);
      const box = g.units[2 * g.size + b];
      let changed = false;
      for (let k = 0; k < box.length; k++) {
        const i = box[k];
        if (g.unitsOf[i][li < g.size ? 0 : 1] === li) continue;
        const res = eliminate(st, i, d);
        if (res === CONTRADICTION) return CONTRADICTION;
        if (res) changed = true;
      }
      if (changed) return true;
    }
  }
  return false;
}

// k cells in a unit whose candidate union is exactly k digits: no other cell
// in the unit can hold any of them.
function nakedSubset(k) {
  return function (st) {
    const g = st.g;
    for (let ui = 0; ui < g.units.length; ui++) {
      const u = g.units[ui];
      const open = [];
      for (let idx = 0; idx < u.length; idx++) {
        const i = u[idx];
        if (st.val[i] === 0 && bitCount(st.cand[i]) <= k) open.push(i);
      }
      if (open.length <= k) continue;
      const combo = new Array(k);
      const rec = (start, depth, mask) => {
        if (bitCount(mask) > k) return false;
        if (depth === k) {
          if (bitCount(mask) !== k) return false;
          let changed = false;
          for (let idx = 0; idx < u.length; idx++) {
            const i = u[idx];
            if (st.val[i] !== 0 || combo.includes(i)) continue;
            for (let d = 1; d <= g.size; d++) {
              if ((mask & (1 << (d - 1))) === 0) continue;
              const r = eliminate(st, i, d);
              if (r === CONTRADICTION) return CONTRADICTION;
              if (r) changed = true;
            }
          }
          return changed;
        }
        for (let s = start; s < open.length; s++) {
          combo[depth] = open[s];
          const r = rec(s + 1, depth + 1, mask | st.cand[open[s]]);
          if (r === CONTRADICTION) return CONTRADICTION;
          if (r) return true;
        }
        return false;
      };
      const r = rec(0, 0, 0);
      if (r === CONTRADICTION) return CONTRADICTION;
      if (r) return true;
    }
    return false;
  };
}

// k digits in a unit confined to exactly k cells: those cells hold nothing
// else.
function hiddenSubset(k) {
  return function (st) {
    const g = st.g;
    for (let ui = 0; ui < g.units.length; ui++) {
      const u = g.units[ui];
      const cellsOf = new Int32Array(g.size + 1);
      const live = [];
      for (let d = 1; d <= g.size; d++) {
        const bit = 1 << (d - 1);
        let m = 0, placed = false;
        for (let idx = 0; idx < u.length; idx++) {
          const i = u[idx];
          if (st.val[i] === d) { placed = true; break; }
          if (st.val[i] === 0 && (st.cand[i] & bit)) m |= 1 << idx;
        }
        if (placed || m === 0) continue;
        cellsOf[d] = m;
        if (bitCount(m) <= k) live.push(d);
      }
      if (live.length < k) continue;
      const combo = new Array(k);
      const rec = (start, depth, mask) => {
        if (bitCount(mask) > k) return false;
        if (depth === k) {
          if (bitCount(mask) !== k) return false;
          let digitMask = 0;
          for (const d of combo) digitMask |= 1 << (d - 1);
          let changed = false;
          for (let idx = 0; idx < u.length; idx++) {
            if ((mask & (1 << idx)) === 0) continue;
            const r = restrict(st, u[idx], digitMask);
            if (r === CONTRADICTION) return CONTRADICTION;
            if (r) changed = true;
          }
          return changed;
        }
        for (let s = start; s < live.length; s++) {
          combo[depth] = live[s];
          const r = rec(s + 1, depth + 1, mask | cellsOf[live[s]]);
          if (r === CONTRADICTION) return CONTRADICTION;
          if (r) return true;
        }
        return false;
      };
      const r = rec(0, 0, 0);
      if (r === CONTRADICTION) return CONTRADICTION;
      if (r) return true;
    }
    return false;
  };
}

// ---------------------------------------------------------------- fish

// k base lines whose candidate positions for d span exactly k cover lines:
// inside those cover lines, d can only sit on the base lines.
// k = 2 is an X-wing, 3 a swordfish, 4 a jellyfish.
function fish(k) {
  return function (st) {
    const g = st.g;
    const n = g.size;
    for (let orient = 0; orient < 2; orient++) {
      const baseOff = orient === 0 ? 0 : n;      // rows as base, then columns
      const coverOff = orient === 0 ? n : 0;
      for (let d = 1; d <= n; d++) {
        const bit = 1 << (d - 1);
        const posOf = new Int32Array(n);
        const live = [];
        for (let b = 0; b < n; b++) {
          const u = g.units[baseOff + b];
          let m = 0, placed = false;
          for (let idx = 0; idx < u.length; idx++) {
            const i = u[idx];
            if (st.val[i] === d) { placed = true; break; }
            if (st.val[i] === 0 && (st.cand[i] & bit)) m |= 1 << idx;
          }
          if (placed) continue;
          const c = bitCount(m);
          if (c >= 2 && c <= k) { posOf[b] = m; live.push(b); }
        }
        if (live.length < k) continue;
        const combo = new Array(k);
        const rec = (start, depth, mask) => {
          if (bitCount(mask) > k) return false;
          if (depth === k) {
            if (bitCount(mask) !== k) return false;
            let changed = false;
            for (let idx = 0; idx < n; idx++) {
              if ((mask & (1 << idx)) === 0) continue;
              const cover = g.units[coverOff + idx];
              for (let j = 0; j < cover.length; j++) {
                const i = cover[j];
                if (combo.includes(orient === 0 ? g.rowOf[i] : g.colOf[i])) continue;
                const r = eliminate(st, i, d);
                if (r === CONTRADICTION) return CONTRADICTION;
                if (r) changed = true;
              }
            }
            return changed;
          }
          for (let s = start; s < live.length; s++) {
            combo[depth] = live[s];
            const r = rec(s + 1, depth + 1, mask | posOf[live[s]]);
            if (r === CONTRADICTION) return CONTRADICTION;
            if (r) return true;
          }
          return false;
        };
        const r = rec(0, 0, 0);
        if (r === CONTRADICTION) return CONTRADICTION;
        if (r) return true;
      }
    }
    return false;
  };
}

// ---------------------------------------------------------------- wings

function sharePeer(g, a, b) {
  if (a === b) return false;
  return g.rowOf[a] === g.rowOf[b] || g.colOf[a] === g.colOf[b] || g.boxOf[a] === g.boxOf[b];
}

// Pivot {x,y}; pincers {x,z} and {y,z} both seeing the pivot. Any cell seeing
// both pincers cannot be z.
function xyWing(st) {
  const g = st.g;
  const bi = [];
  for (let i = 0; i < g.cells; i++) if (st.val[i] === 0 && bitCount(st.cand[i]) === 2) bi.push(i);
  for (const p of bi) {
    const pc = st.cand[p];
    for (const a of bi) {
      if (a === p || !sharePeer(g, p, a)) continue;
      const ac = st.cand[a];
      if (bitCount(pc & ac) !== 1 || ac === pc) continue;
      for (const b of bi) {
        if (b === p || b === a || !sharePeer(g, p, b)) continue;
        const bc = st.cand[b];
        if (bc === pc || bc === ac) continue;
        if (bitCount(pc & bc) !== 1) continue;
        if ((pc & ac) === (pc & bc)) continue;   // pincers must take different pivot digits
        const z = ac & bc & ~pc;
        if (bitCount(z) !== 1) continue;
        const zd = lowestBitIndex(z) + 1;
        let changed = false;
        for (let i = 0; i < g.cells; i++) {
          if (i === a || i === b || i === p || st.val[i] !== 0) continue;
          if (!sharePeer(g, i, a) || !sharePeer(g, i, b)) continue;
          const r = eliminate(st, i, zd);
          if (r === CONTRADICTION) return CONTRADICTION;
          if (r) changed = true;
        }
        if (changed) return true;
      }
    }
  }
  return false;
}

// Pivot {x,y,z}; pincers {x,z} and {y,z} seeing the pivot. Any cell seeing all
// three cannot be z.
function xyzWing(st) {
  const g = st.g;
  const tri = [], bi = [];
  for (let i = 0; i < g.cells; i++) {
    if (st.val[i] !== 0) continue;
    const n = bitCount(st.cand[i]);
    if (n === 3) tri.push(i);
    else if (n === 2) bi.push(i);
  }
  for (const p of tri) {
    const pc = st.cand[p];
    for (const a of bi) {
      if (!sharePeer(g, p, a) || (st.cand[a] & ~pc) !== 0) continue;
      for (const b of bi) {
        if (b === a || !sharePeer(g, p, b) || (st.cand[b] & ~pc) !== 0) continue;
        if (st.cand[a] === st.cand[b]) continue;
        const z = st.cand[a] & st.cand[b];
        if (bitCount(z) !== 1) continue;
        if ((st.cand[a] | st.cand[b]) !== pc) continue;
        const zd = lowestBitIndex(z) + 1;
        let changed = false;
        for (let i = 0; i < g.cells; i++) {
          if (i === a || i === b || i === p || st.val[i] !== 0) continue;
          if (!sharePeer(g, i, a) || !sharePeer(g, i, b) || !sharePeer(g, i, p)) continue;
          const r = eliminate(st, i, zd);
          if (r === CONTRADICTION) return CONTRADICTION;
          if (r) changed = true;
        }
        if (changed) return true;
      }
    }
  }
  return false;
}

// Two non-peer cells both {x,y}, plus a unit where x sits in exactly two cells,
// one seeing each of them. Then one of the pair must be x, so neither can be y
// in any cell they both see.
function wWing(st) {
  const g = st.g;
  const bi = [];
  for (let i = 0; i < g.cells; i++) if (st.val[i] === 0 && bitCount(st.cand[i]) === 2) bi.push(i);
  for (let ai = 0; ai < bi.length; ai++) {
    for (let bj = ai + 1; bj < bi.length; bj++) {
      const a = bi[ai], b = bi[bj];
      if (st.cand[a] !== st.cand[b] || sharePeer(g, a, b)) continue;
      const digits = [];
      for (let d = 1; d <= g.size; d++) if (st.cand[a] & (1 << (d - 1))) digits.push(d);
      for (const x of digits) {
        const y = digits[0] === x ? digits[1] : digits[0];
        const xbit = 1 << (x - 1);
        for (let ui = 0; ui < g.units.length; ui++) {
          const u = g.units[ui];
          const spots = [];
          let placed = false;
          for (let k = 0; k < u.length; k++) {
            const i = u[k];
            if (st.val[i] === x) { placed = true; break; }
            if (st.val[i] === 0 && (st.cand[i] & xbit)) spots.push(i);
          }
          if (placed || spots.length !== 2) continue;
          const [s1, s2] = spots;
          if (s1 === a || s1 === b || s2 === a || s2 === b) continue;
          const linksA = sharePeer(g, s1, a) && sharePeer(g, s2, b);
          const linksB = sharePeer(g, s2, a) && sharePeer(g, s1, b);
          if (!linksA && !linksB) continue;
          let changed = false;
          for (let i = 0; i < g.cells; i++) {
            if (i === a || i === b || st.val[i] !== 0) continue;
            if (!sharePeer(g, i, a) || !sharePeer(g, i, b)) continue;
            const r = eliminate(st, i, y);
            if (r === CONTRADICTION) return CONTRADICTION;
            if (r) changed = true;
          }
          if (changed) return true;
        }
      }
    }
  }
  return false;
}

// Single-digit colouring over conjugate pairs. Two cells of one colour that
// see each other kill that colour; a cell seeing both colours cannot be d.
function simpleColoring(st) {
  const g = st.g;
  for (let d = 1; d <= g.size; d++) {
    const bit = 1 << (d - 1);
    const adj = new Map();
    const has = (i) => st.val[i] === 0 && (st.cand[i] & bit) !== 0;
    for (let ui = 0; ui < g.units.length; ui++) {
      const u = g.units[ui];
      const spots = [];
      let placed = false;
      for (let k = 0; k < u.length; k++) {
        const i = u[k];
        if (st.val[i] === d) { placed = true; break; }
        if (has(i)) spots.push(i);
      }
      if (placed || spots.length !== 2) continue;
      const [a, b] = spots;
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      if (!adj.get(a).includes(b)) adj.get(a).push(b);
      if (!adj.get(b).includes(a)) adj.get(b).push(a);
    }
    const nodes = [...adj.keys()].sort((x, y) => x - y);
    const colour = new Map();
    for (const start of nodes) {
      if (colour.has(start)) continue;
      const comp = [];
      colour.set(start, 0);
      const queue = [start];
      while (queue.length) {
        const cur = queue.shift();
        comp.push(cur);
        for (const nb of adj.get(cur).slice().sort((x, y) => x - y)) {
          if (!colour.has(nb)) { colour.set(nb, 1 - colour.get(cur)); queue.push(nb); }
        }
      }
      if (comp.length < 4) continue;
      const groups = [[], []];
      for (const i of comp.slice().sort((x, y) => x - y)) groups[colour.get(i)].push(i);

      // Rule 1: a colour that sees itself is false everywhere.
      for (let cIdx = 0; cIdx < 2; cIdx++) {
        const grp = groups[cIdx];
        let selfSeeing = false;
        for (let p = 0; p < grp.length && !selfSeeing; p++) {
          for (let q = p + 1; q < grp.length; q++) {
            if (sharePeer(g, grp[p], grp[q])) { selfSeeing = true; break; }
          }
        }
        if (!selfSeeing) continue;
        let changed = false;
        for (const i of grp) {
          const r = eliminate(st, i, d);
          if (r === CONTRADICTION) return CONTRADICTION;
          if (r) changed = true;
        }
        if (changed) return true;
      }

      // Rule 2: an outside cell seeing both colours cannot be d.
      let changed = false;
      for (let i = 0; i < g.cells; i++) {
        if (!has(i) || colour.has(i)) continue;
        let seesA = false, seesB = false;
        for (const j of groups[0]) if (sharePeer(g, i, j)) { seesA = true; break; }
        if (!seesA) continue;
        for (const j of groups[1]) if (sharePeer(g, i, j)) { seesB = true; break; }
        if (!seesB) continue;
        const r = eliminate(st, i, d);
        if (r === CONTRADICTION) return CONTRADICTION;
        if (r) changed = true;
      }
      if (changed) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- the ladder

export const TECHNIQUES = [
  { name: 'naked_single', tier: 1, apply: nakedSingle },
  { name: 'hidden_single', tier: 1, apply: hiddenSingle },

  { name: 'locked_candidates_pointing', tier: 2, apply: lockedPointing },
  { name: 'locked_candidates_claiming', tier: 2, apply: lockedClaiming },
  { name: 'naked_pair', tier: 2, apply: nakedSubset(2) },
  { name: 'hidden_pair', tier: 2, apply: hiddenSubset(2) },

  { name: 'naked_triple', tier: 3, apply: nakedSubset(3) },
  { name: 'hidden_triple', tier: 3, apply: hiddenSubset(3) },
  { name: 'x_wing', tier: 3, apply: fish(2) },
  { name: 'naked_quad', tier: 3, apply: nakedSubset(4) },
  { name: 'hidden_quad', tier: 3, apply: hiddenSubset(4) },

  { name: 'swordfish', tier: 4, apply: fish(3) },
  { name: 'xy_wing', tier: 4, apply: xyWing },
  { name: 'xyz_wing', tier: 4, apply: xyzWing },
  { name: 'w_wing', tier: 4, apply: wWing },
  { name: 'jellyfish', tier: 4, apply: fish(4) },
  { name: 'simple_coloring', tier: 4, apply: simpleColoring },
];

export const MAX_DEDUCTION_TIER = 4;

export const TECHNIQUE_NAMES = TECHNIQUES.map((t) => t.name);

export const TIER_OF = Object.fromEntries(TECHNIQUES.map((t) => [t.name, t.tier]));
