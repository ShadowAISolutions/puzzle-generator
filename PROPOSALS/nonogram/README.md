# Parked: the nonogram solver, three files of it

**Date:** 2026-09-19
**Status:** validated but incomplete. Generates nothing, and cannot until the rest exists.

This is the start of the nonogram family. It is parked here rather than in `solver/nonogram/`
because `solver/` should hold only families that have been through the whole onboarding contract,
and a half-built family sitting there reads like a broken one. Nothing imports these files and no
registry mentions them, so they are inert.

They were written first because nonogram was the first family picked after the owner's "no more
sudoku" instruction. It turned out to be blocked on `tools/gate.mjs`, which checked that every
puzzle string was exactly `size * size` characters — true of sudoku and of nothing else. Binairo
was onboarded instead, because it fits that check as it stands. The owner has since allowed the
gate change, so nonogram is no longer blocked; it is simply not finished.

## What is here

| File | What it does | State |
|---|---|---|
| `encode.mjs` | clue lists and grids to and from strings, with a shape check | complete |
| `line.mjs` | one line: the dynamic program, and the three line tiers | complete, validated |
| `solve.mjs` | the grid: propagation, the ladder, counting, bounded search | complete, **untested** |

## What was established, so it is not re-derived

**The line reasoner is exact.** Checked against brute force over every (length, clue, state)
triple up to length 8 — 192,192 cases, 29,004 of them with at least one arrangement. Tier 3 finds
exactly the cells that are the same in every arrangement, no more and no fewer; tiers 1 and 2
never conclude anything false; and each tier's deductions are a subset of the next's. Zero
violations of any of the three.

**The first tier design was wrong, and the way it was wrong is worth remembering.** Tiers were
originally defined by showing a tier less of the line's state. That cannot work: a tier that
cannot see what it has already deduced cannot iterate, so band 1 never occurs and everything
collapses into the middle. Measured: 36 of 37 puzzles came out band 3.

**The second design was also wrong, more quietly.** Tier 2 was given the rules a person would
name — pin a run with one placement left, narrow a run whose filled cell no other run could own —
and measured as deciding a cell tier 1 had missed on **0 of 397,750 lines**. Those rules cannot
fire: the dynamic program is global, so every start it offers already has a consistent
completion, and both rules only ever discard starts that were never offered. A rule that reads
well and never fires is worse than no rule, because the band it labels is a lie.

**What works is separating the tiers by the machinery they reason with**, all of them seeing the
whole line: tier 1 reasons about each run's *range*, tier 2 about the surviving *placements*, and
tier 3 about whole *arrangements*. Measured on the same 397,750 lines: tier 2 beats tier 1 on
22.4%, and tier 3 beats tier 2 on 8.9%.

**All five bands are reachable**, but not from a uniformly random grid. Unlike sudoku there is no
clue-removal step — a nonogram's clues are fully determined by its solution — so the generator's
only lever is which grid it picks. Random grids are almost always band 1. A search that targets a
band lands bands 1 to 4 readily on a 12×12; band 5 needed 26 hill-climbs at 16×16 to hit once.

## What is left

`solve.mjs` is written but has never been run against the corrected `line.mjs`. Beyond that, the
onboarding contract needs: `canonical.mjs`, `bands.json`, the family adapter `index.mjs`, a
reference brute force sharing no code with it, a generator, at least 40 fixtures, a green
`tools/harden.mjs nonogram`, and `site/play/nonogram.html`. `solve.mjs` will also need the
`validateEncoding` hook the gate now asks every family for, which is where the original blocker
was, and the harden instance hooks (`randomInstance`, `minimalUniqueInstance`, `fuzzCase`) that
`solver/binairo/index.mjs` is the worked example of.
