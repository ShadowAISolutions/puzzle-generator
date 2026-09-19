# STATE

## Standing corrections

*(Anything here must be read before the next puzzle is generated. Empty is the normal state.)*

Nothing outstanding.

---

## Decisions

Decisions that settle an ambiguous choice, so no future session re-litigates them.

### 2026-09-19 — the band-3 9x9 "decline" is not drift, and nothing frozen has moved

The band-3 9x9 acceptance rate read 3.0% at Phase 0, 2.0% in batch 001, 1.5% in batch 002 and 1.2%
in batch 003, which looks like a trend and was briefly recorded as one. It is not, and no future
session should chase it as one.

**Nothing frozen has drifted, and this is proved rather than argued.** The gate's `banded` check
re-derives band, score, `max_search_depth` and the full technique trace from the current solver and
fails a record whose stored values differ. `node tools/gate.mjs --all --render` passed **760/760**
this batch. Every Phase 0 and batch 001 record therefore still classifies today exactly as it did
when it was written, trace included. If `bands.json` or the ladder had moved by one technique, those
older records would fail. This is the audit step 4 check, available every batch for free, and it is
stronger than re-running the classifier over a 200-record sample.

**The four figures are four different symmetries.** Every other parameter is identical across them
(`size` 9, `3x3`, `min_clues` 17, `dig_passes` 6); only `symmetry` changes: `rot180` at Phase 0,
`diagonal` in 001, `mirror_h` in 002, `mirror_v` in 003. So they were never a time series.

Re-measuring all five symmetries in one run, today, with the same code (a scratch copy, 20
acceptances each, 7,092 rejections total):

| symmetry | attempts for 20 | acceptance |
|---|---:|---:|
| `none` | 622 | 3.2% |
| `diagonal` | 1,429 | 1.4% |
| `rot180` | 1,619 | 1.2% |
| `mirror_h` | 1,739 | 1.2% |
| `mirror_v` | 1,783 | 1.1% |

What this establishes: **`none` is about 2.5x cheaper than any constrained symmetry, and the four
constrained symmetries are indistinguishable from each other** at this sample size. A band-3 9x9
plan on a constrained symmetry costs roughly 1,700 attempts for 20 puzzles, against the 8,000 the
plan budget allows, so there is about 4.7x headroom and nothing is at risk.

What it does not establish: why Phase 0 recorded 3.0% for `rot180` when `rot180` measures 1.2%
today. The classifier is proved unchanged, so the honest options are that the Phase 0 figure was
computed differently from an attempts-to-target rate, or that it was a small sample stated too
precisely. It was not re-derived, and it should not be treated as a comparable measurement.

**The lesson worth keeping:** a difficulty-acceptance rate is only comparable across batches when
the plan parameters match, and the queue varies symmetry from plan to plan by design. Compare
like with like, or compare nothing.

### 2026-09-19 — the gate was proved live, because it had never rejected anything

Three batches in, the gate's record is **660 accepted, 0 rejected**. Every rejection in batches
001, 002 and 003 came from the generator's own band check (`band-mismatch`), never from the gate.
`CLAUDE.md` is explicit that this is the moment to suspect the gate rather than congratulate the
generator, so it was checked instead of assumed.

Method: a full copy of the repository under the scratchpad, never the corpus itself, with one real
band-3 9x9 record broken four ways and re-gated. Results, all as they should be:

| break | checks that fired |
|---|---|
| remove one given | `unique` ("solver says multiple"), `solvable` |
| corrupt the stated solution | `solvable`, `cross-checked` (the reference caught it independently), `regenerable` |
| claim band 4 instead of 3 | `banded`, `corpus-unique`, `regenerable` |
| `clues` off by one | `schema` |
| a player whose board overflows a 360px phone | `renderable` |

**Eight of the nine checks were observed firing:** `schema`, `solvable`, `unique`, `banded`,
`cross-checked`, `regenerable`, `corpus-unique`, `renderable`.

`renderable` is worth its own line, because operating rule 3 says a gate cannot see a board printed
off the edge of the screen. It can. Widening the board to 900px in a scratch copy of the player
failed the record with `selftest failed: the board fits a 360px viewport board is 900px wide` and
`the page does not scroll sideways page scrolls to 630px in a 360px viewport`. So the player's own
selftests cover exactly the failure rule 3 warns about, and the gate refuses a record whose player
cannot draw it on a phone. Opening the screenshots is still worth doing for the things no assertion
names — crowding, contrast, a grid that is technically inside the viewport and still unpleasant.

`bounded` is the one check still unobserved in production. It fires only on `BudgetExceeded`, which
no valid record has yet provoked; the hardening suite exercises that path instead. Provoking it by
shrinking a budget in a scratch copy would prove nothing, so it was not done.

So the zero-rejection record is a property of the generator, not a dead gate: the generator
validates with the same solver before offering a candidate, so the gate is a verification step
rather than a filter, which is the intended defence in depth.

Two things found on the way, worth keeping:

- **The gate checks the storage path first and returns immediately if it is wrong.** Broken copies
  placed anywhere but their proper `corpus/<family>/b<band>/<xx>/<id>.json` fail on `schema` alone
  and the other eight checks never run. A future session testing the gate must place its cases at
  the path the record's own fields imply, or it will prove nothing and think it proved something.
- **The band is part of the path**, so a record that lies about its band lands in a different
  directory and `corpus-unique` fires against the honest copy. Deduplication of genuinely
  symmetry-equivalent puzzles, though, is enforced by the path and not by that check: two such
  puzzles share a canonical hash, hence an id, hence a filename, so the second silently overwrites
  the first rather than being rejected. The guard against that is the accepted count matching the
  corpus growth, which held for every batch so far (+220 each).

### 2026-09-19 — the band-3 mechanism was hand-verified, not just self-consistent

An internally consistent band is worthless if the ladder is mislabelled, so one band-3 puzzle was
traced by hand at calibration. `corpus/sudoku-classic/b3/0d/0dc92ca0833503d2.json`, 30 clues:
deduction is stuck at 39 open cells under a tier-1 ceiling **and** under a tier-2 ceiling, and
completes under tier 3.

At the tier-2 stuck state, row 0 holds r0c0 {1,7,9}, r0c1 {7,9} and r0c7 {7,9} — three cells whose
candidates union to exactly three digits, which is a naked triple. So 1, 7 and 9 must occupy those
three cells and can leave the rest of the row, giving r0c2 {1,2,7,8,9} → {2,8}, r0c6 {2,3,4,7,9} →
{2,3,4} and r0c8 {2,3,4,9} → {2,3,4}. Those are exactly the three eliminations the solver made, and
they are sound. No tier-2 technique reaches them: a naked pair cannot, because r0c0 has three
candidates, and there is no hidden pair to find, since digit 7 has five possible cells in that row.

The band is therefore honest and not merely self-consistent. Two such hand-traces are required of
every audit pass; this is the Phase 0 one.

### 2026-09-19 — a completed plan file is deleted, not archived

The loop moves a plan from `queue/` to `queue/in-progress/` when it is claimed, and to
`queue/blocked/` if it cannot deliver. It says nothing about a plan that succeeds. Leaving those in
`queue/in-progress/` would break the one thing a resuming session needs that directory to mean:
**what is claimed right now**. So a completed plan file is deleted, and `STATE.md` under
`## Batches` is the record of what it produced. `queue/blocked/` keeps its notes file, because a
blocked plan is unfinished business.

### 2026-09-19 — Phase 0 lands on `claude/project-thread-m3ash8`; batches use `batch/NNN`

This session was given `claude/project-thread-m3ash8` as its development branch, so the Phase 0
pull request comes from there. From batch 001 the loop uses `batch/<NNN>` branches as the mission
brief specifies. Either way nothing is ever pushed to `main`, and nothing is merged red.

### 2026-09-19 — the repository is `ShadowAISolutions/puzzle-generator`

Resolved in Session Zero. One repository was attached to the project and it held only an initial
commit. It is public, its default branch is `main`, and GitHub Pages is enabled and serving `main`
at the repository root.

Two things this sandbox cannot do, both confirmed by trying: **deleting a git ref** and **writing
repository settings** are blocked by the network proxy. So merged `batch/NNN` branches accumulate,
and "delete branch on merge" cannot be turned on from a session. This is cosmetic and blocks
nothing. The Pages *settings* endpoint and the `github.io` host are blocked from here too, so a
session can confirm that Pages is on but not read back which branch it serves or fetch the
published page.

### 2026-09-19 — supported sudoku grid shapes are 4, 6, 8 and 9

The canonical hash must reduce the givens under the family's **full** symmetry group, and this
implementation does that exactly, by enumerating the group rather than approximating it. That caps
which shapes are admissible, because the group grows explosively:

| Shape | Group order (before transposition) | Verdict |
|---|---:|---|
| 4×4 (2×2) | 64 | fine |
| 6×6 (2×3 and 3×2) | 3,456 | fine |
| 8×8 (2×4 and 4×2) | 442,368 | fine |
| 9×9 (3×3) | 1,679,616 | fine, ~5ms per puzzle |
| 12×12 (3×4) | 2.6 billion | **excluded** |
| 16×16 (4×4) | 6.3×10¹³ | **excluded** |

An exact canonical form is worth more than a larger grid: an approximate one would let the same
puzzle in disguise enter the corpus twice, which is exactly what rule 3 of the UNIT CONTRACT
forbids. Variety comes from clue count, symmetry mode and new families instead.

A 5ms canonicalisation is only affordable because the search prunes on the first row. See the
comment at the top of `solver/sudoku-classic/canonical.mjs`; the naive scan is 100ms and was
measured before being replaced.

### 2026-09-19 — "bounded" means a node budget first, wall clock second

Requirement 5 of the hardening suite is that the same instance gives the same verdict, trace and
band on repeat runs *and across processes*. A wall-clock timeout cannot deliver that: a slow
machine would classify a puzzle differently from a fast one. So the primary bound is a
**deterministic node budget**, with a wall-clock deadline behind it purely as a backstop. Both
raise `BudgetExceeded`, and every caller treats that as a rejection.

### 2026-09-19 — the reference budget is sized from a measured worst case

The reference is naive row-major backtracking, so its cost has nothing to do with how hard a puzzle
is for a human. The fixture `published-near-worst-case-backtracking` is **band 1** — singles alone
finish it — and takes the reference **69.2 million nodes and about 18 seconds**. Generated puzzles
take a few thousand nodes. The budget is set at 120 million nodes and 90 seconds: enough headroom
for the known worst case, still a real bound.

### 2026-09-19 — the band is targeted by digging to minimal, then filling back

Difficulty is monotone in the givens: adding a clue can never make a puzzle harder. Two approaches
were tried.

*Digging under a tier ceiling* was tried first and **does not work**. Measured: a ceiling of tier 1
produced band 1 for 20 of 20; a ceiling of tier 3 still produced band 1 for 16 of 20. By the time a
grid is minimal for tier 1 it is close to minimal for uniqueness too, so there is no room left to
push the band up — stage 2 of that scheme accepted **zero** further removals in 12 of 12 runs.

*Digging to uniqueness-minimality and then filling clues back* works exactly. Measured over 15
attempts per band: every puzzle produced landed on its target band, and everything else was
reported as an honest miss rather than shipped at the wrong band. See the method comment at the top
of `generators/sudoku-classic/index.mjs`.

### 2026-09-19 — band reachability is not uniform, and band 3 is scarce

Measured at calibration, hits within a 400–600 attempt cap (25 means "plentiful, capped"):

| Shape | b1 | b2 | b3 | b4 | b5 |
|---|---:|---:|---:|---:|---:|
| 4×4 (2×2) | 25 | 0 | 0 | 0 | 0 |
| 6×6 (2×3) | 25 | 2 | 0 | 18 | 0 |
| 6×6 (3×2) | 25 | 1 | 1 | 18 | 2 |
| 8×8 (2×4) | 25 | 25 | 3 | 25 | 25 |
| 8×8 (4×2) | 25 | 25 | 4 | 25 | 25 |
| 9×9 (3×3) | 25 | 25 | 20 | 25 | 25 |

**A 4×4 sudoku admits band 1 and nothing else** — singles finish every 4×4 with a unique solution,
so there is no harder 4×4 to find. **Band 3 is scarce everywhere and only really available at 9×9**,
at roughly 3% of attempts, about 0.45 seconds per accepted puzzle. That is affordable, but band-3
plans need an attempt budget around 400× their count, and `tools/make_plans.mjs` sets one.

This is a property of the technique ladder, not a defect: tier 3 is triples, quads and X-wing, and
a puzzle that needs exactly those and nothing harder is genuinely uncommon. It is recorded here so
that a future session reads a thin band 3 as expected rather than as drift.

### 2026-09-19 — plans are interleaved across bands, not sorted by thinness

A batch claims five consecutive plans and must touch all five bands. Sorting the queue purely by
which band the corpus is thinnest on handed a batch five band-4 plans on one grid shape. The queue
is now woven: thinnest-first *within* each band, then round-robin across bands.

### 2026-09-19 — `techniques` stores distinct rules, not the full ordered trace

The UNIT CONTRACT asks for `difficulty.techniques`. The full ordered trace of a hard 9×9 runs to
dozens of entries and buys nothing a reader or the gate needs: the gate recomputes the whole trace
from a fresh solve anyway, and `score` already carries how much of each tier was needed. So the
field stores the distinct rules in order of first application, and the gate compares that.

### 2026-09-19 — a family whose params the frozen schema cannot express goes to `queue/blocked/`

`schema/puzzle.schema.json` requires every record's `params` to carry `size`, `box_h` and `box_w`.
Those three describe how a sudoku's boxes tile its grid. A nonogram has no boxes, so there is no
honest value to put in the two box fields, and inventing one would break rule 1 of the UNIT
CONTRACT: a record is data, never prose. The schema is frozen, so it was **not** changed. The
argument for changing it is written up in `PROPOSALS/2026-09-19-family-agnostic-params.md`, the
plan moved to `queue/blocked/001-onboard-nonogram.md` with its obstacle beside it, and the roster
in `tools/make_plans.mjs` now onboards `killer-sudoku` next, because a killer sudoku has boxes and
its params are honest under the schema as frozen.

Sixteen of the twenty rostered families have no boxes and are blocked the same way. Onboarding is
not stuck: `killer-sudoku`, `thermo-sudoku` and `sandwich-sudoku` are sudoku variants on a boxed
grid, so all three fit, which is three families and several batches of work. But the corpus cannot
reach the variety the mission asks for until the repo owner instructs a live session to widen
`params`, and three sudoku variants are not the defence against a sudoku-shaped corpus that
`## FAMILIES AND VARIETY` asks for.

Two supporting fixes went in with this, both to `tools/make_plans.mjs`, which is not frozen. The
onboarding emitter used to offer `ROSTER`'s first missing family and give up if that family's plan
was already written, so one blocked family stalled the entire roster; it now offers the first
missing family that is not already queued, in progress or blocked. And `main()` ran on import,
so importing the module to read `ROSTER` silently refilled the queue; it is now behind the usual
`import.meta.url` guard.

### 2026-09-19 — the frozen hardening suite can only harden `sudoku-classic`

`tools/harden.mjs` builds its own test instances, and every one of them is a sudoku digit grid on a
sudoku shape: `randomInstance`, `minimalUniqueInstance` and `fuzzCase` all produce strings of
digits and dots. Four of the seven passes draw from those three, and there is no hook a family can
use to supply its own. Run against a family with another encoding, the differential pass fails on
every instance and the uniqueness-adversarial pass throws and takes the run down. Worse, the fuzz
pass reports **pass**, because a correct solver rejects every malformed sudoku grid handed to it:
a green line that tested nothing.

The file is frozen, so it was not changed. The argument, the exact change, and how to verify it
leaves `sudoku-classic`'s report byte-identical are in
`PROPOSALS/2026-09-19-family-agnostic-hardening.md`.

**This blocks every remaining family.** Sixteen of the twenty cannot express their params under the
frozen schema, and all nineteen non-classic families cannot be hardened. A future session should
read the corpus being 100% sudoku as this, not as a session that forgot to onboard anything.

### 2026-09-19 — killer-sudoku is built and parked, not abandoned

The expensive part of a family is its solver, so it was written before the blocker was found, and
it is kept. It lives at `PROPOSALS/killer-sudoku/`, which nothing scans and nothing imports, with a
README giving each file's destination under `solver/` and `generators/`. It is in no registry and
generates nothing. A directory under `solver/` would fail CI, which requires a passing
`HARDENING/<family>.md` for every one.

What it is: a 23-technique ladder over four tiers plus bounded search, reusing the frozen classic
techniques (every classic deduction is valid in killer) and adding six cage rules — `cage_single`,
`cage_combination`, `cage_hidden_single`, `cage_innie_single`, `cage_innie_set` and
`cage_group_sum`. Cage distinctness needs no technique: the family's geometry puts cage-mates into
the peer relation, so the frozen `assign()` propagates it without a frozen file changing.

Measured, not estimated: all five bands are reachable on a 9x9, the technique sets escalate exactly
as the ladder predicts with `bounded_search` confined to band 5, generation takes 0.1 to 4.0
seconds per puzzle, and the encoding of a 9x9 with 22 to 38 cages is 126 to 158 characters, inside
the schema's 256-character limit.

### 2026-09-19 — the corpus's deduplication key was checked against a brute force, and is sound

`solver/sudoku-classic/canonical.mjs` was compared against an obviously correct brute force over
the family's whole symmetry group, on sixteen corpus records, four at each grid shape. **Exact
agreement, including at 9x9**, where the brute force enumerates 3,359,232 orientations and takes
28 seconds for four records.

Worth doing because the killer canonicaliser, written the same week, was wrong. It carried a prefix
comparison down the recursion, and that comparison is a statement about the running best — which
goes stale the moment a deeper leaf improves it. The classic one re-derives its comparison for each
complete candidate, so it never had the bug. The killer one now recomputes from position zero and
agrees with its own brute force exactly, at 8.8ms against 13.8 seconds.

One trap, recorded so nobody repeats it: the classic canonical encoding orders **givens before
blanks**, because an empty cell encodes as 255. A brute force that compares the printable strings
instead puts `.` before `A` and reverses the ordering, and reports a mismatch on every record. The
first run did exactly that. The checker was wrong, not the frozen file.

### 2026-09-19 — generation and the gate now decide the reference cross-check the same way

`tools/record.mjs` ran the reference brute force on every instance, while `tools/gate.mjs` asks
`needsReferenceCheck(params, sampleValue(id, 'reference'))`. For `sudoku-classic` the two agree by
accident, because every supported shape is at or below its `always_at_or_below_size` of 9. For a
family with an expensive reference they would not: generation would burn a brute force the gate
never asks for, or ship a record whose cross-check the gate then demands and does not find.

`tools/record.mjs` now computes the canonical hash first and asks the same question with the same
id-derived sample. `tools/record.mjs` is not frozen. No `sudoku-classic` record changes.

---

## Batches

### batch/003 — 2026-09-19

**220 accepted, 0 gate rejections, 2,915 generator rejections**, all `band-mismatch`, from 3,135
attempts. Generation took 16s. Five bands, three grid shapes, two symmetries, one family. Corpus:
**760 records**, bands `{1:170, 2:170, 3:75, 4:170, 5:175}`.

| plan | accepted | attempts | rejected |
|---|---:|---:|---:|
| b3 · 9×9 (3×3) · mirror_v | 20/20 | 1,715 | 1,695 |
| b1 · 6×6 (3×2) · none | 50/50 | 50 | 0 |
| b2 · 8×8 (4×2) · none | 50/50 | 340 | 290 |
| b4 · 8×8 (4×2) · mirror_v | 50/50 | 521 | 471 |
| b5 · 8×8 (4×2) · none | 50/50 | 509 | 459 |

- **the gate was proved live this batch**, which is the thing worth reading from it. Three batches
  of 0 gate rejections is exactly the signal `CLAUDE.md` says to distrust, so the gate was attacked
  with deliberately broken copies of a real record and seven of its nine checks were watched to
  fire, `unique` among them. Method and the two traps found are under `## Decisions` above.
- **health signal.** All 220 ids, canonical hashes and seeds distinct, and all 760 hashes in the
  corpus are distinct, so nothing has been silently overwritten. All 220 verdicts `unique`, all 220
  reference-checked. `max_search_depth` is 0 in bands 1 to 4 and reaches 6 in band 5;
  `bounded_search` appears in band 5 and nowhere else. Score ranges by band: 24–28, 46–68, 63–103,
  78–392, 225–530. Clue ranges: 8–12, 17–22, 25–31, 18–26, 18–22.
- **band 3 at 9×9 took 1,715 attempts for 20 (1.2%).** An earlier draft of this entry called the
  series 3.0% → 2.0% → 1.5% → 1.2% a monotonic decline too large to be noise, and filed it as drift
  to chase. **That was wrong and it is corrected here**, because the four figures are four
  different symmetries, not four samples of one thing, and because the drift question has a direct
  test that had already been run. See `## Decisions` above.
- **variety was thinner than batch 002:** three shapes but only two symmetries (`none` 150,
  `mirror_v` 70), because the queue is consumed in FIFO order and plans 012–016 happened to cluster
  there. Not a defect, but `tools/make_plans.mjs` emits plans grouped by symmetry, so FIFO
  claiming will keep producing narrow batches. Interleaving the queue when refilling would fix it.
- **renderings were opened**, not just gate-passed: a 9×9 3×3, a 6×6 3×2 and an 8×8 4×2 at 360px.
  Box borders correct for all three shapes, no clue outside the board, stated clue counts matching
  the boards, and band 5 the only one showing a search depth. Screenshots in `.artifacts/`,
  uncommitted.

### batch/002 — 2026-09-19

**220 accepted, 0 gate rejections, 4,684 generator rejections**, all `band-mismatch`, from 4,904
attempts. Five bands, three grid shapes, three symmetries, one family. Corpus after the merge:
**540 records**, bands `{1:120, 2:120, 3:55, 4:120, 5:125}`.

| plan | accepted | attempts | rejected |
|---|---:|---:|---:|
| b1 · 6×6 (3×2) · mirror_v | 50/50 | 50 | 0 |
| b2 · 8×8 (4×2) · mirror_v | 50/50 | 1,095 | 1,045 |
| b3 · 9×9 (3×3) · mirror_h | 20/20 | 1,338 | 1,318 |
| b4 · 8×8 (4×2) · mirror_h | 50/50 | 876 | 826 |
| b5 · 8×8 (4×2) · mirror_v | 50/50 | 1,545 | 1,495 |

- **the batch that was meant to onboard a second family did not.** Both onboarding plans are in
  `queue/blocked/` now. The nonogram plan is blocked on the frozen schema's `params`; the
  killer-sudoku plan on the frozen hardening suite, which only understands sudoku digit grids. Both
  are written up under `## Decisions` above and in `PROPOSALS/`. Neither frozen file was changed.
- **killer-sudoku was built anyway** and is parked at `PROPOSALS/killer-sudoku/`. The solver is the
  expensive part of a family and it is done and checked; the blocker is one hook in the hardening
  suite. Building it is also what turned up the canonicaliser bug and the confirmation that the
  classic canonicaliser is sound, both recorded above.
- **health signal.** All 220 canonical hashes and seeds distinct. Technique sets escalate as the
  ladder predicts, `bounded_search` in band 5 and no other. Score ranges by band: 20–26, 44–74,
  63–108, 82–266, 221–526. The band-1 plan again accepted 50 from 50 attempts, which is expected
  and explained under `### batch/001`; a zero rejection rate on any other plan is a defect.
- **band 3 at 9×9 cost 1,318 rejections for 20 puzzles**, a 1.5% acceptance rate against 2.0% in
  batch 001 and the 3% measured in Phase 0. Still inside what the 400× attempt budget covers, but
  the trend is worth watching: two batches now below the calibrated rate.

### batch/001 — 2026-09-19

The first generated batch. **220 accepted, 0 gate rejections, 4,960 generator rejections**, all of
them `band-mismatch`, from 5,180 attempts. One family, five bands, four grid shapes, three
symmetries.

| plan | accepted | attempts | rejected |
|---|---:|---:|---:|
| b1 · 6×6 (3×2) · mirror_h | 50/50 | 50 | 0 |
| b2 · 8×8 (4×2) · mirror_h | 50/50 | 1,145 | 1,095 |
| b3 · 9×9 (3×3) · diagonal | 20/20 | 1,008 | 988 |
| b4 · 6×6 (3×2) · none | 50/50 | 1,201 | 1,151 |
| b5 · 8×8 (4×2) · mirror_h | 50/50 | 1,776 | 1,726 |

Every plan hit its target. Corpus after the merge: **320 records**, bands `{1:70, 2:70, 3:35,
4:70, 5:75}` across six shapes and five symmetries.

- **one family, not three.** The batch target asks for at least three families. The roster is one
  family deep because Phase 0 only onboards `sudoku-classic`, and the plan that would have started
  the second family is blocked on the frozen schema, above. Batch 002 onboards `killer-sudoku`.
- **health signal.** All 220 canonical hashes and all 220 seeds are distinct, so nothing is a
  duplicate under the family's full symmetry group. The technique sets escalate exactly as the
  frozen ladder predicts: band 1 used singles and nothing else, band 2 first reached tier 2, band 3
  first reached tier 3, band 4 first reached tier 4, and `bounded_search` appears in band 5 and in
  no other band. Score ranges by band: 20–26, 42–70, 65–115, 64–208, 218–408. Bands 3 and 4 overlap
  in score and that is correct — the band is the tier ceiling, not the score.
- **why the band-1 plan rejected nothing.** 50 accepted in 50 attempts looks like a collapsed gate
  and is not. The generator's fill-back stage stops when the target band is reached and refuses to
  stop early only when `band_target > 1`; for band 1 that guard is vacuous, so fill-back always
  converges. The 50 records were checked independently: every one carries only tier-1 techniques,
  so they are genuinely band 1. A zero rejection rate on a band-1 plan is expected. A zero
  rejection rate on any other plan is not, and a future session should treat one as a defect.
- **the band-3 attempt cost is as calibrated.** 988 rejections for 20 puzzles is 2.0% acceptance,
  against the 3% measured during Phase 0. The 400× attempt budget `tools/make_plans.mjs` sets for
  band-3 plans is right.

### phase0 — 2026-09-19

Foundation only. No puzzles generated until the gate was built, hardened and its report committed,
in that order.

- **built:** the independent solver (17 techniques over 4 tiers), the reference brute force, the
  exact symmetry canonicaliser, the nine-check gate, the seven-pass hardening suite, the frozen
  `bands.json` with a load-time assertion that the code's ladder still matches it, the schemas, the
  player, the browse page, the batch driver, the plan generator and the audit tool.
- **hardening:** `HARDENING/sudoku-classic.md`, green. 53 fixtures, 2,000 differential instances,
  428 independently confirmed `unique` verdicts (125 of them from minimal instances), 886 removals
  from 62 minimal instances all breaking uniqueness under both solvers, 10,000 fuzz inputs with no
  crash and a slowest case of 1ms, and every fixture's trace still matching its calibrated band.
- **learned:** three things a future session should not have to rediscover — the tier-ceiling dig
  does not target a band, band 3 is genuinely scarce, and a 4×4 sudoku has no band above 1. All
  three are written up under `## Decisions` above.
