# 062-sudoku-classic-b5-82x4-rot180-50

Generate **50** sudoku-classic puzzles in **band 5 (Brutal)** on a
**8×8** grid with **2×4** boxes and **rot180** symmetry.

- Dig no further than **14** clues.
- Band 5 is **plentiful** at this shape, so the attempt budget is **3000**.
- The band written to each record is whatever the solver's trace says. If this plan yields puzzles
  at a different band, the plan was wrong, not the solver: the driver offers them to another plan
  in the batch that wants that band, and discards them otherwise.

**This plan has failed if** it accepts fewer than 25 puzzles
within its attempt budget, or if any accepted puzzle fails `tools/gate.mjs`.

```json
{
  "family": "sudoku-classic",
  "band": 5,
  "count": 50,
  "max_attempts": 3000,
  "params": {
    "size": 8,
    "box_h": 2,
    "box_w": 4,
    "symmetry": "rot180",
    "min_clues": 14,
    "band_target": 5,
    "dig_passes": 6
  }
}
```
