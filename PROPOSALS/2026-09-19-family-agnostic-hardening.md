# The hardening suite can only harden sudoku-classic

**Written:** 2026-09-19, batch 002.
**Frozen file this concerns:** `tools/harden.mjs`.
**Status:** not applied. `tools/harden.mjs` is unchanged.

## The problem

`FOUNDATION.md` and `CLAUDE.md` both require that a new family ship a green
`tools/harden.mjs <family>` run before its first puzzle. `tools/harden.mjs` cannot produce one for
any family whose puzzles are not sudoku digit grids, because four of its seven passes build their
own test instances and every one of those instances is a string of digits and dots on a sudoku
shape:

| function | what it builds | line |
|---|---|---|
| `randomInstance(rng)` | a dug, corrupted or noisy digit grid | `tools/harden.mjs:99` |
| `minimalUniqueInstance(rng, S)` | a digit grid dug to uniqueness-minimality | `tools/harden.mjs:137` |
| `fuzzCase(rng, i)` | fifteen malformed digit grids | `tools/harden.mjs:159` |

The differential, uniqueness-adversarial, mutation and fuzz passes all draw from those three.
There is no hook a family can use to supply its own instances.

This is not a prediction. Running it against the killer sudoku family parked in
`PROPOSALS/killer-sudoku/` gives:

```
harden killer-sudoku (quick):
  pass  fixtures                      1 checked  0.0s
  FAIL  differential                120 checked  0.0s
Error: expected '|' at index 81, found none
    at minimalUniqueInstance (tools/harden.mjs:149)
    at uniquenessAdversarialPass (tools/harden.mjs:292)
```

The differential pass fails on every instance, because a killer sudoku's encoding is a cage layout
and a list of sums rather than a grid of givens, so each of those 120 strings is malformed for it.
The uniqueness-adversarial pass does not fail: it throws, and takes the whole run down with it.

The fuzz pass is worse than a failure. It would report **pass**, because a killer solver correctly
rejects every one of the fifteen malformed sudoku grids. A green fuzz line that tested nothing is
the kind of result this project exists to avoid.

## Why it matters

The corpus cannot grow sideways at all until this is resolved. Together with the `params` problem in
`PROPOSALS/2026-09-19-family-agnostic-params.md`, every one of the twenty rostered families is now
blocked: sixteen cannot express their parameters under the frozen schema, and all nineteen that are
not `sudoku-classic` cannot be hardened. `sudoku-classic` will keep producing validated puzzles
indefinitely, and they will all be sudoku.

`CLAUDE.md` is explicit about the risk this creates: "The risk is not visual sameness, it is a
corpus that is 90% sudoku with a thin decoration of everything else. Guard against it actively."
Right now the corpus is 100% sudoku and cannot become anything else.

## The change proposed

Give the hardening suite a per-family instance source, defaulting to exactly what it does today.

In `tools/harden.mjs`, replace the three direct calls with calls through the family adapter, each
falling back to the existing sudoku implementation when the adapter does not provide one:

```js
const instances = {
  randomInstance: S.randomInstance ?? randomInstance,
  minimalUniqueInstance: S.minimalUniqueInstance ?? minimalUniqueInstance,
  fuzzCase: S.fuzzCase ?? fuzzCase,
};
```

and pass `instances` into `differentialPass`, `uniquenessAdversarialPass`, `mutationPass` and
`fuzzPass` in place of the module-level functions.

A family that wants to be hardened then exports the three from its adapter. For killer sudoku they
are straightforward, and the pieces already exist in the parked family:

- `randomInstance` — a random cage layout over a complete grid, in three kinds: sound, corrupted
  (one cage sum altered) and noise (sums assigned at random).
- `minimalUniqueInstance` — merge cages to a fixpoint under uniqueness, which is the analogue of
  digging to uniqueness-minimality and is what the generator's stage A already does.
- `fuzzCase` — malformed encodings: a missing separator, a sum field of the wrong width, a cage
  label out of first-appearance order, a discontiguous cage, sums that cannot total a full grid,
  a cage larger than the grid's symbol count, and so on.

The mutation pass also needs one family-level idea rather than an instance: "remove one unit of
given information and check that uniqueness breaks." For classic that is removing a given; for
killer it is merging two cages. That is one more optional adapter export, `weakenings(instance)`,
returning the list of one-step weakenings to try.

## Why this is safe

The claim to check is that `sudoku-classic`'s hardening report comes out **identical**. It will,
and it is mechanically verifiable rather than a matter of judgement:

- `sudoku-classic`'s adapter exports none of the three, so all three fall back to the current
  module-level functions.
- The functions themselves are untouched, and so are the random seeds they are driven by
  (`makeRng('harden|differential|1')` and the rest), so the instance sequence is byte-identical.
- No check is weakened, removed, or made conditional. The passes assert exactly what they assert
  now.
- The way to confirm it: run `node tools/harden.mjs sudoku-classic --write-report` before and
  after and diff `HARDENING/sudoku-classic.md`. Only the date and the wall clock may differ.

## What this does not ask for

It does not ask to relax any check, change what a band means, change a budget, or change what the
gate accepts. It does not touch `solver/`, `schema/`, `tools/gate.mjs`, `.github/workflows/` or any
`bands.json`. It is a change to how the hardening suite obtains its test material, and to nothing
else.

## If it is declined

The corpus stays a sudoku corpus. That is a coherent choice — a hundred thousand trustworthy
classic sudoku across four grid shapes, six symmetries and five bands is a real artifact, and the
guarantee holds for every one of them. But `ROADMAP.md` and the roster in `CLAUDE.md` should then
be cut down to say so, rather than listing nineteen families that cannot be reached, and
`PROPOSALS/killer-sudoku/` should be deleted rather than left waiting.

The one thing that should not happen is a family onboarded without a hardening report. A family
whose solver has never been differentially tested against an independent reference has no
guarantee behind it, and shipping one would make the corpus's promise untrue for part of itself,
which is worse than a corpus of one family.
