Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/PROMOTE-DOCS_2026-11-04_TPL-3.md and follow it.

# PROMOTE-DOCS 2026-11-04 — TPL-3

**TIER 1** (docs only, no code, no schema). Declare the tier before writing anything.
Branch: `staging`. Commit only, never push. Stage only the files you touch.

## Gate
- `git log --oneline -1` on staging and on main must both be `6a6e2af` (or staging one docs commit ahead). If not, STOP and report.
- Production merge: `6a6e2af` (first parent `274c1f7`, second parent `b6123e9`). Rollback: `git revert -m 1 6a6e2af` (the `Task.retiredAt` column stays and is harmless).
- The merge also carried `2e2f8b0` (N-5b / BUG-22 docs stamp, docs only). Note it in the DEPLOY_LOG entry. It needs nothing else.

## Before writing, ask Gary for two facts and record them in his words
1. Did the production build log show `20261104020000_tpl3_task_retired_at` applied against `ep-green-smoke-a6xthq4r`?
2. What happened when he deleted Opener Checklist tasks 48–50 on www.usefroot.com and saved (the notice text, and the total task count after reopening)?

Do not write placeholder tokens into any file. If Gary hasn't answered, STOP.

## Edits (one docs commit)
1. `/Users/garythomas/Claude_Projects/Froot/froot/docs/DEPLOY_LOG.md`: stamp the TPL-3 UNPROMOTED entry with `6a6e2af` and the date 2026-11-04. Change its "DRAFT until PRE-PUSH-CHECK" note to "ratified at PRE-PUSH-CHECK (`b6123e9`)", and add the production evidence. Check heading counts before and after; they must stay equal.
2. `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml`: set the TPL-3 row to `shipped: 2026-11-04` with the merge SHA. Preserve and mark: nothing deleted. BUG-23 stays `planned`.
3. `/Users/garythomas/Claude_Projects/Froot/froot/docs/MIGRATIONS.md`: mark `20261104020000_tpl3_task_retired_at` applied to production 2026-11-04 (via vercel-build, `6a6e2af`).
4. Run `npm run build` and confirm the roadmap generator still parses.

Report the commit SHA and `git log --oneline @{u}..`. Then Gary pushes staging, checks out main, merges staging (fast-forward), and pushes main.
