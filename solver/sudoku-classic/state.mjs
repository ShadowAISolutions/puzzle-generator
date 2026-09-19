// Candidate-grid state and the two primitive operations on it.
//
// Elimination deliberately does not cascade. Propagating a single is the job
// of the naked_single / hidden_single techniques, which the solver records in
// its trace; if eliminate() quietly did it too, the trace would no longer be
// an honest account of what was needed and the band would be wrong.

import { geometry, bitCount, lowestBitIndex } from './geometry.mjs';

export const CONTRADICTION = Symbol('contradiction');

export function makeState(grid, g) {
  const st = {
    g,
    val: new Int8Array(g.cells),
    cand: new Int32Array(g.cells).fill(g.ALL),
    unsolved: g.cells,
  };
  for (let i = 0; i < g.cells; i++) {
    const d = grid[i];
    if (d === 0) continue;
    if (d < 1 || d > g.size) return CONTRADICTION;
    if ((st.cand[i] & (1 << (d - 1))) === 0) return CONTRADICTION;
    if (assign(st, i, d) === CONTRADICTION) return CONTRADICTION;
  }
  return st;
}

export function cloneState(st) {
  return {
    g: st.g,
    val: Int8Array.from(st.val),
    cand: Int32Array.from(st.cand),
    unsolved: st.unsolved,
  };
}

export function assign(st, i, d) {
  const bit = 1 << (d - 1);
  if ((st.cand[i] & bit) === 0) return CONTRADICTION;
  if (st.val[i] !== 0) return st.val[i] === d ? false : CONTRADICTION;
  st.val[i] = d;
  st.cand[i] = bit;
  st.unsolved--;
  const peers = st.g.peers[i];
  for (let k = 0; k < peers.length; k++) {
    if (eliminate(st, peers[k], d) === CONTRADICTION) return CONTRADICTION;
  }
  return true;
}

export function eliminate(st, i, d) {
  const bit = 1 << (d - 1);
  if ((st.cand[i] & bit) === 0) return false;
  if (st.val[i] !== 0) return st.val[i] === d ? CONTRADICTION : false;
  const next = st.cand[i] & ~bit;
  if (next === 0) return CONTRADICTION;
  st.cand[i] = next;
  return true;
}

// Remove every digit outside `mask` from cell i.
export function restrict(st, i, mask) {
  const extra = st.cand[i] & ~mask;
  if (extra === 0) return false;
  let changed = false;
  for (let d = 1; d <= st.g.size; d++) {
    if ((extra & (1 << (d - 1))) === 0) continue;
    const r = eliminate(st, i, d);
    if (r === CONTRADICTION) return CONTRADICTION;
    if (r) changed = true;
  }
  return changed;
}

export function isSolved(st) {
  return st.unsolved === 0;
}

// Does the fully assigned grid actually satisfy every constraint? Used as a
// belt-and-braces check; a state built through assign() cannot violate them.
export function verifyComplete(st) {
  const g = st.g;
  for (let i = 0; i < g.cells; i++) if (st.val[i] === 0) return false;
  for (const u of g.units) {
    let seen = 0;
    for (let k = 0; k < u.length; k++) {
      const bit = 1 << (st.val[u[k]] - 1);
      if (seen & bit) return false;
      seen |= bit;
    }
    if (seen !== g.ALL) return false;
  }
  return true;
}

export function gridOf(st) {
  return Int8Array.from(st.val);
}

export { geometry, bitCount, lowestBitIndex };
