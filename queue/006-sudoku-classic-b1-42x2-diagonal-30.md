# 006-sudoku-classic-b1-42x2-diagonal-30

Generate **30** sudoku-classic puzzles in **band 1 (Gentle)** on a
**4×4** grid with **2×2** boxes and **diagonal** symmetry.

- Dig no further than **4** clues.
- Band 1 is **plentiful** at this shape, so the attempt budget is **1800**.
- The band written to each record is whatever the solver's trace says. If this plan yields puzzles
  at a different band, the plan was wrong, not the solver: the driver offers them to another plan
  in the batch that wants that band, and discards them otherwise.

**This plan has failed if** it accepts fewer than 15 puzzles
within its attempt budget, or if any accepted puzzle fails `tools/gate.mjs`.

```json
{
  "family": "sudoku-classic",
  "band": 1,
  "count": 30,
  "max_attempts": 1800,
  "params": {
    "size": 4,
    "box_h": 2,
    "box_w": 2,
    "symmetry": "diagonal",
    "min_clues": 4,
    "band_target": 1,
    "dig_passes": 6
  }
}
```
