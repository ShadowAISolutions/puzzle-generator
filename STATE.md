# STATE

## Standing corrections

*(Anything here must be read before the next puzzle is generated. Empty is the normal state.)*

Nothing outstanding.

---

## Decisions

Decisions that settle an ambiguous choice, so no future session re-litigates them.

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

---

## Batches

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
