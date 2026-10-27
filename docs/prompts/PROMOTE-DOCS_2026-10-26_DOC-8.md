Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/PROMOTE-DOCS_2026-10-26_DOC-8.md and follow it.

# PROMOTE-DOCS — DOC-8 promotion docs pass (2026-10-26)

**TIER 1** — docs only. Commits on `staging` (never on `main`). No code, no schema, no Prisma commands except the `prisma generate` inside `npm run build`. Declare the tier first.

## Repo gate

1. Confirm you are in `/Users/garythomas/Claude_Projects/Froot/froot` (lowercase), on `staging`, and that `staging`, `main`, `origin/staging` and `origin/main` all point at the same commit. If not, STOP and report.
2. Find the DOC-8 promotion merge: `git log --merges -1 --format='%H %P %ad %s' --date=iso main`. Its second parent must be `ed8829b`. If not, STOP and report.
3. Allowed untracked file: this prompt only. Anything else: STOP and report.

## Evidence to record (from Gary, in chat — do not ask again)

- **Staging:** `_prisma_migrations` on `br-square-feather-a63z92vz` shows `20261026200000_doc8_document_due_dates` finished `2026-10-26 22:54:33 UTC`. Browser (org not recorded): Edit Document dialog on "Test - Handbook Regression" shows the "Sign within (days)" field and its help text; with N = 1, Tommy Thomas's `/my` shows "Due tomorrow" with status "New version to sign" (not overdue yet), and his training row's wording is unchanged; By Document totals match per-staff; a Reference document shows no "Sign within" field.
- **Production:** `_prisma_migrations` on `br-sparkling-block-a620qvg4` shows the same migration finished `2026-10-26 23:36:59 UTC`.
- **Not observed:** "Due in 7 days" rendering on `/hr/compliance` and the Compliance tab; category default inheritance; the overdue "Was due…" state (test document left at N = 1 to check on 2026-10-28); any production browser check.

## Edits

1. `/Users/garythomas/Claude_Projects/Froot/froot/docs/DEPLOY_LOG.md`: stamp the `UNPROMOTED — 2026-10-26 — DOC-8…` heading with the merge short SHA, in the same heading format as the STAFF-3 entry. Add a paragraph: promoted 2026-10-26 in merge `<sha>` (full SHA, both parents, 3 commits), the production migration row above, and the rollback note — `git revert -m 1 <sha>` reverts the code but leaves the three nullable columns in place (harmless; nothing reads them after a revert). Heading count must stay 93 — report before and after.
2. `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml`: DOC-8 row to `shipped: 2026-10-26`, add `ed8829b` and the merge SHA to `commits`. Prepend a dated rider with the evidence above, observed and not observed listed separately.
3. `/Users/garythomas/Claude_Projects/Froot/froot/docs/MIGRATIONS.md`: mark `20261026200000_doc8_document_due_dates` applied to staging and production with the two timestamps above.
4. Touch nothing else. `grep -c '__'` on the lines you added must be zero.

## Commit (commit only, never push)

Run `npm run build` first. Stage only the three docs files plus this prompt: `docs(DOC-8): promotion stamp <sha>, row to shipped, migration applied to production`.

Report the SHA, the build result, the heading counts, and stop.
