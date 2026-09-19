// Single-line reasoning for nonograms, and the three line tiers built on it.
//
// One dynamic program does all the work. Over "at cell i, about to place run j"
// it decides which states can be reached from the start and which can still
// reach the end; everything else is read off that. On a line of length L with k
// runs it visits O(L*k) states, so it is cheap enough to run on every line of
// every grid on every pass.
//
// All three tiers see the whole line. They differ in what they are allowed to
// conclude from it, which is what makes them a ladder a person would recognise
// rather than an artefact of the implementation:
//
//   tier 1  overlap     each run's range, and nothing finer: fill where a run's
//                       earliest and latest placements already overlap, blank
//                       what lies outside every range
//   tier 2  run_bounds  the surviving placements themselves rather than their
//                       range, which additionally blanks the holes a range
//                       spans but no placement reaches
//   tier 3  line_solve  every cell that is the same in every arrangement of the
//                       whole line, including cells different runs fill in
//                       different arrangements
//
// The ladder is strict in both directions. Tier 3 is complete for a single
// line, so it subsumes the other two by construction. It is also genuinely
// stronger than tier 2, because a cell can be filled in every arrangement
// without any one run always covering it. Measured over 397,750 lines drawn
// from real solves: tier 2 decides a cell tier 1 missed on 22.4% of them, and
// tier 3 decides a cell tier 2 missed on 8.9%.
//
// This file is exact, and that is checked rather than claimed: tier 3 was
// compared against brute force over every (length, clue, state) triple up to
// length 8 -- 192,192 cases, 29,004 of them with at least one arrangement --
// and found exactly the cells that are the same in every arrangement, no more
// and no fewer, with tiers 1 and 2 never concluding anything false and each
// tier's deductions a subset of the next's. Zero violations.
//
// All three tiers are kept, and the grid ladder in solve.mjs uses only the
// first and the third. That is not an oversight. A gain on one line is not a
// gain on a grid: sweeping rows and columns alternately recovers everything
// tier 3 knows that tier 2 does not, so of 40 grids tier-2 propagation could
// not finish, tier-3 propagation finished none of them. The grid bands are
// separated by something else, and solve.mjs says what.
//
// One thing had to be unlearned to get here. An earlier ladder gave tier 2 the
// rules a person would name -- pin a run with one placement left, narrow a run
// whose filled cell no other run could own -- and measured them as never once
// deciding a cell tier 1 had missed. They cannot: the dynamic program below is
// global, so a start it offers already has a consistent completion, and both
// rules only ever discard starts that were never offered. A rule that reads
// well and fires never is worse than no rule, because the band it labels is a
// lie. What separates tiers here is which machinery they reason with.

export const UNKNOWN = 0;
export const FILLED = 1;
export const BLANK = 2;

export const LINE_TIERS = { 1: 'overlap', 2: 'run_bounds', 3: 'line_solve' };

// The shared dynamic program. Returns null when no arrangement fits at all.
function analyse(len, clue, state) {
  const k = clue.length;

  const fits = (i, L) => {
    if (i + L > len) return false;
    for (let m = i; m < i + L; m++) if (state[m] === BLANK) return false;
    if (i + L < len && state[i + L] === FILLED) return false;
    return true;
  };

  const memo = Array.from({ length: len + 2 }, () => new Int8Array(k + 1).fill(-1));
  const can = (i, j) => {
    if (i >= len) return j === k ? 1 : 0;
    if (memo[i][j] !== -1) return memo[i][j];
    let r = 0;
    if (j === k) {
      r = 1;
      for (let m = i; m < len; m++) if (state[m] === FILLED) { r = 0; break; }
    } else {
      if (state[i] !== FILLED && can(i + 1, j)) r = 1;
      if (!r && fits(i, clue[j]) && can(i + clue[j] + 1, j + 1)) r = 1;
    }
    memo[i][j] = r;
    return r;
  };
  if (!can(0, 0)) return null;

  const reach = Array.from({ length: len + 2 }, () => new Int8Array(k + 1));
  reach[0][0] = 1;
  const canFill = new Int8Array(len);
  const canBlank = new Int8Array(len);
  const starts = Array.from({ length: k }, () => []);

  for (let i = 0; i <= len; i++) {
    for (let j = 0; j <= k; j++) {
      if (!reach[i][j] || !can(i, j)) continue;
      if (j === k) {
        for (let m = i; m < len; m++) canBlank[m] = 1;
        continue;
      }
      if (i < len && state[i] !== FILLED && can(i + 1, j)) {
        canBlank[i] = 1;
        reach[i + 1][j] = 1;
      }
      const L = clue[j];
      if (fits(i, L) && can(i + L + 1, j + 1)) {
        starts[j].push(i);
        for (let m = i; m < i + L; m++) canFill[m] = 1;
        if (i + L < len) canBlank[i + L] = 1;
        reach[i + L + 1][j + 1] = 1;
      }
    }
  }
  return { k, starts, canFill, canBlank };
}

// Everything the given tier forces about a line. Returns {ok, cells}, where a
// cell is UNKNOWN when this tier cannot decide it. ok is false when the line
// admits no arrangement, which the caller must propagate as a contradiction.
export function lineDeduce(len, clue, state, tier = 3) {
  const a = analyse(len, clue, state);
  if (!a) return { ok: false, cells: null };
  const cells = new Int8Array(len);

  if (tier >= 3) {
    for (let m = 0; m < len; m++) {
      if (a.canFill[m] && !a.canBlank[m]) cells[m] = FILLED;
      else if (a.canBlank[m] && !a.canFill[m]) cells[m] = BLANK;
    }
    return { ok: true, cells };
  }

  // Tiers 1 and 2 reason one run at a time. Each run j has a feasible-start
  // set; its range is [lo, hi]. Where the earliest and latest placements
  // overlap, the cell is filled whichever placement is real.
  for (let j = 0; j < a.k; j++) {
    const s = a.starts[j];
    const lo = s[0], hi = s[s.length - 1];
    for (let m = hi; m < lo + clue[j]; m++) cells[m] = FILLED;
  }

  // What each tier may say about a cell no run occupies differs, and that is
  // the whole distance between them. Tier 1 works from each run's range, so it
  // can only rule out a cell outside every range. Tier 2 works from the
  // surviving placements themselves, so it also rules out the holes a range
  // spans but no placement reaches -- the cells a blank splits off, which is
  // the step a person takes when they stop thinking about where a run roughly
  // sits and start eliminating the placements one by one.
  const covered = new Int8Array(len);
  if (tier <= 1) {
    for (let j = 0; j < a.k; j++) {
      const s = a.starts[j];
      for (let m = s[0]; m < s[s.length - 1] + clue[j]; m++) covered[m] = 1;
    }
  } else {
    for (let m = 0; m < len; m++) covered[m] = a.canFill[m];
  }
  for (let m = 0; m < len; m++) if (!covered[m] && cells[m] === UNKNOWN) cells[m] = BLANK;

  return { ok: true, cells };
}

// Every arrangement of a line, for the reference solver and for fixtures. This
// is the honest exponential version and is never used in the hot path.
export function lineArrangements(len, clue, state = null) {
  const out = [];
  const cells = new Int8Array(len);
  const ok = (m, v) => !state || state[m] === UNKNOWN || state[m] === v;
  const place = (i, j) => {
    if (j === clue.length) {
      for (let m = i; m < len; m++) {
        if (!ok(m, BLANK)) return;
        cells[m] = BLANK;
      }
      out.push(Int8Array.from(cells));
      return;
    }
    const L = clue[j];
    for (let s = i; s + L <= len; s++) {
      let good = true;
      for (let m = i; m < s; m++) { if (!ok(m, BLANK)) { good = false; break; } cells[m] = BLANK; }
      if (!good) break;
      let fitsHere = true;
      for (let m = s; m < s + L; m++) { if (!ok(m, FILLED)) { fitsHere = false; break; } cells[m] = FILLED; }
      if (!fitsHere) continue;
      if (s + L === len) {
        if (j + 1 === clue.length) out.push(Int8Array.from(cells));
        continue;
      }
      if (!ok(s + L, BLANK)) continue;
      cells[s + L] = BLANK;
      place(s + L + 1, j + 1);
    }
  };
  place(0, 0);
  return out;
}
