# 105-binairo-b5-12x12-mirror_h-40

Generate **40** binairo puzzles in **band 5 (Brutal)** on a
**12×12** grid with **mirror_h** symmetry.

- Dig no further than **0** clues.
- Band 5 is **scarce** at this shape, so the attempt budget is **16000**.
- The band written to each record is whatever the solver's trace says. If this plan yields puzzles
  at a different band, the plan was wrong, not the solver: the driver offers them to another plan
  in the batch that wants that band, and discards them otherwise.

**This plan has failed if** it accepts fewer than 20 puzzles
within its attempt budget, or if any accepted puzzle fails `tools/gate.mjs`.

```json
{
  "family": "binairo",
  "band": 5,
  "count": 40,
  "max_attempts": 16000,
  "params": {
    "size": 12,
    "symmetry": "mirror_h",
    "min_clues": 0,
    "band_target": 5,
    "dig_passes": 6
  }
}
```
