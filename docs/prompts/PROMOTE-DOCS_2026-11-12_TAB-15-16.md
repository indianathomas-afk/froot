TIER 1 — PROMOTE-DOCS: TAB-15 + TAB-16 shipped in merge ab060e6 (docs only)

Repo: /Users/garythomas/Claude_Projects/Froot/froot
House rules: /Users/garythomas/Claude_Projects/Froot/froot/CLAUDE.md applies in full. Docs only — no code, no prisma, no database. Commit on staging only; never push.
Precedent: follow /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/PROMOTE-DOCS_2026-11-11_PWA-1.md and its commit 699a4bc for the exact shape of every edit below.

## Facts (re-verify each with git before writing)
- Promotion merge: ab060e6 "Promote TAB-15 + TAB-16: tablet how-tos and Ask a manager", pushed to main as 2a1f757..ab060e6.
- Staging fast-forwarded to main: 4f49185..ab060e6. All tips level at ab060e6.
- Rollback: git revert -m 1 ab060e6
- Promoted with it: TAB-15 (d7331ec, abfe736, ba72497, 149f620, b774132, 9f6cc43), TAB-16 (a9bbf04, b1c97c7, 4f49185), and the PWA-1 promote-docs commit 699a4bc.
- Staging evidence: Gary ran the TAB-15 and TAB-16 staging tests on 2026-11-12 and reported "All is working."
- Time: take it from git log -1 --format=%cI ab060e6 and label the time zone. The DB is UTC; Gary is Pacific.

## Production evidence
It comes from Gary in the launch message: the Vercel production build for ab060e6, the build-log line showing 20261113002310_tab16_help_requests applied, and what he saw on usefroot.com. If any of it is missing or reads like a placeholder rather than a real observation, STOP and ask. Never write a placeholder into a file.

## Edits
1. docs/DEPLOY_LOG.md: stamp the TAB-15 and TAB-16 entries (written UNPROMOTED at their pre-push checks) as PROMOTED in ab060e6, with the range, the rollback line and Gary's production evidence. Append-only: no earlier entry changes beyond the stamp.
2. docs/ROADMAP.yaml: flip the TAB-15 and TAB-16 rows to shipped (code is on main) and cite ab060e6. Keep everything already on each row. Add to TAB-16's open list: "Help request emails ship OFF on production (R7) until Gary turns them on; check every Keva manager login has an email address on production first (audit query, Neon console)." TAB-15's "Revisit when PIN is rolled out" stays deferred.
3. docs/MIGRATIONS.md: record 20261113002310_tab16_help_requests as applied to staging and production at the Vercel builds, citing Gary's build-log evidence. Don't claim a time you didn't see.
4. Commit this prompt file with the edits.

## Done when
- npm run build passes, then one docs commit on staging: docs(PROMOTE): TAB-15 + TAB-16 shipped in merge ab060e6; production evidence
- Only the touched files are staged (no git add -A). git status is clean afterwards.
- Report: the commit SHA, each file's diff size, and confirmation that no earlier DEPLOY_LOG entry changed beyond the two stamps.
- This commit rides the next promotion, as 699a4bc did.
