# 037-sudoku-classic-b4-82x4-mirror_v-50

Generate **50** sudoku-classic puzzles in **band 4 (Hard)** on a
**8×8** grid with **2×4** boxes and **mirror_v** symmetry.

- Dig no further than **14** clues.
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
    "size": 8,
    "box_h": 2,
    "box_w": 4,
    "symmetry": "mirror_v",
    "min_clues": 14,
    "band_target": 4,
    "dig_passes": 6
  }
}
```
