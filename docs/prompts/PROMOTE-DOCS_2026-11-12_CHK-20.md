TIER 1 — PROMOTE-DOCS: CHK-20 shipped in merge b47fadf (docs only)

Repo: /Users/garythomas/Claude_Projects/Froot/froot
House rules: /Users/garythomas/Claude_Projects/Froot/froot/CLAUDE.md applies in full. Docs only — no code, no prisma, no database. Commit on staging only; never push.
Precedent: follow /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/PROMOTE-DOCS_2026-11-12_TAB-15-16.md and its commit 2be020e for the shape of every edit.

## Facts (re-verify each with git before writing)
- Promotion merge: b47fadf "Promote CHK-20: training video links are http(s) only", pushed to main as ab060e6..b47fadf.
- Staging fast-forwarded to main: 5b1a96d..b47fadf. All tips level at b47fadf.
- Rollback: git revert -m 1 b47fadf
- Promoted with it: CHK-20 (27f8d2e, 6f32acc, 5b1a96d) and the TAB-15/16 promote-docs commit 2be020e.
- Staging evidence: Gary ran the four CHK-20 staging tests on 2026-11-12 and confirmed all four.
- No migration in this promotion.
- Time: take it from git log -1 --format=%cI b47fadf and label the time zone.

## Production evidence
Gary's production observations for CHK-20 come in the launch message. If they're missing or read like a placeholder, STOP and ask. Never write a placeholder into a file.

Also record this TAB-16 production evidence, which Gary ran in the Neon console on 2026-11-12 (Pacific) after the docs pass 2be020e noted nobody had read the production migration table. Result, verbatim: branch_id br-sparkling-block-a620qvg4, ledger_rows 1, finished_at 2026-11-13 01:09:02.22259+00, new_message_columns 3, new_settings_column 1.

## Edits
1. docs/DEPLOY_LOG.md: stamp the CHK-20 entry (written UNPROMOTED at its pre-push check) as PROMOTED in b47fadf, with the range, the rollback line and Gary's production evidence. Append-only: no other entry changes beyond that stamp.
2. docs/ROADMAP.yaml: flip the CHK-20 row to shipped and cite b47fadf. Keep everything already on the row, including the HR lesson-video COMMENT under deferred.
3. docs/MIGRATIONS.md: in the TAB-16 entry, replace "nobody read the migration table on that database" with the Neon result above, quoted with its branch_id. Change nothing else.
4. Commit this prompt file with the edits.

## Done when
- npm run build passes, then one docs commit on staging: docs(PROMOTE): CHK-20 shipped in merge b47fadf; TAB-16 production ledger evidence
- Only the touched files are staged (no git add -A). git status is clean afterwards, apart from the known stray docs/Claude outputs/ folder, which you leave alone.
- Report: the commit SHA, each file's diff size, and confirmation that no other DEPLOY_LOG entry changed.
- This commit rides the next promotion.
