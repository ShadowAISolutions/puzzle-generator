# 001-onboard-nonogram — blocked

**Blocked:** 2026-09-19, batch 001.

**Obstacle:** `schema/puzzle.schema.json` requires every record's `params` to carry `size`, `box_h`
and `box_w`, with the two box dimensions between 2 and 4. Those describe how a sudoku's boxes tile
its grid. **A nonogram has no boxes**, and there is no honest value to put in those fields;
inventing one would break rule 1 of the UNIT CONTRACT, that a record is data and never prose.

`schema/` is frozen by `FOUNDATION.md`, so the schema was not changed. The argument for changing it
is written up in full at **`PROPOSALS/2026-09-19-family-agnostic-params.md`**, including why the
change would invalidate no shipped puzzle and weaken no check.

**What unblocks this:** an explicit instruction from the repository owner to apply the change in
that proposal. Then this plan can move straight back to `queue/` and be claimed.

**What was done instead:** the roster is being worked in an order the frozen schema allows.
`killer-sudoku` is onboarded next — cage arithmetic is genuinely new solving logic, and a killer
sudoku has boxes, so its `params` are honest as the schema stands. The same obstacle blocks sixteen
of the twenty rostered families, so this is a detour and not a solution.
