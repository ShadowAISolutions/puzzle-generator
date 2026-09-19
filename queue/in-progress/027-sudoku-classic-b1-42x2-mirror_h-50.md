# 027-sudoku-classic-b1-42x2-mirror_h-50

Generate **50** sudoku-classic puzzles in **band 1 (Gentle)** on a
**4×4** grid with **2×2** boxes and **mirror_h** symmetry.

- Dig no further than **4** clues.
- Band 1 is **plentiful** at this shape, so the attempt budget is **3000**.
- The band written to each record is whatever the solver's trace says. If this plan yields puzzles
  at a different band, the plan was wrong, not the solver: the driver offers them to another plan
  in the batch that wants that band, and discards them otherwise.

**This plan has failed if** it accepts fewer than 25 puzzles
within its attempt budget, or if any accepted puzzle fails `tools/gate.mjs`.

```json
{
  "family": "sudoku-classic",
  "band": 1,
  "count": 50,
  "max_attempts": 3000,
  "params": {
    "size": 4,
    "box_h": 2,
    "box_w": 2,
    "symmetry": "mirror_h",
    "min_clues": 4,
    "band_target": 1,
    "dig_passes": 6
  }
}
```
