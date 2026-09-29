# PROMOTE-DOCS 2026-09-29 — DOC-10

**TIER 1** — docs only, no code. Declare the tier before writing anything.

Repo: `/Users/garythomas/Claude_Projects/Froot/froot`, branch `main`. Commit only — never push.

## Facts

- DOC-10 (search box + "N selected" on the Individuals list in the `/hr/documents` audience dialog) was promoted to production on 2026-09-29 in merge `7308af0` (first parent is the previous main tip; carries `5ad5b6f`, `e9f9b34`, `3fc2b43`). One code file, no migration.
- Rollback: `git revert -m 1 7308af0`.
- Staging-verified by Gary before promotion; production checked by Gary after deploy ("done and tested").

## Do

1. Confirm you are on `main` and `git log --oneline -1` shows `7308af0`. If not, STOP and report.
2. `/Users/garythomas/Claude_Projects/Froot/froot/docs/DEPLOY_LOG.md`: find the DOC-10 entry marked unpromoted. Stamp it with the merge SHA `7308af0`, promotion date 2026-09-29, and the rollback line. Keep the heading count unchanged (report before/after).
3. `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml`: flip the DOC-10 row to `shipped: 2026-09-29` with merge `7308af0`. Preserve-and-mark — do not delete anything.
4. `grep -c '__'` on the lines you changed must be zero.
5. `npm run build` passes (the roadmap generator runs in it).
6. One commit, staging only the two docs files.

## Report

Commit SHA, heading count before/after, build result.
