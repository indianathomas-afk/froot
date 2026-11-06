Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/DOCS-N5b-promotion-and-BUG-22.md and follow it exactly.

# DOCS — stamp the N-5b promotion (274c1f7) and record the BUG-22 close

**TIER 1, docs only.** No code, no schema, no prisma commands. One docs commit on `staging`. Never push.

## Preconditions
- Branch `staging`. `origin/main` and `origin/staging` should both be `274c1f7`. Check with git; if not, stop and say so.
- No other Claude Code session has uncommitted changes.
- `docs/prompts/N-5e-addon-import-audit.md` is untracked and stays that way. Don't stage it.

## 1. Stamp the promotion (DEPLOY_LOG + ROADMAP)
Gary promoted N-5b to production on 2026-11-04. His terminal output:
- `git merge --no-ff staging` on main → merge commit `274c1f7` (Merge: `6d2cb1f` `3d55efe`), Wed Nov 4 13:54:37 2026 −0800.
- `git push origin main`: `6d2cb1f..274c1f7`. Staging fast-forwarded to `274c1f7` and pushed.
- After promotion, Gary ran "Sync now" on Inventory → Reports for every store with the range 10/05/2026–11/04/2026, to backfill add-on sales.

Do this:
- Mark the N-5b `## UNPROMOTED` DEPLOY_LOG entry as promoted in `274c1f7`, following the existing promotion-stamp pattern (see the BUG-20 stamp `2d891ea` as precedent). Mark the stale "not pushed" wording spent in place, per DOC-2; don't delete it.
- Write in chunks; check `wc -l` and the heading count before and after.
- ROADMAP: the N-5b row's status goes to `shipped` (it's on main), with the merge SHA. Remaining work goes in `open:`. Variance-hover verification waits on two finalized counts; Gary will do counts.

## 2. Record the BUG-22 ruling (DECISIONS + ROADMAP)
Record this in `docs/DECISIONS.md` **in Gary's words, exactly**, under 2026-11-04:

> BUG-22: Won't build now. 11-04 production webhook lines (11:18–11:20, the start of the lunch rush) showed every sync at 1 page and 230–310 ms of Square time, with one spike to 549 ms. Bursts of up to 5 syncs in a few seconds are harmless because each one replaces the day. Reopen if any store's sync shows 2+ pages or Square time over 800 ms.

Then add a dated rider on the BUG-22 ROADMAP row pointing to that ruling. Use the status value the board already uses for "won't build now" (read the file; don't invent one). Preserve-and-mark; delete nothing.

## 3. Commit
- Stage only the files you touched. No `git add -A`.
- One docs commit. Run the build gate if docs commits normally require it.
- Don't push.

## Report
SHA, files touched (absolute paths), the heading count before and after, and the status value used for BUG-22.
