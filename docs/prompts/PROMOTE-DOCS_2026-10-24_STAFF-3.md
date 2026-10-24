Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/PROMOTE-DOCS_2026-10-24_STAFF-3.md and follow it.

# PROMOTE-DOCS — STAFF-3 promotion docs pass (2026-10-24)

**TIER 1** — docs only. Commits on `staging` (never on `main`). No code, no schema, no Prisma commands except the `prisma generate` inside `npm run build`. Declare the tier first.

## Repo gate

1. Confirm you are in `/Users/garythomas/Claude_Projects/Froot/froot` (lowercase), on branch `staging`, level with `origin/staging`, and that `staging` and `main` both point at `dc8f062`. If not, STOP and report.
2. Confirm `dc8f062` is a merge with parents `c4a2fde` and `1338135`. If not, STOP and report.
3. Allowed untracked files: this prompt, and `docs/prompts/NOTIFY-13b-contacts-first.md` (not this phase — leave it alone). Anything else: STOP and report.

## Ask Gary first (one message, then wait)

- The Clerk org ID (`org_…`) his browser was signed into for the staging screenshot.
- Which of these he saw on staging: toggle opened with the terminated block at the bottom; Pay sort both directions; Compliance sort both directions; MANAGER view; production `/staff` check after promotion.

If he gives no org ID, record the evidence as "org not recorded" rather than guessing.

## Edits

1. `/Users/garythomas/Claude_Projects/Froot/froot/docs/DEPLOY_LOG.md`: stamp the `UNPROMOTED — 2026-10-24 — STAFF-3…` heading with merge `dc8f062` and `promoted 2026-10-24`. Add the rollback line `git revert -m 1 dc8f062`. Heading count must stay 91.
2. `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml`: STAFF-3 row to `shipped: 2026-10-24`, merge SHA `dc8f062`. Add a staging-evidence note: deployment `froot-e9q3oxl6v` (`dpl_5LAufh428mh7zyawT5Adu6Hya7Q6`) serving HEAD `1338135`; the org ID; observed on the Carson card — terminated hidden by default, header `19 team members · 1 terminated`, `Show terminated (1)` offered to ADMIN, Name sort A→Z, "You" pin on top; plus whatever Gary confirms. Anything he did not see goes in as "not observed".
3. No unfilled tokens: `grep -c '__'` on the lines you added must be zero.

## Commit (commit only, never push)

Stage only those two files plus this prompt: `docs(STAFF-3): promotion stamp dc8f062, row to shipped, staging evidence`.

Run `npm run build` and report the result. Report the SHA and stop.

## Gary runs afterwards, one at a time

1. `git push origin staging`
2. `git checkout main`
3. `git merge staging`
4. `git push origin main`
5. `git checkout staging`
6. `git merge main`
7. `git push origin staging`
