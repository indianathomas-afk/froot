Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/PROMOTE-DOCS_2026-11-10_TAB.md and run it.

# PROMOTE-DOCS 2026-11-10: Tablet mode series (TAB-1 → TAB-9)

**TIER 1, docs only.** Declare the tier before writing anything. Touch only these four files:

- `docs/ROADMAP.yaml`
- `docs/DEPLOY_LOG.md`
- `docs/MIGRATIONS.md`
- `docs/DECISIONS.md` (only if a convention requires it)

No code, no schema, no Prisma commands other than the `prisma generate` that `npm run build` runs.

## 0. Repo gate

1. Confirm the working directory is the git root `/Users/garythomas/Claude_Projects/Froot/froot` (lowercase `froot`).
2. Confirm the branch is `main`, the tree is clean, and `origin/main` is at the merge commit `8417fc3` ("Merge branch 'staging'"). Gary pushed it before this session.
3. Paste `git log --oneline -3`.
4. Confirm that `8417fc3`'s second parent is `1a0424d`, using `git log --oneline -1 8417fc3^2`.

If any check fails, STOP and report. `docs/prompts/PROMOTE-DOCS_2026-11-10_TAB.md` is expected to be untracked. Commit it with this pass as the prompt of record.

## 1. Context

On 2026-11-10 Gary promoted the whole Tablet mode series to production in one merge: `8417fc3`, 30 commits, 51 files. It carries:

- TAB-1, TAB-1b, TAB-1c
- TAB-2, TAB-2b
- TAB-3, which includes the migration `20261110200000_tab3_display_layouts`
- TAB-5
- TAB-9

Every phase was staging-verified by Gary ("Everything is tested and working great").

**Rollback for the whole series:** `git revert -m 1 8417fc3`. The TAB-3 migration only adds two nullable JSONB columns, so leaving it in place after a code revert is harmless.

## 2. Edits

### `docs/ROADMAP.yaml`

1. Flip each promoted phase row to shipped, using the file's own conventions for status, promoted date and merge SHA. The rows are TAB-1, TAB-1b, TAB-1c, TAB-2, TAB-2b, TAB-3, TAB-5 and TAB-9. Use date 2026-11-10 and merge `8417fc3`.
2. Preserve and mark. Delete nothing.
3. Don't touch the planned rows TAB-4, TAB-6, TAB-7, TAB-8 or TAB-10, or CHK-18, CHK-19 or BUG-28. They stay planned.
4. On the TAB-5 row, add a dated rider: staging test 6 (overnight store-local rollover) was not observed before promotion. Gary chose to ship and watch for it. It is covered by the `verify-tab5-refresh` fixture and a mocked day-change check. It is owed as a production observation the first morning a tablet is left on overnight.

### `docs/DEPLOY_LOG.md`

1. For each TAB entry currently marked UNPROMOTED, stamp it as promoted in `8417fc3` on 2026-11-10, following the stamp format of the most recent promoted entry.
2. Add a production entry for the merge if the file's convention calls for one.
3. Count `##` headings before and after. They must change only as the convention dictates. Report both counts, and confirm that no lines were removed beyond the stamped status lines.

### `docs/MIGRATIONS.md`

1. Record `20261110200000_tab3_display_layouts` as applied to production via `vercel-build` at promotion `8417fc3`.
2. Gary confirms the production build log showed the migration applied. If he hasn't told you, write "pending Gary's confirmation from the production build log" rather than asserting it.

## 3. Gate and commit

1. Run `npm run build`. ROADMAP.yaml is typechecked at prebuild.
2. Make one docs commit on main, for example: `docs(PROMOTE): TAB-1→TAB-9 shipped in merge 8417fc3`. Include this prompt file.
3. Commit, never push.

## 4. Report

- the tier
- the commit SHA
- which rows were flipped
- the DEPLOY_LOG heading counts before and after
- the MIGRATIONS line as written
- anything that didn't match the conventions

End with Gary's next commands, one at a time:

1. `git push origin main`
2. `git checkout staging`
3. `git merge main`
4. `git push origin staging`
