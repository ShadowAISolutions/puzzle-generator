# 017-sudoku-classic-b3-93x3-none-20

Generate **20** sudoku-classic puzzles in **band 3 (Medium)** on a
**9×9** grid with **3×3** boxes and **none** symmetry.

- Dig no further than **17** clues.
- Band 3 is **scarce** at this shape, so the attempt budget is **8000**.
- The band written to each record is whatever the solver's trace says. If this plan yields puzzles
  at a different band, the plan was wrong, not the solver: the driver offers them to another plan
  in the batch that wants that band, and discards them otherwise.

**This plan has failed if** it accepts fewer than 10 puzzles
within its attempt budget, or if any accepted puzzle fails `tools/gate.mjs`.

```json
{
  "family": "sudoku-classic",
  "band": 3,
  "count": 20,
  "max_attempts": 8000,
  "params": {
    "size": 9,
    "box_h": 3,
    "box_w": 3,
    "symmetry": "none",
    "min_clues": 17,
    "band_target": 3,
    "dig_passes": 6
  }
}
```
