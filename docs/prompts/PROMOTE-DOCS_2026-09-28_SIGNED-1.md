# PROMOTE-DOCS 2026-09-28 — SIGNED-1

**TIER 1.** Docs only, on `main`. One commit, not pushed. No code, no schema, no prisma commands.

Repo: `/Users/garythomas/Claude_Projects/Froot/froot` · Branch: `main`

## Gate

1. On `main`, level with `origin/main`. The tree must be clean apart from this prompt file. If `main` is ahead of `origin/main`, STOP.
2. Find the promotion merge with `git log --merges -1 --format='%H %s' main`. It should be `5c3c6c6`. Confirm its second parent is `41dcdee` and that `git log --oneline 5c3c6c6^1..5c3c6c6^2` is exactly `2ec02a0`, `f20d022`, `41dcdee`. Anything else: STOP.

## Ruling to record (STOP for Gary's words)

The zero-count chip choice was flagged in the build report, but the build session drafted no DECISIONS entry, so PRE-PUSH-CHECK had nothing to ratify.

Draft a short DECISIONS.md entry (SIGNED-1, 2026-09-28) with two points:
- Signed Records shows a chip for every category, including zero counts, deliberately unlike the Document Library, which hides empty chips.
- The reason: an empty chip on Signed Records is itself information (nobody has signed yet).

Print the draft, then **STOP** and ask Gary for his words. Record his reply verbatim as the ruling. Don't write the entry as ratified until he answers.

## Edits (after Gary's words)

1. **`docs/DECISIONS.md`:** the SIGNED-1 entry with Gary's words.
2. **`docs/DEPLOY_LOG.md`, SIGNED-1 entry:**
   - Change `## UNPROMOTED` to the promoted heading used by neighboring entries, stamped with `5c3c6c6` and `2026-09-28`.
   - Add the rollback line `git revert -m 1 5c3c6c6`. No migration rides with it.
   - Add the evidence:
     - staging: Gary's filter test and the Document Library chip regression passed ("Looks great");
     - Tommy `GET /api/hr/signed-records` → 403 (only if Gary has confirmed it; otherwise write "not recorded");
     - **Load more was not exercised on staging** (14 records against a 50-record page). Paging is proven only by the dev fixture (102 records, 38/38).
   - Use chunked, verified writes: the heading count stays the same and no lines are deleted except the replaced heading.
3. **`docs/ROADMAP.yaml`, SIGNED-1 row:**
   - Set `status: shipped` and `shipped: 2026-09-28`, and add merge `5c3c6c6`.
   - Put a one-line evidence note at the top of the existing notes.

## Finish

- Run `npm run build` after the edits. It must exit 0 with no error lines.
- Stage the three docs **and this prompt file** (`docs/prompts/PROMOTE-DOCS_2026-09-28_SIGNED-1.md`). Make one commit: `docs(SIGNED-1 promotion): stamp 5c3c6c6, ruling, row to shipped`.
- Report the SHA, then list the owed commands one at a time without running them: `git push origin main`, `git checkout staging`, `git merge main`, `git push origin staging`.
