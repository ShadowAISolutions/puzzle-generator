# 083-sudoku-classic-b1-62x3-rot180-50

Generate **50** sudoku-classic puzzles in **band 1 (Gentle)** on a
**6×6** grid with **2×3** boxes and **rot180** symmetry.

- Dig no further than **8** clues.
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
    "size": 6,
    "box_h": 2,
    "box_w": 3,
    "symmetry": "rot180",
    "min_clues": 8,
    "band_target": 1,
    "dig_passes": 6
  }
}
```
