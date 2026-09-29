# PROMOTE-DOCS 2026-09-28 — DOC-2

**TIER 1.** Docs only, on `main`. One commit, not pushed. No code, no schema, no prisma commands.

Repo: `/Users/garythomas/Claude_Projects/Froot/froot` · Branch: `main`

## Gate

1. On `main`, level with `origin/main`, and the tree clean apart from this prompt file. If `main` is ahead of `origin/main`, STOP.
2. Find the promotion merge with `git log --merges -1 --format='%H %s' main`. Confirm its second parent is `14a0bdc` and that `git log --oneline <merge>^1..<merge>^2` is exactly `6401819`, `f59beb9`, `14a0bdc`. Anything else: STOP.

## Edits

1. **`docs/DEPLOY_LOG.md`, DOC-2 entry:**
   - Change `## UNPROMOTED` to the promoted heading used by neighboring entries, stamped with the merge's short SHA and `2026-09-28`.
   - Add the rollback line `git revert -m 1 <merge>`. No migration.
   - Add staging evidence (Gary, 2026-09-28, on `14a0bdc-staging`):
     - By Document showed Test - Handbook Regression 2 of 2, and two Policy documents at 1 person each;
     - **sum check on real data:** By Document total 4 owed / 4 signed equals Team Members' document columns (Tommy 3/3 + Gdogg 1/1). The KPI "7 of 8" equals those 4 documents plus 3 of 4 training items;
     - the excluded note counted HR Test Handbook (no audience);
     - the Library "Signing status" link worked;
     - Tommy (STORE) got a 404 on `/hr/compliance`.
   - Mark in place with a dated correction, without deleting the original text: "three commits on staging ahead of origin/staging" should read that `6401819` and `f59beb9` were pushed at 21:59:46 PDT before the check finished, and only `14a0bdc` remained.
   - Use chunked, verified writes: the heading count stays the same, and the only deleted line is the replaced heading.

2. **`docs/ROADMAP.yaml`:**
   - **DOC-2 row:** set `status: shipped` and `shipped: 2026-09-28`, and name the merge in the notes and comment (the DOC-5/SIGNED-1 convention). Put a one-line evidence note at the top of the notes. Mark in place, with a dated correction, the note that says the row is `staging` "on the understanding that Gary pushes next".
   - **New row, next free DEBT id:** "Library shows 'Signing status' on zero-audience (Unassigned) documents". The DOC-2 build report said the link shows only on active compliance documents, but on staging it appeared on HR Test Handbook, which is Unassigned. It's harmless: the link lands on the page with nothing listed. The fix is to hide the link when the document has no audience, using the same function as the Unassigned chip. Status planned, size XS.

## Finish

- Run `npm run build` after the edits. It must exit 0 with no error lines.
- Stage the two docs **and this prompt file**. Make one commit: `docs(DOC-2 promotion): stamp <merge>, row to shipped, evidence, link-on-unassigned row`.
- Report the SHA and the new DEBT id, then list the owed commands one at a time without running them: `git push origin main`, `git checkout staging`, `git merge main`, `git push origin staging`.
