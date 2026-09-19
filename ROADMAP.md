# ROADMAP

The corpus grows in one direction: more validated puzzles, across more families, without ever
loosening what "validated" means.

## Now

- `sudoku-classic` is onboarded: solver, reference, fixtures, hardening report, frozen bands,
  player and manifest all committed.
- Batches run continuously per the SESSION LOOP in `CLAUDE.md`.

## Next

Onboard the roster, roughly one new family every fifth batch, each through the full FAMILY
ONBOARDING CONTRACT:

`nonogram`, `slitherlink`, `kakuro`, `star-battle`, `hitori`, `masyu`, `akari`, `nurikabe`,
`skyscrapers`, `futoshiki`, `binairo`, `shikaku`, `heyawake`, `yajilin`, `tents`, `killer-sudoku`,
`thermo-sudoku`, `sandwich-sudoku`, `norinori`.

A new family ships its solver, its reference support, at least 40 fixtures, a green hardening
report, calibrated and frozen bands, a working player and its manifest **before its first puzzle**.

## Balance targets

- No family over 40% of any batch, or 30% of the corpus once four families exist.
- Every batch touches at least three families and all five bands.
- Within a family, vary grid size, clue count and symmetry.

## Known limits, recorded rather than worked around

- **Sudoku grid shapes are capped at 9×9** by the cost of an exact symmetry reduction. See
  `STATE.md`, Decisions, 2026-09-19. Larger grids would need an approximate canonical form, which
  would let the same puzzle in disguise enter twice.
- **Band 3 is scarce** in sudoku, and a 4×4 sudoku has no band above 1. Both are properties of the
  technique ladder, both are measured, and `tools/make_plans.mjs` plans around them.
- **Band 5 depends on the ladder.** "Requires search" means requires search *given this solver's
  17 techniques*. A richer ladder would move some band-5 puzzles down. The ladder is published in
  `corpus/<family>/family.json` and frozen, so the meaning of a band cannot drift underneath the
  corpus.

Anything that would require changing a frozen file goes to `PROPOSALS/` as an argument, and the
session keeps working. Proposals are written, never acted on.
