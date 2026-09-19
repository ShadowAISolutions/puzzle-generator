# FOUNDATION

The permanent contract for this repository. Copied here in Phase 0 and **immutable** thereafter
without an explicit instruction from the repository owner in a live session.

This project exists for one thing: **trust**. Anyone should be able to take any puzzle out of this
corpus and know, without checking, that it has exactly one solution and that its stated difficulty
means what it says. Every rule below serves that.

---

## UNIT CONTRACT

One puzzle = one JSON record at:

`corpus/<family>/b<band>/<xx>/<id>.json` — where `id` is the first 16 hex characters of the
canonical hash and `xx` is its first two, so no directory exceeds a few thousand files.

Every record validates against `schema/puzzle.schema.json` and contains:

| Field | Meaning |
|---|---|
| `id` | first 16 hex of `canonical_hash` |
| `family`, `family_version` | e.g. `sudoku-classic`, `1` |
| `generator_version`, `solver_version` | the exact versions that made and cleared it |
| `seed`, `params` | everything needed to regenerate it byte-identically |
| `puzzle` | the givens, in the family's canonical encoding |
| `solution` | the unique solution |
| `clues` | count of givens; derived, and re-checked by the gate |
| `uniqueness` | `{ verdict: "unique", method, nodes_searched, reference_checked }` |
| `difficulty` | `{ band: 1-5, score, techniques: [...], max_search_depth }` |
| `canonical_hash` | hash of the givens reduced under the family's symmetry group |
| `created_at`, `batch` | provenance |

Hard rules:

1. **A record is data, never prose.** No hand-written fields, no commentary.
2. **Regenerable.** `(generator_version, seed, params)` reproduces the record byte for byte. The
   gate checks this on every puzzle. "Byte for byte" is over the **content fields** — everything
   except `created_at` and `batch`, which record when a puzzle was made rather than what it is.
   The exact list is `CONTENT_FIELDS` in `tools/record.mjs`, and records serialise through one
   canonical JSON writer (`lib/jsonio.mjs`) with keys sorted at every level, so the comparison is
   a real byte comparison and not a structural one.
3. **Deduplicated under symmetry.** The canonical hash is computed after reducing the givens under
   the family's full symmetry group — rotations, reflections, and any relabelling that preserves
   the puzzle. Two puzzles that are the same puzzle in disguise do not both enter the corpus.
4. **Small.** Each record under 16KB. Each family index under 5MB.
5. **Difficulty comes from the solver, never from the generator.** If a generator was asked for a
   band-4 puzzle and the solver's trace says band 2, the record says band 2, or it is rejected. The
   generator's intent is not evidence.

`difficulty.techniques` is the distinct deduction rules the solver applied, in order of first
application. The full ordered trace is not stored; the `score` carries how much of each was needed,
and the gate recomputes both from a fresh solve.

Each family also carries `corpus/<family>/family.json`: display name, rules summary, the canonical
encoding, the symmetry group, the technique ladder with band thresholds, and a link to its
hardening report. It is generated from the family's solver adapter, never hand-written.

---

## THE GATE

`node tools/gate.mjs <path-or-family-or---all>` admits a puzzle only if **every** check passes.
There are no exceptions and no overrides.

1. **Schema** — the record validates, and `family_version`, `solver_version` and
   `generator_version` exist and are current.
2. **Solvable** — the independent solver finds a solution, and it matches `solution`.
3. **Unique** — the solver proves no second solution exists, counting to two and stopping.
4. **Cross-checked** — the reference brute force independently confirms the verdict, for every
   instance under the family's size threshold and a random 2% above it. The 2% is derived from the
   record id, so it is the same 2% on every machine.
5. **Banded** — the band is recomputed from the solver's technique trace and matches the record.
6. **Regenerable** — regenerating from `(generator_version, seed, params)` reproduces the record
   byte for byte.
7. **Unique in the corpus** — the canonical hash does not already exist.
8. **Renderable** — the family's player loads the puzzle headlessly with no console error and no
   network request, its `window.__SELFTEST()` passes, and a screenshot lands in `.artifacts/` for
   the audit pass. Sampled, not every puzzle: the first of each band in each batch, plus a
   random 1%. The headless viewport is 360px wide, the narrowest width the site contract covers.
9. **Bounded** — every solver call ran inside the per-instance budget. **A timeout is a rejection.**

A puzzle that does not pass the gate is not committed. Rejections are normal and expected; log the
counts and the reasons in `STATE.md`. **The rejection rate is a health signal. If it collapses to
near zero, suspect the gate before you congratulate the generator.**

### What "bounded" means here

The primary bound is a **node budget**, which is deterministic: the same instance exhausts it at the
same point on every run and every machine, so a verdict reached inside the budget is reproducible.
A wall-clock deadline sits behind it only as a backstop. Exhausting either raises `BudgetExceeded`,
and every caller must treat that as a rejection. It is never a pass.

---

## SOLVER INDEPENDENCE

The guarantee is only worth something if the thing checking the puzzle is not the thing that made it.

- `solver/` imports nothing from `generators/`. CI enforces this with a static import check that
  fails the build. The check also forbids a generator from reaching past a family's public solver
  adapter into its internals.
- A generator may call the solver — that is how it searches for a unique instance — but it may never
  read the solver's internals, patch its behaviour, pass it hints, or construct a puzzle by
  inverting a solver trace it kept from an earlier call.
- The band is read from the solver's trace on a fresh solve of the finished puzzle, with no state
  carried over from generation.
- When the solver and the reference disagree, **the solver is wrong until you have proven otherwise,
  in writing, in `HARDENING/<family>.md`.** Never "fix" the reference to agree with the solver.

---

## FROZEN FILES

After Phase 0, these are **immutable** without an explicit instruction from the repo owner in a
live session:

`FOUNDATION.md`, `CLAUDE.md`, `schema/`, `solver/`, `tools/gate.mjs`, `tools/harden.mjs`,
`.github/workflows/`, and every `bands.json`.

Adding a **new** family's solver, fixtures and bands is additive and allowed. Changing an existing
family's solver, gate or bands is not. If you believe one must change, write the argument to
`PROPOSALS/<date>-<topic>.md` and keep working. Do not change it.

This rule exists because the dominant failure mode of a long autonomous build is a session on day 40
deciding to refactor the foundation and invalidating everything before it. Here it is worse than
that: relaxing the solver silently invalidates every puzzle already shipped.

A family's `bands.json` is defended in code as well as in prose: the solver adapter asserts at load
that the technique ladder in code still matches `bands.json` exactly, and refuses to load if it does
not. Editing a technique's tier therefore breaks the build rather than quietly reclassifying the
corpus.

---

## DIFFICULTY BANDS

Five bands, defined per family by the solver's technique ladder. A puzzle's band is the **highest
technique tier required by the easiest complete solution path the solver can find** — not the first
path it happens to take. Operationally: the lowest tier ceiling at which deduction alone completes
the grid, found by trying ceiling 1, then 2, and so on.

| Band | Name | Meaning |
|---|---|---|
| 1 | Gentle | the lowest tier of deductions alone completes it |
| 2 | Easy | needs the second tier |
| 3 | Medium | needs mid-tier techniques |
| 4 | Hard | needs advanced techniques, still no guessing |
| 5 | Brutal | requires bounded search; record `max_search_depth` |

Bands 1–4 are solvable by pure deduction with no guessing. Band 5 is the only band where search is
permitted, and it is always flagged as such in the record so a reader knows what they are getting.
Each family maps its own technique names onto these tiers in `solver/<family>/bands.json`,
calibrated once in Phase 0 and frozen.

`max_search_depth` is the deepest guess nesting the search entered, over the whole search and not
only the path that succeeded. It is zero for bands 1 to 4, which need no search at all.

Report a `score` alongside the band — a continuous measure from the trace (count of applications,
weighted by tier) — so within-band ordering is possible later without ever reopening the band
thresholds. Concretely: `score = Σ tier_weight(each application) + search_depth_weight ×
max_search_depth` for band 5. The weights live in `bands.json` and are frozen with it.

A band is a statement about **this solver's ladder**, which is published in each family's
`family.json`. It is not a claim that another publisher's "hard" means the same thing.
