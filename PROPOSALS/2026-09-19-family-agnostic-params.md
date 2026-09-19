# Proposal: `params` in the puzzle schema is sudoku-specific, and it blocks every unboxed family

**Status:** written, not acted on. `schema/` is frozen by `FOUNDATION.md` and changing it needs an
explicit instruction from the repository owner in a live session.

**Raised:** 2026-09-19, during batch 001, by the `001-onboard-nonogram` plan.

## What is wrong

`schema/puzzle.schema.json` says this about a record's `params`:

```json
"params": {
  "description": "Everything the generator needs besides the seed. Validated by the family's own generator, not by this schema.",
  "type": "object",
  "required": ["size", "box_h", "box_w"],
  "properties": {
    "size":  { "type": "integer", "minimum": 4, "maximum": 16 },
    "box_h": { "type": "integer", "minimum": 2, "maximum": 4 },
    "box_w": { "type": "integer", "minimum": 2, "maximum": 4 }
  }
}
```

The description is right and the `required` list contradicts it. `box_h` and `box_w` describe how a
sudoku's boxes tile its grid. **A nonogram has no boxes.** Neither does slitherlink, kakuro,
star-battle, hitori, masyu, akari, nurikabe, skyscrapers, futoshiki, binairo, shikaku, heyawake,
yajilin, tents or norinori — sixteen of the twenty families on the roster.

So `001-onboard-nonogram` cannot be completed. Every nonogram record would have to carry a
`box_h` and a `box_w`, and there is no honest value to put there. Inventing one would break rule 1
of the UNIT CONTRACT: *a record is data, never prose.* A field whose value is chosen to satisfy a
validator, and which means nothing about the puzzle, is not data.

This is a Phase 0 mistake. The first family had boxes, and its shape parameters were written into a
schema that is meant to cover all families.

## Why it was not simply fixed

`FOUNDATION.md`: *"After Phase 0, these are immutable ... `schema/` ... If you believe one must
change, write the argument to `PROPOSALS/<date>-<topic>.md` and keep working. Do not change it."*

That rule exists because the dominant failure mode of a long autonomous build is a session deciding
to refactor the foundation and invalidating everything before it. The rule is doing its job here,
and it is being followed even though this particular change would invalidate nothing.

## The change proposed

Make the three keys optional and let each family's generator enforce its own:

```json
"params": {
  "type": "object",
  "minProperties": 1,
  "properties": {
    "size":  { "type": "integer", "minimum": 2, "maximum": 64 },
    "box_h": { "type": "integer", "minimum": 2, "maximum": 8 },
    "box_w": { "type": "integer", "minimum": 2, "maximum": 8 },
    "rows":  { "type": "integer", "minimum": 2, "maximum": 64 },
    "cols":  { "type": "integer", "minimum": 2, "maximum": 64 }
  }
}
```

That is the whole change: drop `required`, widen the bounds, add `rows` and `cols` for families
whose grids are not square.

## Why this does not weaken anything

- **No shipped puzzle is invalidated.** Every existing `sudoku-classic` record still validates: it
  still carries all three keys with the same values. The change is strictly widening.
- **Sudoku's shape rules are not relaxed.** They were never enforced by the schema in the first
  place. `tools/gate.mjs` check 1 already calls `G.validateParams(record.params)`, and
  `generators/sudoku-classic/index.mjs` rejects any shape outside the supported set, any box that
  does not tile the grid, and any unknown key. The schema's `required` list is redundant with a
  check that is both stricter and family-aware.
- **Nothing about the solver, the gate, the uniqueness proof or the bands is touched.** This is a
  validation surface for generator inputs, not part of the guarantee.

## What happens if it is declined

Sixteen of the twenty rostered families stay unreachable, and the corpus can only ever hold boxed
sudoku variants: `sudoku-classic`, `killer-sudoku`, `thermo-sudoku`, `sandwich-sudoku`. That is the
outcome `CLAUDE.md` warns about in as many words — *"a corpus that is 90% sudoku with a thin
decoration of everything else"* — arrived at by a validator rather than by neglect.

## What is being done in the meantime

`001-onboard-nonogram` is moved to `queue/blocked/` with a notes file pointing here, and the roster
is worked in an order the frozen schema allows: `killer-sudoku` is onboarded next, since cage
arithmetic is genuinely new solving logic and a killer sudoku has boxes, so its `params` are honest
under the schema as frozen.

Batches continue. Nothing else is blocked by this.
