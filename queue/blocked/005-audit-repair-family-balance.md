# 005-audit-repair-family-balance

Repair task filed by `AUDIT/005.md`, which scored family balance **1 of 5**.

The corpus is 100% `sudoku-classic` at 1,188 records. `CLAUDE.md` requires every batch to touch at
least three families and no family to exceed 30% of the corpus once four families exist. Neither
can be satisfied, because no second family can be onboarded.

**This task is blocked, not queued.** It is in `queue/blocked/` because no session can act on it:
the two routes to a second family each require changing a frozen file, and the anti-drift rule is
"Write proposals, do not act on them." The obstacle is in `005-audit-repair-family-balance.notes.md`.
