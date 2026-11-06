Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/PROMOTE-DOCS_2026-11-05_DEBT-125.md and follow it.

# PROMOTE-DOCS 2026-11-05 — DEBT-125 (closes BUG-25)

**TIER 1** (docs only, no code, no schema). Declare the tier before writing anything.
Branch: `staging`. Commit only — never push. Stage only the files you touch.

## Gate
- Staging and main must both be at `ba38ed2`. If either isn't, STOP.
- The production merge is `ba38ed2`, with first parent `2b0a33e` and second parent `9213f4c`. It carries `1c85892`, `b72883e`, `98532a3` and `9213f4c`. Code rollback is `git revert -m 1 ba38ed2`, but it does NOT undo the `0_init` rows. Say so in the entry: rolling back the squash needs a planning session, not a revert alone.

## Already-known evidence (from the planning chat, 2026-11-05; record it as given)
- **Production marked:** `0_init` INSERT on `br-sparkling-block-a620qvg4`, checksum `0e7d39aa…b752e4c717`, 1 step, 87 ledger rows.
- **Staging marked:** `0_init` id `85cb75ea-8670-4cde-b5ba-255a713543f4` on `br-square-feather-a63z92vz`, 87 rows. The staging build for `9213f4c` on `ep-odd-rain-a6gr4xmm` showed "1 migration found", then "No pending migrations to apply". Gary's staging smoke test passed: footer `9213f4c-staging`, dashboard, Opener edit page, PO-00001, checklists.

## Before writing, ask Gary three things, and record each answer in his own words
1. Did the production build log for `ba38ed2` show `ep-green-smoke-a6xthq4r`, "1 migration found" and "No pending migrations to apply", and did it go Ready?
2. Did the production smoke test pass (footer `ba38ed2`, dashboard, Opener edit page, a purchase order)?
3. The BUG-25 ruling in DECISIONS.md (from `4e11087`) is still marked DRAFT. Ask for his ratification in his own words, or "Ratify as written".

If any answer is missing, STOP. Write no placeholder tokens.

## Edits (one docs commit)
1. `/Users/garythomas/Claude_Projects/Froot/froot/docs/DEPLOY_LOG.md`: stamp the DEBT-125 UNPROMOTED entry with `ba38ed2` and 2026-11-05. Add the production marking, the production build evidence and Gary's answers, and the rollback note. Heading counts must be equal before and after.
2. `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml`: set DEBT-125 to `shipped: 2026-11-05` with the merge SHA, and set BUG-25 to `shipped` (closed by DEBT-125). Preserve and mark; delete nothing.
3. `/Users/garythomas/Claude_Projects/Froot/froot/docs/MIGRATIONS.md`: set the ledger so staging and production show as marked (ids/dates as known) and the squash entry's status reads "marked on all branches".
4. `/Users/garythomas/Claude_Projects/Froot/froot/docs/DECISIONS.md`: record Gary's BUG-25 ratification verbatim. Remove "— DRAFT" from that heading and keep the old draft paragraph marked as no longer current.
5. Commit the untracked prompt files in `docs/prompts/`: `DOCS-N5b-promotion-and-BUG-22.md`, `N-5e-addon-import-audit.md`, and this prompt.
6. Run `npm run build` and confirm the roadmap generator parses.

Report the SHA and `git log --oneline @{u}..`. Gary then runs the usual push round: push staging → checkout main → merge staging → push main → checkout staging → merge main → push staging.
