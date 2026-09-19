# ROADMAP

The corpus grows in one direction: more validated puzzles, across more families, without ever
loosening what "validated" means.

## Now

- `sudoku-classic` is onboarded: solver, reference, fixtures, hardening report, frozen bands,
  player and manifest all committed.
- Batches run continuously per the SESSION LOOP in `CLAUDE.md`.

## Next

Onboard the roster, roughly one new family every fifth batch, each through the full FAMILY
ONBOARDING CONTRACT. A new family ships its solver, its reference support, at least 40 fixtures,
a green hardening report, calibrated and frozen bands, a working player and its manifest **before
its first puzzle**.

**Every family is currently blocked, and the corpus can only grow through `sudoku-classic`.**
There are two blockers, both on frozen files, both written up and neither applied:

- `tools/harden.mjs` can only harden a sudoku digit grid, which blocks all nineteen non-classic
  families. See `PROPOSALS/2026-09-19-family-agnostic-hardening.md`.
- `schema/puzzle.schema.json` requires box dimensions in `params`, which blocks the sixteen
  families that have no boxes. See `PROPOSALS/2026-09-19-family-agnostic-params.md`.

Both need an explicit instruction from the repo owner in a live session. Until then:

- `killer-sudoku` is **built and parked** at `PROPOSALS/killer-sudoku/`: solver, reference,
  generator and canonicaliser written and checked, generating nothing. It needs only the hardening
  hook, then its fixtures, player and calibration.
- `thermo-sudoku` and `sandwich-sudoku` would clear the schema, being boxed, and are blocked on
  hardening alone.
- `nonogram`, `slitherlink`, `kakuro`, `star-battle`, `hitori`, `masyu`, `akari`, `nurikabe`,
  `skyscrapers`, `futoshiki`, `binairo`, `shikaku`, `heyawake`, `yajilin`, `tents` and `norinori`
  are blocked on both.

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
- **The frozen hardening suite can only harden a sudoku digit grid.** `tools/harden.mjs` builds
  its own test instances and all of them are digit grids, so four of its seven passes cannot test
  a family with another encoding, and its fuzz pass would report a green line having tested
  nothing. Measured by running it, not inferred. The suite is frozen and was not changed; see
  `PROPOSALS/2026-09-19-family-agnostic-hardening.md`.
- **The frozen schema can only express a boxed grid.** `params` requires `size`, `box_h` and
  `box_w`, which describe how a sudoku's boxes tile its grid. Sixteen of the twenty rostered
  families have no boxes and cannot be onboarded without inventing a value for a field that does
  not apply to them. The three that remain reachable are all sudoku variants, so the corpus cannot
  grow genuinely sideways while this holds. The schema is frozen and was not changed; the argument for changing it is in
  `PROPOSALS/2026-09-19-family-agnostic-params.md` and needs an explicit instruction from the repo
  owner in a live session.
- **Band 5 depends on the ladder.** "Requires search" means requires search *given this solver's
  17 techniques*. A richer ladder would move some band-5 puzzles down. The ladder is published in
  `corpus/<family>/family.json` and frozen, so the meaning of a band cannot drift underneath the
  corpus.

Anything that would require changing a frozen file goes to `PROPOSALS/` as an argument, and the
session keeps working. Proposals are written, never acted on.
