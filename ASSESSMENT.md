# Where this stands — 2026-09-19

Written at the owner's request, after twelve batches, to be read before deciding what this project
should do next. It is not a status report. It is the case for and against continuing as specified,
with the numbers behind each claim and the three places where the design is fighting the plan.

Nothing here is a proposal to change anything. `FOUNDATION.md` says to write the argument down and
keep working, so that is what this is.

---

## 1. What exists

| | |
|---|---|
| Records in the corpus | **2,701** before this batch |
| Families | 3 — `sudoku-classic` (2,498), `binairo` (203), `nonogram` (new here) |
| Batches merged | 11, all on green CI |
| Puzzles rejected by the generator | ~57,800, about **22 rejected per one accepted** |
| Puzzles rejected by the gate | **0** |
| Audits | 2 (batches 005 and 010), both scoring 5/5 on uniqueness rigour and band accuracy |
| Corpus on disk | 2.6 MB of JSON, mean 1,026 bytes per record |

The headline number to hold onto is the one in bold near the bottom: **the gate has never rejected
a record.** That is not a gate that does nothing. It is a gate positioned after a generator that
already runs the same solver and the same reference brute force before it writes anything, so by
the time a record reaches the gate it has already passed the expensive checks. What the gate adds
on top — schema conformance, regeneration from the seed byte for byte, corpus-wide hash
uniqueness, and headless rendering — are checks the generator does not make, and they exist to
catch a **regression**, not to filter a batch. They have caught things during development; they
have never caught anything at batch time. Both of those sentences should be read together.

## 2. Is the guarantee worth anything?

This is the one question the project exists to answer, so it deserves a direct answer: **yes, and
more than I expected.**

The claim on every record is that it has exactly one solution and that its difficulty band is
measured rather than asserted. The evidence:

- **Uniqueness** is established by exhaustive counting that stops at two, and then independently
  confirmed by a brute force that shares no code with the solver. For sudoku and binairo that
  cross-check runs on every small instance and a sample of the large ones; for nonogram it runs
  unconditionally up to 100 cells.
- **The bands are honest, not merely self-consistent.** Audit 010 re-solved 300 records with a
  second solver, written independently, sharing no code with the first. It reproduced the hard/easy
  boundary exactly. That is the strongest single piece of evidence in the repository.
- **Band stability is enforced mechanically.** Each family's `bands.json` is frozen, and the solver
  asserts at load that its ladder still matches it. Change a technique's tier and the build breaks
  rather than silently reclassifying puzzles already shipped.
- **Nothing is hand-entered.** No puzzle record has ever been edited by hand; when something is
  wrong the generator is fixed and the batch regenerated.

Where I would temper it: the corpus is **92% sudoku**. The guarantee is strongest exactly where the
corpus is most concentrated, and thinnest where it is newest.

## 3. What a family actually costs

This is the number the original plan is most wrong about, and it is worth being blunt.

The `FAMILY ONBOARDING CONTRACT` requires, before one puzzle is generated: an independent solver
with a technique ladder, reference support, at least 40 fixtures with known verdicts, a green
hardening run, a calibrated and frozen `bands.json`, a working player passing its own self-tests,
and a manifest. For binairo and nonogram that came to roughly **1,200 lines of new code each**,
plus fixtures, plus measurement.

Generating the puzzles afterwards takes minutes. **Onboarding is the entire cost; generation is
free.** The plan's rhythm — "onboard a new family roughly every fifth batch" — has it backwards:
it treats onboarding as an occasional interruption to the real work of generating, when in fact
onboarding *is* the work and generating is the interruption.

Two consequences follow, and they are the actionable part of this document:

1. **The roster is twenty families.** Three are done. At the observed rate, the remaining
   seventeen are the project.
2. **A batch that onboards nothing is nearly worthless.** It adds a few hundred more puzzles to a
   family that already has hundreds. Batch 011 added 203 binairo puzzles to a corpus that had none;
   a batch 013 adding 203 more would add much less.

## 4. Three places the design fights the plan

### 4a. The batch balance rule cannot be satisfied, and will not be for a while

`CLAUDE.md` asks every batch to touch at least three families with no family over 40%. With three
families and one of them retired by instruction, that is arithmetically impossible — two usable
families cannot produce a batch where neither exceeds 40%. It stays impossible until a fourth
family exists, and awkward until a fifth.

This has now been recorded as "not drift" in `STATE.md` twice. It should either be relaxed to match
the roster's actual size, or accepted as a rule that starts applying at family four. What it should
not be is quietly ignored batch after batch, which is what is happening.

### 4b. Band 5 is not universal, and the rules assume it is

Every batch is supposed to span all five bands. But a band is defined by a family's own technique
ladder, and **not every family has a band 5 to give.**

For nonogram, no band-5 puzzle has been observed at any supported shape: a hypothesis on a single
cell, worked out with full line reasoning, resolves every unique nonogram measured. Band 4 exists
but is scarce, about one hill climb in thirty at 12×12. Binairo produces band 5 at exactly one
shape, 12×12, at roughly one puzzle per 325 attempts.

So "all five bands in every batch" is really "keep at least one family in the batch that happens to
have a deep ladder". That is a much weaker property than it sounds, and worth knowing before the
roster grows.

Related, and worth stating plainly: **band numbers are not comparable across families.** A band-3
nonogram and a band-3 sudoku are both "the third rung of their own ladder" and nothing more. The
tier weights are shared so the scores are on one scale, but the ladders are not the same ladder.

### 4c. A hundred thousand puzzles is a different engineering problem

The target is a hundred thousand records. At the current mean of 1,026 bytes that is about 100 MB
of JSON in **100,000 individual files** in a git repository that GitHub Pages serves from `main`.

The sharding is already right (`corpus/<family>/b<band>/<xx>/<id>.json`). What does not scale is
everything that walks the corpus: the gate re-verifies every record a branch changed, `build_index`
rebuilds the site, and the audit samples across the whole thing. At 2,701 records the full-corpus
gate with rendering is already a multi-minute job. At 100,000 it is not a job that fits in a batch.

This is solvable — incremental gating against a manifest of already-verified hashes, and an index
built per family rather than globally — but it is not solved, and nothing in the plan currently
asks for it. **I would put this ahead of adding families.** A corpus that cannot be re-verified is
a corpus whose guarantee decays quietly, and the guarantee is the entire product.

## 5. Two things that went wrong, and what they cost

Both are recorded in full in `STATE.md`; they are here because they are the kind of thing a
re-evaluation should weigh.

**An attempt budget is not a budget.** Batch 011 ran twenty-eight minutes at full CPU and wrote
nothing, which from outside is indistinguishable from a hang. Plan budgets were counted in
attempts, calibrated on sudoku where an attempt costs milliseconds; a binairo 12×12 attempt costs
about a second, so one plan's allowance worked out at over four hours and starved every plan behind
it. Fixed: each plan now gets a share of the clock, records are written as each plan finishes, and
progress is reported. The three plans hidden behind the starving one took one second, one second
and six seconds.

**A ladder can have a rung nothing can stand on.** The first nonogram ladder was the obvious one,
and measurement killed it: of 40 grids the second rung could not solve, the third rung solved
**none** and the fourth solved all 40. A band no puzzle can earn is a label that lies. The ladder
was rebuilt around how hard the solver may think inside a hypothesis, and re-measured. This is the
second time this exact trap has appeared — the same thing happened to the nonogram *line* tiers
earlier — and the lesson is now written where the next family will hit it: **measure a tier's
contribution before freezing the band that names it.**

## 6. What I would decide, if it were mine to decide

Ranked, most valuable first:

1. **Make the corpus re-verifiable at scale before it gets large.** Incremental gating and
   per-family indexing. Without it the guarantee erodes as the corpus grows, which is the one
   failure this project cannot survive.
2. **Onboard families continuously rather than every fifth batch.** Onboarding is the work. A
   batch whose only output is more puzzles in an existing family is low value.
3. **Fix the two rules that cannot currently hold** — the three-family balance rule and the
   all-five-bands rule — so that "the rules are met" means something again.
4. **Consider whether a hundred thousand is the right target at all.** Ten thousand trustworthy
   puzzles across fifteen families is a better artefact than a hundred thousand across five, and it
   is a much smaller engineering problem. The brief says a corpus you can trust beats a clever
   generator you cannot; it does not say the corpus has to be enormous.

The thing that is working, and should not be touched: the solver-gate separation, the frozen
calibration, the reference cross-check, and the refusal to hand-edit a record. That machinery is
the reason the difficulty labels survived an independent second solver, and it is the only reason
any of the rest of this is worth anything.
