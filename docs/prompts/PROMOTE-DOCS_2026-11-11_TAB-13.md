# PROMOTE-DOCS 2026-11-11: TAB-13 (and the c21fe51 catch-up)

Prompt of record for the TAB-13 promotion pass. Gary gave it in chat as two
messages; both are reproduced verbatim below. Nothing else in this file is an
instruction.

## Message 1

Staging deploy verified visually on Las Brisas (screenshot attached). Before promotion:

1. Run Gate 3 checks 1–8 on staging (org id + Clerk instance first) and record the evidence, including the desktop before/after comparison.
2. The November Goal stat card is missing on staging tablet Home (only Sales Today and November Labor show). Confirm from the 993977f diff that the stats row is untouched, and whether staging's "before" also lacked the card. If it's data, say so. If it's code, STOP.
3. Confirm Las Brisas's Cleaning template really has 1 task on staging (not DEBT-132).

If all clean, prepare the staging → main promotion per the house recipe (--no-ff merge, DEPLOY_LOG entry written before push, rollback recipe noted, c21fe51 catch-up handled by this promotion). Stop for my push.

## Message 2

Rulings to close Gate 3:

- Check 7 (desktop before): ruled covered by code evidence (the desktop branch imports no changed module) plus your "after" shot. Record "before" as not captured. Close the old-deployment tab; no sign-in.
- View: do it yourself on staging. At Las Brisas, open CLEANING ("Overdue Test"), tick its one task so it completes, then confirm the tab reads Done, the hero shows the Completed chip and View, and View opens the Done screen. Record it.
- Check 8 (portrait): I checked on the iPad (screenshot attached): [OK / describe issue].
- Checks 4, 5, 6: ruled covered by verify-tab13-switcher plus the observed reload reset. Record them as "covered by script, not observed on staging."
- The Mid-Shift and Cleaning runs on staging can stay.

Then prepare the promotion, with two conditions:
1. Follow DEPLOY_LOG's promotion recipe exactly. If your commit → merge → fast-forward order differs from it, say so before I push.
2. For the TAB-4 migration record, use production-branch evidence (br-sparkling-block, branch column shown). Neon is signed in now. If you can't get it, record it as "evidence pending", not "applied."

Stop for my pushes and give me the exact push commands in order.
