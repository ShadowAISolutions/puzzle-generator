# 151-nonogram-b2-12x12-none-25

Generate **25** nonogram puzzles in **band 2 (Easy)** on a
**12×12** grid with **none** symmetry.

- Dig no further than **undefined** clues.
- Band 2 is **plentiful** at this shape, so the attempt budget is **1500**.
- The band written to each record is whatever the solver's trace says. If this plan yields puzzles
  at a different band, the plan was wrong, not the solver: the driver offers them to another plan
  in the batch that wants that band, and discards them otherwise.

**This plan has failed if** it accepts fewer than 12 puzzles
within its attempt budget, or if any accepted puzzle fails `tools/gate.mjs`.

```json
{
  "family": "nonogram",
  "band": 2,
  "count": 25,
  "max_attempts": 1500,
  "params": {
    "rows": 12,
    "cols": 12,
    "density": 0.45,
    "smooth": 1,
    "band_target": 2,
    "climb_steps": 300
  }
}
```
