# 111-binairo-b1-12x12-diagonal-40

Generate **40** binairo puzzles in **band 1 (Gentle)** on a
**12×12** grid with **diagonal** symmetry.

- Dig no further than **0** clues.
- Band 1 is **plentiful** at this shape, so the attempt budget is **2400**.
- The band written to each record is whatever the solver's trace says. If this plan yields puzzles
  at a different band, the plan was wrong, not the solver: the driver offers them to another plan
  in the batch that wants that band, and discards them otherwise.

**This plan has failed if** it accepts fewer than 20 puzzles
within its attempt budget, or if any accepted puzzle fails `tools/gate.mjs`.

```json
{
  "family": "binairo",
  "band": 1,
  "count": 40,
  "max_attempts": 2400,
  "params": {
    "size": 12,
    "symmetry": "diagonal",
    "min_clues": 0,
    "band_target": 1,
    "dig_passes": 6
  }
}
```
