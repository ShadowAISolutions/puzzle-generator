# Nonogram fixtures — where each one comes from

Rebuild with `node tools/make_fixtures.mjs nonogram`. The build is deterministic: the same
command writes byte-identical files.

**No verdict in this directory comes from the solver under test.** Every one is decided by
`solver/reference/nonogram.mjs`, a brute force that shares no code with the solver — it enumerates
each row's arrangements directly and prunes on the column clues, and it imports nothing from
`solver/nonogram/`. Where the reference cannot finish inside its budget, the fixture records
`verdict: null` and earns its place as the case that proves the gate rejects what it could not
cross-check, rather than waving it through.

Expected **bands** are a different matter and are not verdicts. A band is a property of this
solver's own technique ladder, so it is recorded here at calibration time and frozen. That is the
point: a later change to the ladder shows up as a fixture failure instead of silently
reclassifying the corpus.

## What the categories are

| Prefix | What it is | Source |
|---|---|---|
| `degenerate-empty-*` | Every line has no runs. The empty grid is the only grid with no filled cells, so this is **unique**, not ambiguous — the opposite of what an empty sudoku means. | constructed |
| `degenerate-full-*` | Every row one run the width of the grid, every column one its height. Only the filled grid matches. | constructed |
| `contradiction-sum-mismatch-*` | The two clue lists disagree on how many cells are filled. | constructed |
| `contradiction-run-too-long-*` | A run longer than the line it sits in. | constructed |
| `contradiction-no-room-*` | Runs that each fit but cannot fit together once the mandatory gaps are counted. | constructed |
| `contradiction-jointly-impossible-*` | Every line satisfiable alone, the totals agree, and still no grid exists. The row needs its two cells separated and the columns leave nowhere to put the gap. | constructed |
| `pattern-border-*`, `pattern-diagonal-*`, `pattern-cross-*` | Recognisable grids rather than random ones, so an encoding or rendering bug is visible to a person reading the fixture. | constructed |
| `pattern-checkerboard-*` | Alternating cells: the longest clue string a shape can produce, and therefore the encoding's worst case against the schema's 256-character ceiling. | constructed |
| `multiple-switch-*` | The canonical nonogram ambiguity. Two rows and two columns each holding one filled cell; the two cells sit on either diagonal of the square they span, so there are exactly two solutions. This is the reason uniqueness is checked rather than assumed. | constructed |
| `unique-*` | Machine-generated instances, one per shape and band the generator can actually reach. | generated |
| `nearmiss-*` | A `unique-*` instance with one run shortened, lengthened or dropped. | generated |

## On "near miss", and why this family has none in the usual sense

For sudoku and binairo a near miss is an instance one step from unique: remove a given and see
whether the solution is still forced. A nonogram has no givens to remove. Its clues are a function
of its solution, and a line's clue names its run lengths exactly — so the sets of lines satisfying
two different clues are **disjoint**. No clue is weaker than another, and no mutation enlarges the
solution set; it replaces it.

The `nearmiss-*` fixtures are therefore not near misses. They are cases where the solver and the
reference have to agree about what a small change did, whatever it turns out to be. That is also
why `weakenings` in `solver/nonogram/index.mjs` returns the empty list for a minimality claim:
there are none to return, and selecting instances whose mutants happen to break uniqueness would
turn the hardening suite green while testing nothing.

## No published puzzles

The sudoku fixture set includes puzzles that circulate widely, as research material. There is no
equivalent here yet. Published nonograms are almost always pictures distributed as images rather
than as clue lists, and transcribing one by hand would put a hand-entered record in a repository
whose whole discipline is that nothing is hand-entered. The constructed patterns above cover what
a published fixture would have covered: known grids, known verdicts, visible to a reader.
