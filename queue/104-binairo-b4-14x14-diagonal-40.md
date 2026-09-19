# 104-binairo-b4-14x14-diagonal-40

Generate **40** binairo puzzles in **band 4 (Hard)** on a
**14×14** grid with **diagonal** symmetry.

- Dig no further than **0** clues.
- Band 4 is **plentiful** at this shape, so the attempt budget is **2400**.
- The band written to each record is whatever the solver's trace says. If this plan yields puzzles
  at a different band, the plan was wrong, not the solver: the driver offers them to another plan
  in the batch that wants that band, and discards them otherwise.

**This plan has failed if** it accepts fewer than 20 puzzles
within its attempt budget, or if any accepted puzzle fails `tools/gate.mjs`.

```json
{
  "family": "binairo",
  "band": 4,
  "count": 40,
  "max_attempts": 2400,
  "params": {
    "size": 14,
    "symmetry": "diagonal",
    "min_clues": 0,
    "band_target": 4,
    "dig_passes": 6
  }
}
```
