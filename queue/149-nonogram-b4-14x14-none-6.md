# 149-nonogram-b4-14x14-none-6

Generate **6** nonogram puzzles in **band 4 (Hard)** on a
**14×14** grid with **none** symmetry.

- Dig no further than **undefined** clues.
- Band 4 is **scarce** at this shape, so the attempt budget is **2400**.
- The band written to each record is whatever the solver's trace says. If this plan yields puzzles
  at a different band, the plan was wrong, not the solver: the driver offers them to another plan
  in the batch that wants that band, and discards them otherwise.

**This plan has failed if** it accepts fewer than 3 puzzles
within its attempt budget, or if any accepted puzzle fails `tools/gate.mjs`.

```json
{
  "family": "nonogram",
  "band": 4,
  "count": 6,
  "max_attempts": 2400,
  "params": {
    "rows": 14,
    "cols": 14,
    "density": 0.44,
    "smooth": 2,
    "band_target": 4,
    "climb_steps": 700
  }
}
```
