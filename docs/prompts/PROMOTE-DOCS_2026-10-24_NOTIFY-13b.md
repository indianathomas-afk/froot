Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/PROMOTE-DOCS_2026-10-24_NOTIFY-13b.md and follow it.

# PROMOTE-DOCS — NOTIFY-13b record + saved prompt (2026-10-24)

**TIER 1** — docs only. Commits on `staging` (never on `main`). No code, no schema, no Prisma commands except the `prisma generate` inside `npm run build`. Declare the tier first.

## Why

NOTIFY-13b (`7619cc2` — Contacts card first on `/settings/notifications`, blurb "above" → "below") shipped 2026-10-24 with no DEPLOY_LOG note, and its saved prompt `docs/prompts/NOTIFY-13b-contacts-first.md` was never committed.

## Repo gate

1. Confirm you are in `/Users/garythomas/Claude_Projects/Froot/froot` (lowercase), on `staging`, and that `staging`, `main`, `origin/staging` and `origin/main` all point at `fc3b41b`. If not, STOP and report.
2. Allowed untracked files: this prompt and `docs/prompts/NOTIFY-13b-contacts-first.md`. Anything else: STOP and report.

## Find the promotion (read-only)

1. Confirm `7619cc2` is an ancestor of `main`.
2. Find the merge on main's first-parent line that brought it in (`git log --first-parent --merges --format='%h %p %ad %s' --date=iso main`).
3. STOP and report instead of editing if `7619cc2` isn't on `main`, or arrived without a merge (fast-forward).

## Edits (only if the find step was clean)

1. `/Users/garythomas/Claude_Projects/Froot/froot/docs/DEPLOY_LOG.md`: add a short NOTIFY-13b entry in the same heading format as the STAFF-3 entry (merge short SHA — date — NOTIFY-13b…), placed where the file's ordering puts it. Three or four lines: what changed, commit `7619cc2`, merge SHA and both parents, rollback `git revert -m 1 <sha>`, and that it is a TIER 1 cosmetic change recorded late on 2026-10-24. Report heading count before and after (expect +1).
2. No ROADMAP row — TIER 1 cosmetic, none was filed. Touch nothing else.
3. `grep -c '__'` on the lines you added must be zero.

## Commit (commit only, never push)

Run `npm run build` first. Stage only `docs/DEPLOY_LOG.md`, `docs/prompts/NOTIFY-13b-contacts-first.md` and this prompt: `docs(NOTIFY-13b): DEPLOY_LOG entry, commit saved prompt`.

Report the SHA, the build result, the heading counts, and stop. After this, `git status` should show a clean tree.
