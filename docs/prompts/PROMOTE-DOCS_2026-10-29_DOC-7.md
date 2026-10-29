Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/PROMOTE-DOCS_2026-10-29_DOC-7.md and follow it.

# PROMOTE-DOCS — DOC-7 promotion docs pass (2026-10-29)

**TIER 1** — docs only. Commits on `staging` (never on `main`). No code, no schema, no Prisma commands except the `prisma generate` inside `npm run build`. Declare the tier first.

## Repo gate

1. Confirm you are in `/Users/garythomas/Claude_Projects/Froot/froot` (lowercase), on `staging`, and that `staging`, `main`, `origin/staging` and `origin/main` all point at `849550d`. If not, STOP and report.
2. Confirm `849550d` is a merge whose second parent is `a27133a`. If not, STOP and report.
3. Allowed untracked file: this prompt only. Anything else: STOP and report.

## Evidence to record (from Gary, in chat — do not ask again)

- **Staging:** `_prisma_migrations` on `br-square-feather-a63z92vz` shows `20261028202919_doc7_annual_resign` finished `2026-10-28 23:38:28 UTC`. Browser as `indianathomas` (org not recorded): the Edit Document dialog on a signature document ("Test - Handbook Regression") shows "Re-sign every" (default Never) under "Sign within", with the 30-day help text; a Reference document ("I-9 Employee Verification", link type) shows neither "Sign within" nor "Re-sign every". Gary reported "All is working" for the rest of the UI checks.
- **Production:** `_prisma_migrations` on `br-sparkling-block-a620qvg4` shows the same migration finished `2026-10-29 21:54:28 UTC`. Every document defaults to Never.
- **Not observed (fixture-only so far):** the "Re-sign due in d days" notice, "Re-sign now" early re-sign, overdue after an anniversary, the digest leaving upcoming re-signs out. No staging signature is old enough yet (oldest 2026-07-24); natural proof is due around late December 2026 if a staging document is set to 6 months. No production browser check.

## Edits

1. `/Users/garythomas/Claude_Projects/Froot/froot/docs/DEPLOY_LOG.md`: stamp the `UNPROMOTED — … DOC-7…` heading with `849550d`, same format as the DOC-13 entry. Add a paragraph: full SHA, merge time, both parents, 3 commits, 35 files, the production migration row above, and the rollback note already worked out in the PRE-PUSH-CHECK entry (reverting the work commit is code-only; the widened indexes and new columns stay). Heading count must stay 96 — report before and after.
2. `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml`: DOC-7 row to `shipped: 2026-10-29`, add `a27133a` and `849550d` to `commits`. Prepend a dated rider with the evidence above, observed and not observed listed separately.
3. `/Users/garythomas/Claude_Projects/Froot/froot/docs/MIGRATIONS.md`: mark `20261028202919_doc7_annual_resign` applied to staging and production with the two timestamps above.
4. Touch nothing else. `grep -c '__'` on the lines you added must be zero.

## Commit (commit only, never push)

Run `npm run build` first. Stage only the three docs files plus this prompt: `docs(DOC-7): promotion stamp 849550d, row to shipped, migration applied to production`.

Report the SHA, the build result, the heading counts, and stop. Gary runs no git commands until you report.
