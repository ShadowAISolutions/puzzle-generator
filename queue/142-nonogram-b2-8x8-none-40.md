# 142-nonogram-b2-8x8-none-40

Generate **40** nonogram puzzles in **band 2 (Easy)** on a
**8×8** grid with **none** symmetry.

- Dig no further than **undefined** clues.
- Band 2 is **plentiful** at this shape, so the attempt budget is **2400**.
- The band written to each record is whatever the solver's trace says. If this plan yields puzzles
  at a different band, the plan was wrong, not the solver: the driver offers them to another plan
  in the batch that wants that band, and discards them otherwise.

**This plan has failed if** it accepts fewer than 20 puzzles
within its attempt budget, or if any accepted puzzle fails `tools/gate.mjs`.

```json
{
  "family": "nonogram",
  "band": 2,
  "count": 40,
  "max_attempts": 2400,
  "params": {
    "rows": 8,
    "cols": 8,
    "density": 0.48,
    "smooth": 1,
    "band_target": 2,
    "climb_steps": 300
  }
}
```
