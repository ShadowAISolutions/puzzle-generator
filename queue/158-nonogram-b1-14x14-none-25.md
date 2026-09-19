# 158-nonogram-b1-14x14-none-25

Generate **25** nonogram puzzles in **band 1 (Gentle)** on a
**14×14** grid with **none** symmetry.

- Dig no further than **undefined** clues.
- Band 1 is **plentiful** at this shape, so the attempt budget is **1500**.
- The band written to each record is whatever the solver's trace says. If this plan yields puzzles
  at a different band, the plan was wrong, not the solver: the driver offers them to another plan
  in the batch that wants that band, and discards them otherwise.

**This plan has failed if** it accepts fewer than 12 puzzles
within its attempt budget, or if any accepted puzzle fails `tools/gate.mjs`.

```json
{
  "family": "nonogram",
  "band": 1,
  "count": 25,
  "max_attempts": 1500,
  "params": {
    "rows": 14,
    "cols": 14,
    "density": 0.44,
    "smooth": 2,
    "band_target": 1,
    "climb_steps": 300
  }
}
```
