# PROMOTE-DOCS 2026-11-11: TAB-14

Prompt of record for the TAB-14 promotion pass. Gary gave it in chat as one
message; it is reproduced verbatim below. Nothing else in this file is an
instruction.

## Message 1

Gate 5 passed on staging. Record the evidence:
- Your own Gate 5 checks, each marked as observed by you.
- My iPad checks, recorded as observed by Gdogg: tablet Checklists in portrait, tablet Home Start still opens the tick list in the card, and the TAB-13 tabs still swap the hero. All working.
- Second-store check: record as "not observed" unless I've told you otherwise.

Then prepare the staging → main promotion, the same way as TAB-13:
- --no-ff merge of staging into main
- fast-forward staging to the merge
- docs commit on staging: DEPLOY_LOG stamped with the merge SHA and rollback (git revert -m 1 <merge>), ROADMAP row → shipped
- Do not rebase or amend any existing commit.
- TAB-4 migration: if Neon is signed in, close the "evidence pending" item with the production-branch query (br-sparkling-block, branch column shown). Otherwise leave it pending.

Before stopping, confirm git log main..staging holds only the TAB-14 commits plus adc0f9e (TAB-13's promotion docs). Then stop for my pushes and give me the exact push commands in order.
