# 041-onboard-killer-sudoku — blocked

**Blocked:** 2026-09-19, batch 002.

**Obstacle:** item 4 of the FAMILY ONBOARDING CONTRACT, a green `tools/harden.mjs killer-sudoku`
run. `tools/harden.mjs` builds its own test instances and every one of them is a sudoku digit grid,
so four of its seven passes cannot test a family with a different encoding. Run against this
family, the differential pass fails on all 120 instances and the uniqueness-adversarial pass throws
and takes the run down. The fuzz pass would report **pass** while testing nothing, which is worse.

`tools/harden.mjs` is frozen by `FOUNDATION.md`, so it was not changed. The argument for changing
it, including the exact change and how to verify it leaves `sudoku-classic`'s report identical, is
at **`PROPOSALS/2026-09-19-family-agnostic-hardening.md`**.

**What was done instead:** the family was built anyway, because the solver was the expensive part
and it is now written and checked. It is parked at **`PROPOSALS/killer-sudoku/`**, outside every
path a tool scans, with a README giving the destination of each file and what still has to happen.
It generates nothing and is in no registry. Its duplicate detection was verified exact against a
brute force over all 3,359,232 orientations of a 9x9, and its reference brute force was written and
cross-checked; a bug in the canonicaliser was found and fixed that way.

**What unblocks this:** an explicit instruction from the repository owner to apply that proposal.
Then the files move as the README says, the fixtures and the player get built, the bands get
calibrated, and this plan moves back to `queue/`.

Note that this blocker and the one on `001-onboard-nonogram` together block the whole roster:
sixteen families cannot express their params under the frozen schema, and all nineteen non-classic
families cannot be hardened.
