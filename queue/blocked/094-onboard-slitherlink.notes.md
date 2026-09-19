# 094-onboard-slitherlink — blocked

**Blocked on:** two frozen files, both already argued and both awaiting the repository owner.
Nothing about slitherlink specifically is the obstacle; it is blocked for exactly the same two
reasons every non-sudoku family is, and those reasons were established by running the tools, not
by reading them.

1. **`schema/puzzle.schema.json` requires box dimensions.** Every record's `params` must carry
   `size`, `box_h` and `box_w`, with the box dimensions between 2 and 4. A slitherlink is a loop
   drawn on a lattice of dots and has no boxes to describe, so it cannot produce a record that
   validates without inventing values for a field that does not apply to it. The argument is in
   `PROPOSALS/2026-09-19-family-agnostic-params.md`.

2. **`tools/harden.mjs` can only harden sudoku digit grids.** The FAMILY ONBOARDING CONTRACT
   requires a green hardening run before a family's first puzzle. Four of the suite's seven passes
   build their own test instances and every one is a string of digits and dots on a sudoku shape,
   with no hook for a family to supply its own. Against another encoding the differential pass
   fails on every instance, the uniqueness-adversarial pass throws, and — the dangerous part — the
   fuzz pass reports `pass` while testing nothing. The argument is in
   `PROPOSALS/2026-09-19-family-agnostic-hardening.md`.

**Why this is blocked rather than attempted.** The anti-drift rules say to write proposals and not
act on them, and both proposals are written. The obstacle is identical to
`001-onboard-nonogram.notes.md` and `041-onboard-killer-sudoku.notes.md`, so three serious attempts
here would only rediscover what two earlier batches already measured. A session that finds this
file should not re-derive the blocker, re-propose it, or start building a slitherlink solver.

**What unblocks it.** An explicit instruction from the repository owner to apply one or both
proposals. Until then the roster's nineteen non-`sudoku-classic` families stay unreachable and the
corpus can only grow as classic sudoku. `PROPOSALS/killer-sudoku/` holds a complete, tested family
already parked against the same blocker, and it is the one that should be onboarded first if the
answer ever comes.
