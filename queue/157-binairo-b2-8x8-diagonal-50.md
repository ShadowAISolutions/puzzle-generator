# 157-binairo-b2-8x8-diagonal-50

Generate **50** binairo puzzles in **band 2 (Easy)** on a
**8×8** grid with **diagonal** symmetry.

- Dig no further than **0** clues.
- Band 2 is **plentiful** at this shape, so the attempt budget is **3000**.
- The band written to each record is whatever the solver's trace says. If this plan yields puzzles
  at a different band, the plan was wrong, not the solver: the driver offers them to another plan
  in the batch that wants that band, and discards them otherwise.

**This plan has failed if** it accepts fewer than 25 puzzles
within its attempt budget, or if any accepted puzzle fails `tools/gate.mjs`.

```json
{
  "family": "binairo",
  "band": 2,
  "count": 50,
  "max_attempts": 3000,
  "params": {
    "size": 8,
    "symmetry": "diagonal",
    "min_clues": 0,
    "band_target": 2,
    "dig_passes": 6
  }
}
```
