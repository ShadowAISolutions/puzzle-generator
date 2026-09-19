# CLAUDE.md — operating rules for this repository

Read this, then `STATE.md`, then the three most recent files in `AUDIT/`, before generating
anything.

This is a long-running, multi-month, unattended build. Optimise for consistency and additive
progress over cleverness. **A corpus of a hundred thousand puzzles you can trust beats a clever
generator you cannot.**

Work autonomously. Do not ask for confirmation, approval or direction. If you face an ambiguous
choice, pick the option that adds validated puzzles and record the decision in `STATE.md` under
`## Decisions`.

The repository is **ShadowAISolutions/puzzle-generator**. It is public, and GitHub Pages serves
`main` at the repository root.

---

## ANTI-DRIFT RULES

*(verbatim, permanent)*

- Never modify frozen files.
- Never weaken the solver, the uniqueness check, the gate, or the band thresholds to make a
  puzzle pass.
- The solver never imports from the generator.
- Never hand-edit a puzzle record. Fix the generator and regenerate.
- The generator's intent is not evidence. Only the solver's verdict counts.
- A rejected puzzle is a normal outcome. A wrong puzzle in the corpus is not.
- A timeout is a rejection, never a pass.
- A new family ships its solver, fixtures, hardening report, player and calibration before its
  first puzzle.
- Never merge red CI. Never push to `main`.
- Never widen scope mid-session.
- Write proposals, do not act on them.

---

## SESSION LOOP

Repeat indefinitely:

1. `git pull --rebase`.
2. **If a file named `PAUSE` exists at the repo root: stop immediately.** Write current state to
   `STATE.md`, commit, push, report, and do nothing else.
3. Read `STATE.md` and the three most recent files in `AUDIT/`. Apply their lessons.
4. Claim a batch: move 5 plan files from `queue/` to `queue/in-progress/`, on a new branch
   `batch/<NNN>`. Commit the claim.
5. For each claimed plan:
   - Generate the requested puzzles: `node tools/generate.mjs --plans queue/in-progress --batch <NNN>`.
   - Run every one through `tools/gate.mjs`. Keep what passes; discard what does not and record
     the reason and count.
   - If a plan cannot produce its target after three serious attempts, move it to `queue/blocked/`
     with a `.notes.md` file explaining the obstacle, and move on. Do not sink a session into one
     plan.
   - Commit accepted puzzles per plan: `add(<family>/<band>): <n> puzzles`.
6. Run `node tools/build_index.mjs`. Run the gate over everything the branch changed. Commit.
7. Push the branch, open a pull request, wait for CI, and merge **only if CI is green**. If CI
   fails, fix forward on the same branch. Never merge red. Never push to `main`.
8. Update `STATE.md`: puzzles accepted by family and band, rejection counts and reasons, families
   touched, anything learned a future session should know.
9. **Every 5th batch, run an AUDIT pass** (`node tools/audit.mjs <NNN>`), then read its output and
   write the judgement into `AUDIT/<NNN>.md`.
10. If `queue/` holds fewer than 20 plans, generate 40 more (`node tools/make_plans.mjs 40`).
11. Return to step 1.

**Do not stop between batches.** Finish a batch, report it, start the next one in the same session.
The daily routine is a safety net that restarts a dead loop; it is not the pacing mechanism. A
session that finishes a batch and goes idle has wasted the run.

**Batch target:** 200–400 accepted puzzles per batch, spanning at least three families and all five
bands, with no single family over 40% of the batch. Quantity is cheap here; balance and trust are
not.

**Incident stop:** if three consecutive batches fail to merge, write `INCIDENT.md` describing the
failure pattern, push it, and stop.

---

## COMMANDS

| What | Command |
|---|---|
| Validate schemas | `node tools/validate_schema.mjs` |
| Import isolation | `node tools/check_imports.mjs` |
| Harden a family | `node tools/harden.mjs <family> --write-report` |
| Build fixtures | `node tools/make_fixtures.mjs <family>` |
| Generate a batch | `node tools/generate.mjs --plans queue/in-progress --batch <NNN>` |
| The gate | `node tools/gate.mjs <path-or-family-or---all> [--render]` |
| Rebuild the site | `node tools/build_index.mjs` |
| Refill the queue | `node tools/make_plans.mjs <n>` |
| Audit | `node tools/audit.mjs <NNN>` |

CI green is the only merge gate. CI runs schema validation, the import-isolation check, the full
hardening suite for every family, and the gate with `--render` over every puzzle the pull request
changed.

---

## FAMILIES AND VARIETY

The risk is not visual sameness, it is a corpus that is 90% sudoku with a thin decoration of
everything else. Guard against it actively.

Target roster, in rough order of onboarding:

`sudoku-classic`, `nonogram`, `slitherlink`, `kakuro`, `star-battle`, `hitori`, `masyu`, `akari`,
`nurikabe`, `skyscrapers`, `futoshiki`, `binairo`, `shikaku`, `heyawake`, `yajilin`, `tents`,
`killer-sudoku`, `thermo-sudoku`, `sandwich-sudoku`, `norinori`.

Rules:

- No family exceeds **40% of any batch**, or **30% of the corpus** once four families exist.
- Every batch touches **at least three families** and **all five bands**.
- Onboard a new family roughly every fifth batch until the roster is covered.
- Within a family, vary grid size, clue count and symmetry. A family that only ever produces 9×9
  symmetric grids is one puzzle repeated ten thousand times.

### FAMILY ONBOARDING CONTRACT

A new family generates **nothing** until all of this exists and is committed:

1. `solver/<family>/` — the independent solver with a technique ladder.
2. Reference support for the family in `solver/reference/`.
3. `fixtures/<family>/` — at least 40 fixtures with known verdicts, sources recorded.
4. A green `tools/harden.mjs <family>` run, with `HARDENING/<family>.md` committed.
5. `solver/<family>/bands.json` — calibrated and frozen.
6. `site/play/<family>.html` — a working player passing its own selftests.
7. `corpus/<family>/family.json` — the manifest (generated by `build_index.mjs`).

This is the same discipline as Phase 0, applied every time the corpus grows sideways. It is the
rule most likely to feel like overhead on batch 30. Follow it anyway; it is the reason the
guarantee holds across families.

---

## QUEUE AND PLAN GENERATION

A plan is `queue/<NNN>-<family>-<band>-<n>.md` and states: family, band, count, grid size and
parameter ranges, any structural constraint, and what would make the batch a failure. The machine
readable part is a fenced ` ```json ` block; the prose around it is for a human reading the queue.

A family onboarding task is `queue/<NNN>-onboard-<family>.md`.

When refilling: spread across families and bands, favour the bands and families the corpus is thin
on, and always include at least one onboarding task if the roster is incomplete. Check for
duplicate plans before writing.

---

## AUDIT

Every 5th batch:

1. Sample 10 accepted puzzles at random, weighted toward older ones and across families.
2. For each: re-solve with the **current** reference, recompute the band, re-check the canonical
   hash against the corpus, and look at its screenshot in `.artifacts/`.
3. Solve two of them by hand-trace far enough to confirm the band is honest — not just internally
   consistent.
4. Re-run the band classifier over a random 200 records. **If the distribution has shifted since
   the last audit, something that should be frozen has changed. Find it.**
5. Check family balance, band balance, and rejection rates against the last three batches.
6. Score 1–5 on: uniqueness rigour, band accuracy, puzzle quality (clue count, symmetry, whether it
   is pleasant to solve), family balance, player rendering.
7. Write `AUDIT/<NNN>.md` with scores, the running average and observed drift. File repair tasks
   into `queue/` for anything scoring 2 or below.
8. If the running average has fallen for three consecutive audits, write the diagnosis at the very
   top of `STATE.md` so the next session corrects for it.

---

## STATE FORMAT

`STATE.md` is append-forward, newest batch at the top under `## Batches`:

```
### batch/007 — 2026-10-02
- accepted: sudoku-classic 120 (b1 20, b2 30, b3 30, b4 25, b5 15), nonogram 90, slitherlink 60
- rejected: 412 (not-unique 301, band-mismatch 74, duplicate-hash 31, timeout 6)
- families: sudoku-classic, nonogram, slitherlink
- blocked: 014-heyawake-b4 (reason in queue/blocked/014-heyawake-b4.notes.md)
- learned: <one or two lines a future session would want to know>
```

Anything that must be read before the next puzzle is generated goes at the very top of the file,
above `## Batches`, under `## Standing corrections`. Decisions that settle an ambiguous choice go
under `## Decisions` with a date and the reasoning, so no future session re-litigates them.

---

## OPERATING RULES LEARNED THE HARD WAY

1. **Do not stop between batches.** A session that finishes a batch and goes idle has wasted the
   run.
2. **The spec is not evidence.** A plan file asking for a band-4 puzzle does not make the puzzle
   band 4. The record says whatever the solver's trace says. If that means the plan produced 40
   band-3 puzzles, the plan was wrong, not the solver.
3. **Look at the rendering.** Gates prove logic; they cannot see a clue printed off the edge of the
   board or a grid that is unreadable at 360px. Open the screenshots.
4. **Keep raw material out of your own messages.** Never paste base64, screenshots, long file dumps
   or whole puzzle records into a message. Report a path and a summary.
5. **If a turn dies mid-batch, resume from the checklist — do not restart the batch.** Re-read
   `git status`, find where the checklist stopped, and carry on. Only escalate if the same step
   dies twice running.
6. **Report once per batch, and only then.** One message: merged pull request, accepted counts by
   family and band, rejection counts by reason, anything learned.
7. **Never claim CI is green without reading the check result.** Read it, then merge.
8. **Bound everything.** Per-instance solver timeouts, per-batch wall-clock budgets, and a cap on
   how long a single generator may search before that plan is declared blocked.
9. **Watch the corpus size.** Shard as specified, keep records small, and never commit
   `.artifacts/` screenshots to the repository.
10. **If an approval prompt appears, you are stalled.** Say so clearly in your next message so the
    owner can clear it; do not sit silently waiting.
