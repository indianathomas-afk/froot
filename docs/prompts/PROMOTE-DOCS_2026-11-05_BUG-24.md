Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/PROMOTE-DOCS_2026-11-05_BUG-24.md and follow it.

# PROMOTE-DOCS 2026-11-05 — BUG-24

**TIER 1** (docs only, no code, no schema). Declare the tier before writing anything.
Branch: `staging`. Commit only — never push. Stage only the files you touch.

## Gate
- Staging and main must both be at `1d6e0b8`. If they aren't, STOP.
- The production merge is `1d6e0b8`, with first parent `8845365` and second parent `56287ab`. It carries `9a5b987`, `7cde006`, `fd1adb2`, `dc3785f` and `56287ab`. There is no migration. Rollback is `git revert -m 1 1d6e0b8`.

## Staging evidence (seen in the planning chat, 2026-11-05; record it as given)
- **Store with history:** deleting South Reno on staging kept the dialog open with "This store has checklists, purchase orders or inventory counts — it can't be deleted." The store stayed.
- **Staff with records:** deleting Tommy Thomas showed the alert "This staff member has records and cannot be deleted — terminate them instead." He stayed.
- **Staff with no blocking records:** deleting Brielle Caron (Carson) on staging went through, which is the existing design. She was restored by the Square staff sync. Her row shows attendance ("20% on time"), so Froot holds shift history for her, yet nothing blocked the delete.
- The user-removal case was not exercised in a browser, on purpose, because it deletes a real Clerk login. The fixture covers it.

## Before writing, ask Gary one thing and record his answer in his own words
Has production been checked? Did production `1d6e0b8` go Ready, and if he tried it, does a blocked store delete on www.usefroot.com show the sentence? If he hasn't checked, record "not checked in production" rather than stopping.

## Edits (one docs commit)
1. `/Users/garythomas/Claude_Projects/Froot/froot/docs/DEPLOY_LOG.md`: stamp the BUG-24 UNPROMOTED entry with `1d6e0b8` and 2026-11-05, and add the staging evidence above plus Gary's answer. Heading counts must be equal before and after.
2. `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml`: set BUG-24 to `shipped: 2026-11-05` with the merge SHA, deleting nothing. UX-3, UX-4 and DEBT-126 stay `planned`.
3. File one new row, using the next free id after reading the file. Staff delete only refuses on Froot record types; a staff member with Square shift/attendance history (e.g. Brielle Caron on staging) can still be hard-deleted. Planning-chat lean, not yet a ruling: anyone with any history should be terminate-only. Name which tables hold shift history for a staff member and how they link (FK or `squareTeamMemberId`).
4. Commit this prompt file.
5. Run `npm run build` and confirm the roadmap generator parses.

Report the SHA and `git log --oneline @{u}..`. Gary then runs the usual push round: push staging → checkout main → merge staging → push main → checkout staging → merge main → push staging.
