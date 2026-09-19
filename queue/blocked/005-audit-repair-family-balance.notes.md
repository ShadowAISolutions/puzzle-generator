# Why family balance cannot be repaired by a session

Two frozen files each block the roster, and both need an explicit instruction from the repository
owner in a live session before anything can change.

1. **`schema/puzzle.schema.json`** requires every record's `params` to carry `size`, `box_h` and
   `box_w`. Sixteen of the twenty rostered families have no boxes and cannot express their
   parameters at all. Argument: `PROPOSALS/2026-09-19-family-agnostic-params.md`.

2. **`tools/harden.mjs`** builds its own test instances, and `randomInstance`,
   `minimalUniqueInstance` and `fuzzCase` all produce strings of digits and dots on a sudoku shape.
   Four of its seven passes draw from those three and no family can supply its own. Run against a
   family with another encoding the differential pass fails on every instance and the
   uniqueness-adversarial pass throws — and the fuzz pass reports **pass while testing nothing**,
   which is the dangerous part. Argument:
   `PROPOSALS/2026-09-19-family-agnostic-hardening.md`.

Together these block all nineteen non-`sudoku-classic` families. The onboarding contract requires a
green hardening report before a family's first puzzle, and shipping a family without one would make
the corpus's guarantee untrue for part of itself, which is worse than a corpus of one family.

## What is already done, so it is not redone

- `queue/blocked/001-onboard-nonogram.md` — blocked on the schema.
- `queue/blocked/041-onboard-killer-sudoku.md` — blocked on the hardening suite.
- `PROPOSALS/killer-sudoku/` — a complete, tested killer sudoku family, parked. Solver with a
  23-technique ladder, independent reference, generator, and a canonicaliser verified exact against
  a brute force over all 3,359,232 orientations of a 9×9. It is in no registry, nothing imports it,
  and it generates nothing. Its README lists each file's destination.

## If an instruction is given

Apply the relevant proposal, then follow the FAMILY ONBOARDING CONTRACT in order. For killer sudoku
specifically: move the parked files, add the three registry lines, then build fixtures, run the
hardening suite to green, calibrate `bands.json`, and write the player — all before its first
puzzle is generated.
