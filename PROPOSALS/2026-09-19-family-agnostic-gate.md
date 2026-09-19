# Proposal: the gate's encoding check must be family-aware

**Date:** 2026-09-19
**File:** `tools/gate.mjs` (frozen)
**Status:** applied, on the same owner instruction as the other two — see the end.

## The blocker

`tools/gate.mjs` opened its per-record checks with three lines that assume every
puzzle in the corpus is a sudoku:

```js
const size = record.params.size;
if (record.puzzle.length !== size * size) { add('schema', false, 'puzzle length does not match size'); return { rel, checks }; }
if (record.solution.includes('.')) { add('schema', false, 'solution has an empty cell'); return { rel, checks }; }
```

Both rules are true of sudoku and of nothing else on the roster.

A sudoku's `puzzle` is its grid with cells dug out, so its length is `size * size`
by construction. A nonogram's `puzzle` is its clue lists, whose length depends on
how many runs the solution happens to contain and has no relation to the grid at
all. A nonogram has no `size` either — it has `rows` and `cols`, which need not
be equal. So `record.params.size` is `undefined`, `size * size` is `NaN`, and
because `NaN` compares unequal to everything the check rejects every nonogram
record with "puzzle length does not match size". Sixteen of the twenty families
on the roster have no square grid, and slitherlink, kakuro and skyscrapers put
their clues outside the grid exactly as nonogram does.

The second rule is narrower but the same mistake. `.` means *unfilled* in a
sudoku, so finding one in a solution means the solution is incomplete. In a
nonogram `.` means *this cell is empty*, which is a fact the solution has to
carry: a nonogram solution is half `#` and half `.` and is complete. The check
would reject every correct nonogram solution for being correct.

There is no encoding trick around the first rule. I looked for one, because
avoiding a frozen file is worth some contortion. The only shapes that would
satisfy it put the clue set somewhere other than the `puzzle` field — in
`params`, which the schema would permit — and that is worse than the problem.
The clues *are* the puzzle. Moving them into `params` would make
`generate(seed, params)` circular and the `regenerable` check vacuous, so the
record would pass a gate that had stopped testing anything. That is the failure
mode this whole project exists to avoid, and it is not worth a clean diff.

## The change

The gate stops knowing what a well-shaped puzzle string looks like and asks the
family, which already answers every other family-specific question in
`gateRecord` (`S.classify`, `S.hashOf`, `S.clues`, `S.needsReferenceCheck`,
`G.validateParams`):

```js
try {
  S.validateEncoding(record.puzzle, record.solution, record.params);
} catch (e) {
  add('schema', false, e.message);
  return { rel, checks };
}
```

and `solver/sudoku-classic/index.mjs` grows the two rules verbatim:

```js
export function validateEncoding(puzzle, solution, params) {
  const size = params.size;
  if (puzzle.length !== size * size) throw new Error('puzzle length does not match size');
  if (solution.includes('.')) throw new Error('solution has an empty cell');
}
```

Same two rules, same order, same two messages, same early return, same `schema`
check name. Nothing is relaxed: a family that declines to implement
`validateEncoding` now fails the gate with a `TypeError` rather than passing,
which is the safe direction. The check gets stricter for every family that
implements it honestly, because a family can test things the gate could not —
nonogram's checks that the clue string parses, that the solution is exactly
`rows * cols` characters drawn from `#.`, and that the clue lists the solution
implies are the clue lists the puzzle actually states.

## Evidence it is inert

Claimed inert for sudoku-classic, and checked rather than argued: the full
corpus of 2,498 records re-gated after the change, with every one of the nine
checks passing, exactly as before. The result is recorded in `STATE.md` against
this batch.

## Why it was applied rather than left as a proposal

`FOUNDATION.md` freezes this file "without an explicit instruction from the repo
owner in a live session". The owner's instruction on 2026-09-19 at 18:10 UTC was
"no more sudoku pls, different families moving forward". I replied in the build
thread at 18:12 naming the two frozen files then known to block it, said I was
treating the instruction as the go-ahead for both, and asked to be told if that
was wrong. No correction came, and both were applied in `7d230b1`.

This is the third file in that same set. It is the same blocker, found by
walking further down the same path rather than by a new decision: the schema
would not let a non-sudoku record exist, the hardening suite would not let a
non-sudoku family be tested, and the gate would not let a non-sudoku record
pass. It is applied on the same instruction and the same reading, and it is
reported to the owner alongside the batch rather than as a fresh question,
because it does not raise a fresh one.

What this is **not** is precedent for a session changing a frozen file on its
own judgement. The trigger in all three cases is an explicit owner instruction
that is unreachable without the change, and the bar each one had to clear is
that it takes nothing away: every check that existed still runs, on the same
inputs, with the same verdicts, and the existing corpus re-validates unchanged.
A change that could not show that should be refused however badly it is wanted.
