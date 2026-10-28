Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/PROMOTE-DOCS_2026-10-27_NOTIFY-14.md and follow it.

# PROMOTE-DOCS — NOTIFY-14 promotion docs pass (2026-10-27)

**TIER 1** — docs only. Commits on `staging` (never on `main`). No code, no schema, no Prisma commands except the `prisma generate` inside `npm run build`. Declare the tier first.

## Repo gate

1. Confirm you are in `/Users/garythomas/Claude_Projects/Froot/froot` (lowercase), on `staging`, and that `staging`, `main`, `origin/staging` and `origin/main` all point at the same commit. If not, STOP and report.
2. Find the NOTIFY-14 promotion merge: `git log --merges -1 --format='%H %P %ad %s' --date=iso main`. Its second parent must be `c624f01`. If not, STOP and report.
3. Allowed untracked file: this prompt only. Anything else: STOP and report.

## Evidence to record (from Gary, in chat — do not ask again)

- **Staging:** `_prisma_migrations` on `br-square-feather-a63z92vz` shows `20261027230046_notify14_doc_digest` finished `2026-10-28 00:07:14 UTC`. Browser as `indianathomas` (org not recorded): the "Document due dates" card on `/settings/notifications` renders with the switch Off and "Disabled", the recipients line (admins every store, managers their assigned stores, Users page link), "Also send to" with the Corporate store-login warning (F8), and Schedule "Default: every Monday at 8 AM Pacific time." Gary reported "All worked" for: preview to himself, preview as a manager, the "Test" row in Recent emails, and Tommy as MANAGER unable to turn it on.
- **Production:** `_prisma_migrations` on `br-sparkling-block-a620qvg4` shows the same migration finished `2026-10-28 03:29:44 UTC`. Switch left Off for every org.
- **Not observed:** a real scheduled send (switch never turned on anywhere); unticking a person in Edit User (fixture-only); any production browser check.

## Edits

1. `/Users/garythomas/Claude_Projects/Froot/froot/docs/DEPLOY_LOG.md`: stamp the `UNPROMOTED — … NOTIFY-14…` heading with the merge short SHA, same format as the DOC-8 entry. Add a paragraph: promoted in merge `<sha>` (full SHA, both parents, 3 commits, file count), the production migration row above, and the rollback note — `git revert -m 1 <sha>` reverts the code but leaves `Organization.docDigestEnabled` in place (harmless, default false). Heading count must stay 94 — report before and after.
2. `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml`: NOTIFY-14 row to `shipped: 2026-10-27`, add `c624f01` and the merge SHA to `commits`. Prepend a dated rider with the evidence above, observed and not observed listed separately.
3. `/Users/garythomas/Claude_Projects/Froot/froot/docs/MIGRATIONS.md`: mark `20261027230046_notify14_doc_digest` applied to staging and production with the two timestamps above.
4. File one new row (next free DEBT id, read the file): the hub card blurb says "One email a week to admins and managers…" but F3 allows a daily schedule, so the blurb is wrong when the schedule is daily — it should follow the saved schedule, as the footer does (F16). Cosmetic, TIER 1.
5. Touch nothing else. `grep -c '__'` on the lines you added must be zero.

## Commit (commit only, never push)

Run `npm run build` first. Stage only the three docs files plus this prompt: `docs(NOTIFY-14): promotion stamp <sha>, row to shipped, migration applied to production`.

Report the SHA, the build result, the heading counts, the new DEBT id, and stop.
