# STATE

## Standing corrections

*(Anything here must be read before the next puzzle is generated. Empty is the normal state.)*

Nothing outstanding.

---

## Decisions

Decisions that settle an ambiguous choice, so no future session re-litigates them.

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

---

## Batches

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
