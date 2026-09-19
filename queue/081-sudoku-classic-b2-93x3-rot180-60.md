# 081-sudoku-classic-b2-93x3-rot180-60

Generate **60** sudoku-classic puzzles in **band 2 (Easy)** on a
**9×9** grid with **3×3** boxes and **rot180** symmetry.

- Dig no further than **17** clues.
- Band 2 is **plentiful** at this shape, so the attempt budget is **3600**.
- The band written to each record is whatever the solver's trace says. If this plan yields puzzles
  at a different band, the plan was wrong, not the solver: the driver offers them to another plan
  in the batch that wants that band, and discards them otherwise.

**This plan has failed if** it accepts fewer than 30 puzzles
within its attempt budget, or if any accepted puzzle fails `tools/gate.mjs`.

```json
{
  "family": "sudoku-classic",
  "band": 2,
  "count": 60,
  "max_attempts": 3600,
  "params": {
    "size": 9,
    "box_h": 3,
    "box_w": 3,
    "symmetry": "rot180",
    "min_clues": 17,
    "band_target": 2,
    "dig_passes": 6
  }
}
```
