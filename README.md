# Puzzle Corpus

A growing, machine-generated library of logic puzzles in which **every single puzzle has been
validated by an independent solver** for solvability, solution uniqueness and difficulty band.

**Repository:** `ShadowAISolutions/puzzle-generator` · **Browse and play:**
<https://shadowaisolutions.github.io/puzzle-generator/>

The solver was built and hardened *before* a single puzzle was generated. That order is the whole
point.

---

## What you can rely on

Take any puzzle out of this corpus and you can rely on three things without checking them yourself.

**It has exactly one solution.** Not "we did not find a second one" — the solver counts solutions
and stops at two, so a verdict of `unique` means the search *established* that a second solution
cannot exist. A separate brute-force reference, written independently and deliberately slow, then
confirms that verdict for every puzzle at or below the family's size threshold, and for a
deterministic 2% above it.

**The thing that checked it is not the thing that made it.** `solver/` imports nothing from
`generators/`, and continuous integration fails the build if that ever changes. A generator may
*call* the solver — that is how it searches for a unique instance — but it can never read the
solver's internals, patch its behaviour, or hand it hints.

**Its difficulty is measured, not asserted.** A puzzle's band is the highest technique tier needed
by the easiest complete solution path the solver can find, read off a fresh solve of the finished
puzzle. If the generator was asked for a band-4 puzzle and the trace says band 2, the record says
band 2. Bands 1 to 4 need no guessing at all. Band 5 is the only band that requires bounded search,
and every band-5 record carries the depth it needed.

### What the guarantee does not cover

- It says nothing about whether a puzzle is **enjoyable**. Solvability, uniqueness and band are
  objective; elegance is not.
- A band is a statement about **this solver's technique ladder**, published in each family's
  `corpus/<family>/family.json` and frozen. It is not a claim that another publisher's "hard" means
  the same thing.
- The uniqueness proof is a proof about the **puzzle as encoded**. It is not a claim about a
  variant rule set someone might apply to the same grid.
- Nothing here is a claim about **novelty**. Puzzles are deduplicated under each family's full
  symmetry group within this corpus; two corpora can still overlap.

---

## Browsing

`index.html` at the repository root is the browse page: filter by family, band, grid shape and
clue count, and open any puzzle in its player. It is served by GitHub Pages from `main` at the
repository root, has no build step, and makes **no external network request of any kind**.

Each family has a player at `site/play/<family>.html`. It loads a record, lets you solve it, and
checks your solve locally in your browser against the record. Nothing is sent anywhere.

## Using the corpus without cloning

- `corpus.json` — the corpus-wide index: families, counts by band, clue ranges, grid shapes.
- `downloads/<family>.json` — one compact row per puzzle in that family.
- `downloads/<family>-b<band>.json` — whole records for one band of one family.

A single record lives at `corpus/<family>/b<band>/<xx>/<id>.json`, where `id` is the first 16 hex
characters of the canonical hash and `xx` is its first two.

---

## Running the gate yourself

```sh
npm ci
node tools/gate.mjs --all            # every puzzle in the corpus
node tools/gate.mjs sudoku-classic   # one family
node tools/gate.mjs corpus/sudoku-classic/b3/a1/a1b2c3d4e5f60718.json
node tools/gate.mjs --all --render   # also load a sample in a headless browser
```

The gate admits a puzzle only if **every** check passes. There are no exceptions and no overrides:

| # | Check | What it establishes |
|---|---|---|
| 1 | Schema | the record validates, and its versions are current |
| 2 | Solvable | the solver finds a solution, and it matches the record |
| 3 | Unique | the solver proves no second solution exists, counting to two |
| 4 | Cross-checked | the reference brute force independently confirms it |
| 5 | Banded | the band recomputed from the trace matches the record |
| 6 | Regenerable | `(generator_version, seed, params)` rebuilds the record byte for byte |
| 7 | Corpus-unique | the canonical hash is not already in the corpus |
| 8 | Renderable | the player loads it headlessly, clean, and its self-tests pass |
| 9 | Bounded | every solver call stayed inside its budget — **a timeout is a rejection** |

Other commands:

```sh
node tools/harden.mjs sudoku-classic   # the solver hardening suite
node tools/check_imports.mjs           # solver/ must not import generators/
node tools/validate_schema.mjs         # every record against the schema
node tools/build_index.mjs             # regenerate index.html and the download bundles
```

---

## How uniqueness is established

1. The solver builds a candidate grid from the givens and propagates forced placements.
2. It searches, branching on the cell with the fewest candidates, and **counts solutions up to
   two**, then stops. Zero means unsolvable; one means unique, because the tree was exhausted;
   two means the puzzle is not admissible.
3. The **reference** — `solver/reference/`, a plain row-major backtracking search with no
   heuristics, no candidate sets and no shared code — independently repeats the count.
4. Every call runs under a **node budget**, which is deterministic, with a wall-clock deadline
   behind it as a backstop. Exhausting either is a rejection, never a pass.

When the two disagree, **the solver is wrong until proven otherwise, in writing**, in
`HARDENING/<family>.md`. The reference is never adjusted to agree with the solver.

Before a family may generate anything, `node tools/harden.mjs <family>` must pass seven ways:
every fixture classified correctly; 2,000 random instances agreeing with the reference; every
`unique` verdict confirmed independently; removing a given from a minimal instance always breaking
uniqueness under both solvers; identical verdicts, traces and bands on repeat runs and in a
separate process; 10,000 malformed and adversarial inputs handled without a crash or a hang; and
every fixture's technique trace still matching its calibrated band. The report is committed to
`HARDENING/<family>.md`. **A family with no committed hardening report generates nothing.**

---

## Layout

```
corpus/           the puzzles, sharded by family, band and id prefix
solver/           the independent solvers, plus the brute-force reference
generators/       per-family generators; never imported by solver/
schema/           JSON Schema for records and family manifests
tools/            the gate, the hardening suite, the batch driver, the index builder
site/play/        one self-contained player per family
fixtures/         instances with known verdicts, used to harden the solvers
HARDENING/        one committed report per family
AUDIT/            periodic audits of the corpus
PROPOSALS/        arguments for changing something frozen; written, never acted on
queue/            plan files waiting to be run
FOUNDATION.md     the permanent contract
CLAUDE.md         operating rules for the build sessions
STATE.md          what has happened, and every decision that settled an ambiguity
```

`FOUNDATION.md`, `CLAUDE.md`, `schema/`, `solver/`, `tools/gate.mjs`, `tools/harden.mjs`,
`.github/workflows/` and every `bands.json` are **frozen**. Adding a new family is additive and
allowed; changing an existing family's solver, gate or bands is not, because relaxing a solver
silently invalidates every puzzle already shipped.
