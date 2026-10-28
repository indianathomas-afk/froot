Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/PROMOTE-DOCS_2026-10-28_DOC-13.md and follow it.

# PROMOTE-DOCS — DOC-13 promotion docs pass (2026-10-28)

**TIER 1** — docs only. Commits on `staging` (never on `main`). No code, no schema, no Prisma commands except the `prisma generate` inside `npm run build`. Declare the tier first.

## Repo gate

1. Confirm you are in `/Users/garythomas/Claude_Projects/Froot/froot` (lowercase), on `staging`, and that `staging`, `main`, `origin/staging` and `origin/main` all point at `ff1fd43`. If not, STOP and report.
2. Confirm `ff1fd43` is a merge whose second parent is `6d63827`. If not, STOP and report.
3. Allowed untracked file: this prompt only. Anything else: STOP and report.

## Evidence to record (from Gary, in chat — do not ask again)

- **Staging** (build `6d63827-staging` shown in the footer; org not recorded): Tommy Thomas's `/my` lists "How to NOT piss off a customer · Due Jul 26" above "Test - Handbook Regression · 0/7 checkpoints · Was due Oct 27", both with the red Overdue badge — mixed, most-overdue-first as ratified. Gary reported all other test-plan items verified: `/my/documents` (handbook first, red Overdue, "Was due Oct 27"), the `/staff/[id]` Documents tab as `indianathomas`, a no-due-date document unchanged, phone width.
- **Production:** promoted in `ff1fd43`; no migration. Not observed: any production browser check (no production document has a due date yet).

## Edits

1. `/Users/garythomas/Claude_Projects/Froot/froot/docs/DEPLOY_LOG.md`: stamp the `UNPROMOTED — 2026-10-28 — DOC-13…` heading with `ff1fd43`, same format as the NOTIFY-14 entry. Add a paragraph: full SHA, both parents, 4 commits, 10 files, no migration, rollback `git revert -m 1 ff1fd43`. Heading count must stay 95 — report before and after.
2. `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml`: DOC-13 row to `shipped: 2026-10-28`, add `6d63827` and `ff1fd43` to `commits`. Prepend a dated rider with the evidence above, observed and not observed listed separately.
3. Touch nothing else. `grep -c '__'` on the lines you added must be zero.

## Commit (commit only, never push)

Run `npm run build` first. Stage only the two docs files plus this prompt: `docs(DOC-13): promotion stamp ff1fd43, row to shipped`.

Report the SHA, the build result, the heading counts, and stop. Gary runs no git commands until you report.
