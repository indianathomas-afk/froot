# PROMOTE-DOCS 2026-09-28 — DOC-5

**TIER 1.** Docs only, on `main`. One commit, not pushed. No code, no schema, no prisma commands.

Repo: `/Users/garythomas/Claude_Projects/Froot/froot` · Branch: `main`

## Gate

1. Confirm you are on `main`, the tree is clean, and `main` is level with `origin/main`. If `main` is ahead of `origin/main`, STOP and report.
2. Find the promotion merge with `git log --merges -1 --format='%H %s' main`. Confirm it is the merge of `staging` whose second parent is `d2bded4`, and that `git log --oneline <merge>^1..<merge>^2` is exactly `a7e9d86`, `c9426eb`, `d2bded4`. If anything differs, STOP and report.

## Edits

1. **`docs/DEPLOY_LOG.md`, DOC-5 entry:**
   - Change the `## UNPROMOTED` heading to the promoted form used by neighboring entries, stamped with the merge's short SHA and `2026-09-28`.
   - Add the rollback line `git revert -m 1 <merge>`. Note that the migration only adds things, so the table and column stay behind harmlessly after a revert.
   - Correct the payload paragraph in place with a dated rider: `a7e9d86` and `c9426eb` were already pushed to `origin/staging` before the check ran. Don't rewrite the original sentence.
   - The heading count must stay the same, and no lines may be deleted except the heading line you replace.

2. **`docs/ROADMAP.yaml`, DOC-5 row:**
   - Set `status: shipped` and `shipped: 2026-09-28`, and add the merge SHA.
   - Prepend a dated correction: `c9426eb` was pushed alone and staging most likely failed to build it (the `links:` typecheck), until `d2bded4` fixed it. That supersedes the row's "never deployed alone" wording. Quote that wording; don't delete it.
   - Record the evidence:
     - dev `br-broad-wave`: 0 of 3 uncategorized, 5 categories per org;
     - staging `br-square-feather`: 0 of 11, Gary's click test passed, Tommy POST `/api/hr/documents/categories` → 403;
     - production `br-sparkling-block`: 0 of 6 after the deploy.

3. **`docs/MIGRATIONS.md`:** mark `20260928213037_doc5_document_category_entity` as applied to production on 2026-09-28 via vercel-build.

## Finish

- Run `npm run build` **after** your edits and before committing. It must exit 0 with no error lines.
- Stage only the three files and make one commit: `docs(DOC-5 promotion): stamp <merge>, row to shipped, production evidence`.
- Report the SHA, then list the owed commands one at a time without running them: `git push origin main`, `git checkout staging`, `git merge main`, `git push origin staging`.
