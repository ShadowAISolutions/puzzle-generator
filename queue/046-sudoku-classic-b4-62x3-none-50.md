# 046-sudoku-classic-b4-62x3-none-50

Generate **50** sudoku-classic puzzles in **band 4 (Hard)** on a
**6×6** grid with **2×3** boxes and **none** symmetry.

- Dig no further than **8** clues.
- Band 4 is **plentiful** at this shape, so the attempt budget is **3000**.
- The band written to each record is whatever the solver's trace says. If this plan yields puzzles
  at a different band, the plan was wrong, not the solver: the driver offers them to another plan
  in the batch that wants that band, and discards them otherwise.

**This plan has failed if** it accepts fewer than 25 puzzles
within its attempt budget, or if any accepted puzzle fails `tools/gate.mjs`.

```json
{
  "family": "sudoku-classic",
  "band": 4,
  "count": 50,
  "max_attempts": 3000,
  "params": {
    "size": 6,
    "box_h": 2,
    "box_w": 3,
    "symmetry": "none",
    "min_clues": 8,
    "band_target": 4,
    "dig_passes": 6
  }
}
```
