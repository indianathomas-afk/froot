Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/PROMOTE-DOCS_2026-11-05_BUG-26-27.md and follow it.

# PROMOTE-DOCS 2026-11-05 — BUG-26 + BUG-27

**TIER 1** (docs only, no code, no schema). Declare the tier before writing anything.
Branch: `staging`. Commit only — never push. Stage only the files you touch.

## Gate
- Staging and main must both be at `e647573`. If not, STOP.
- The production merge is `e647573`, with first parent `80293ca` and second parent `68ed2c0`. It carries `d17edfa`, `b3bfc40`, `527ee04`, `08fedf1`, `361089b`, `156b4ed` and `68ed2c0`. There is no migration. Rollback: `git revert -m 1 e647573`.

## Staging evidence (seen in the planning chat, 2026-11-05; record it as given)
- **/templates Archived tab:** "CAL-2 test" shows a grey "Archived" badge. With one card ticked, the bar reads "1 template selected".
- **/hr/training Archived tab, card view:** both archived modules show grey "Archived" badges. With one ticked, the bar reads "1 module selected".
- **Table view on /hr/training:** not checked in a browser. The fixture covers it.

## Before writing, ask Gary one thing and record his answer in his own words
Did production `e647573` go Ready, and did he look at either Archived tab on www.usefroot.com? If he didn't look, record "not checked in production" and carry on.

## Edits (one docs commit)
1. `/Users/garythomas/Claude_Projects/Froot/froot/docs/DEPLOY_LOG.md`: stamp the BUG-26 + BUG-27 UNPROMOTED entry with `e647573` and 2026-11-05. Add the staging evidence and Gary's answer. Heading counts must be equal before and after.
2. `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml`: set BUG-26 and BUG-27 to `shipped: 2026-11-05` with the merge SHA. Delete nothing.
3. Commit the prompt file `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/PROMOTE-DOCS_2026-11-05_BUG-26-27.md`.
4. Run `npm run build` and confirm the roadmap generator parses.

Report the SHA and `git log --oneline @{u}..`. Gary then runs the usual push round: push staging → checkout main → merge staging → push main → checkout staging → merge main → push staging.
