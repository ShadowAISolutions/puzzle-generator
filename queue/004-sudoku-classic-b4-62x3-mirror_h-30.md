# 004-sudoku-classic-b4-62x3-mirror_h-30

Generate **30** sudoku-classic puzzles in **band 4 (Hard)** on a
**6×6** grid with **2×3** boxes and **mirror_h** symmetry.

- Dig no further than **8** clues.
- Band 4 is **plentiful** at this shape, so the attempt budget is **1800**.
- The band written to each record is whatever the solver's trace says. If this plan yields puzzles
  at a different band, the plan was wrong, not the solver: the driver offers them to another plan
  in the batch that wants that band, and discards them otherwise.

**This plan has failed if** it accepts fewer than 15 puzzles
within its attempt budget, or if any accepted puzzle fails `tools/gate.mjs`.

```json
{
  "family": "sudoku-classic",
  "band": 4,
  "count": 30,
  "max_attempts": 1800,
  "params": {
    "size": 6,
    "box_h": 2,
    "box_w": 3,
    "symmetry": "mirror_h",
    "min_clues": 8,
    "band_target": 4,
    "dig_passes": 6
  }
}
```
