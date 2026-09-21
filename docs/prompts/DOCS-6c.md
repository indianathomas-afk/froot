Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/DOCS-6c.md and execute it.

# DOCS-6c — DEPLOY_LOG corrections, DEBT-38 fix, HR-32 commits, ritual line

**TIER 1 — docs only.** Rider on DOCS-6b (343832b). No `src/`, no schema,
no prisma. One command at a time, no `&&`, stage only touched files, commit
on `staging`, never push.

**Save to:** `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/DOCS-6c.md`

Preserve-and-mark throughout. Nothing is deleted; corrections sit above the
text they correct with a dated rider line.

## The findings (DOCS-6b, 2026-09-19)

1. Promotions `df03cc3` (2026-09-06, STAFF-2) and `608955b` (2026-09-07,
   SELF-1, ten commits) have no `docs/DEPLOY_LOG.md` entry.
2. The HR-33 entry is headed `c870ba7 — 2026-09-06`; HR-33's three commits
   actually came in through `bf5a66f` on 2026-09-05. `c870ba7` is the
   SEARCH-1 promotion whose first parent is `bf5a66f`. A rollback read off
   that heading reverts the wrong work.
3. DEBT-38's entry says the prior main tip was `607926b`; it was `bd99d98`.
4. HR-32's `commits:` array is short by `61fdd68` and `5695a01` (named in
   prose on the row, not in the array).
5. Ruled 2026-09-19: the shipped-flip step goes INSIDE the promotion bash
   block in `docs/WORKFLOW.md` § 2, replacing the existing `git add` /
   `git commit` pair, verbatim as proposed in the DOCS-6b report.

## Steps

**1. Reconstruct the two missing entries.** For each of `df03cc3` and
`608955b`:

```
git show --no-patch --format='%H %ad %s' --date=iso <sha>
```
```
git log --oneline <sha>^1..<sha>^2
```

Write an entry in the file's existing shape, placed in date order among the
others, headed with the merge SHA and date. First line of the body:
`RECONSTRUCTED 2026-09-19 (DOCS-6c) from git; no contemporaneous entry was
written.` Then the commit list and the rows carried. Nothing else — do not
invent verification claims that were never made.

**2. Correct the HR-33 heading.** Do not edit the existing `## c870ba7 —
2026-09-06` heading or its body. Directly above it insert:

`── RIDER 2026-09-19 (DOCS-6c) ── The HR-33 work below (1222a81, aa25cb3,
5711187) reached main in bf5a66f on 2026-09-05, not c870ba7. c870ba7 is the
SEARCH-1 promotion (first parent bf5a66f). Rollback of HR-33 targets
bf5a66f. Heading preserved as written.`

If `bf5a66f` has its own entry, cross-reference it there with one line. If
it has none, it is a third missing entry — reconstruct it per step 1 and
report it.

**3. DEBT-38.** Rider above the "prior main tip" line: `── RIDER 2026-09-19
(DOCS-6c) ── prior main tip was bd99d98, not 607926b (DOCS-6b archaeology).
Original kept as written.` Also note in the same rider that
`branch.main.mergeoptions --no-ff` was set in the repo config on
2026-09-19, so fast-forwards of main are no longer possible from this
machine.

**4. HR-32.** Add `61fdd68` and `5695a01` to its `commits:` array. Prepend
a one-line rider to notes saying the array was completed 2026-09-19 from
the SHAs the row already named in prose.

**5. Ritual line.** In `docs/WORKFLOW.md` § "2. Promote to production
(staging → main)", replace the `git add` / `git commit` pair inside the
copyable block with the DOCS-6b proposal:

```
# ── flip every row this promotion carried to `status: shipped` +
#    `shipped: <date>` in docs/ROADMAP.yaml — the read-only log at the
#    top of this block IS the list of rows. Same commit as the entry. ──
git add docs/ROADMAP.yaml docs/DEPLOY_LOG.md
git commit -m "DEPLOY_LOG + ROADMAP: <date> production promotion (<what it carried>)"
```

Add one line beneath the block noting `branch.main.mergeoptions --no-ff` is
set, so `--no-ff` on the merge command is belt-and-braces, not the only
guard. Mark DEBT-104 `status: shipped` with a prepended rider naming this
commit's purpose (the SHA goes in after commit, or cite "this commit" — do
not guess it).

**6. Checks.**

```
grep -c '__' /Users/garythomas/Claude_Projects/Froot/froot/docs/DEPLOY_LOG.md
```
Must be `0`. Run the generator; report counts. `npm run build` gates the
commit.

**7. Commit:**
`docs(DOCS-6c): DEPLOY_LOG reconstructed df03cc3 + 608955b, HR-33 heading rider, DEBT-38 tip, HR-32 commits, shipped-flip in promotion block`

## Report

1. Entries reconstructed (2 or 3), with their commit counts.
2. Whether `bf5a66f` had an entry.
3. Generator counts.
4. Commit SHA. Unpushed commits on staging, listed.
5. Prisma commands run: "No prisma commands run."
