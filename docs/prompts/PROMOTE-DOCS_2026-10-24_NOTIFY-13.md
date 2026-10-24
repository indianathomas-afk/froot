Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/PROMOTE-DOCS_2026-10-24_NOTIFY-13.md and follow it.

# PROMOTE-DOCS — NOTIFY-13 late promotion stamp (2026-10-24)

**TIER 1** — docs only. Commits on `staging` (never on `main`). No code, no schema, no Prisma commands except the `prisma generate` inside `npm run build`. Declare the tier first.

## Why

The STAFF-3 promotion docs pass (`e31484f`) found the NOTIFY-13 entry in `docs/DEPLOY_LOG.md` still headed `UNPROMOTED`, although its commits are already on `main`.

## Repo gate

1. Confirm you are in `/Users/garythomas/Claude_Projects/Froot/froot` (lowercase), on `staging`, and that `staging`, `main`, `origin/staging` and `origin/main` all point at `8a55977`. If not, STOP and report.
2. Allowed untracked files: this prompt and `docs/prompts/NOTIFY-13b-contacts-first.md` (not this phase — leave it alone). Anything else: STOP and report.

## Find the promotion (read-only, report what you find)

1. Read the NOTIFY-13 DEPLOY_LOG entry and the NOTIFY-13 ROADMAP row. List every commit SHA they name.
2. Confirm each one is an ancestor of `main` (`git merge-base --is-ancestor <sha> main`).
3. Find the merge on main's first-parent line that brought them in: `git log --first-parent --merges --format='%h %p %ad %s' --date=iso main` and pick the earliest merge whose second parent contains them all.
4. STOP and report instead of editing if any of these is true: a listed commit is not on `main`; NOTIFY-13's commits arrived over more than one merge; there is no merge (main was fast-forwarded); the row and the log disagree about which commits are NOTIFY-13's.

## Edits (only if the find step was clean)

1. `/Users/garythomas/Claude_Projects/Froot/froot/docs/DEPLOY_LOG.md`: replace the `UNPROMOTED` heading with the merge short SHA, in the same heading format the STAFF-3 entry now uses. Add a paragraph: promoted in merge `<sha>` on `<date in Pacific>`, both parents, stamped late on 2026-10-24 (found during the STAFF-3 docs pass `e31484f`). Add the rollback line `git revert -m 1 <sha>`. Heading count must stay the same — report before and after.
2. `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml`: if the NOTIFY-13 row is not already `shipped`, set `shipped:` to the merge date and add the merge SHA to its commits. If it is already `shipped`, only add the merge SHA if missing. Prepend a dated note: stamp applied late on 2026-10-24.
3. Touch nothing else. Any other stale `UNPROMOTED` heading you notice goes in the report as a finding, not an edit.
4. `grep -c '__'` on the lines you added must be zero.

## Commit (commit only, never push)

Run `npm run build` first. Stage only the two docs files plus this prompt: `docs(NOTIFY-13): late promotion stamp <sha>, row to shipped`.

Report the SHA, the build result, the heading counts, and stop.
