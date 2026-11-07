# NOTIFY-4-POLISH — TIER 2

TIER 2: wording and one name lookup in the Tasks and Communication email and
its card. No schema, no migration, no new route, no new dependency. Build, two
commits, STOP. Never push.

This is a follow-up on the NOTIFY-4 row (status staging, not promoted). No new
ROADMAP row: add a dated rider to NOTIFY-4 and append the SHAs.

## Repo gate (one command at a time, paste each result)

pwd                      → must end in Froot/froot
git status               → on staging, tree clean
git log --oneline -3     → top commit should be 5c24e02

## What Gary saw on staging (2026-11-06, org_3G02wO4QlVVSWppi8aqlnSZnsDa / verified-snapper-7)

Every staging test passed. Four findings, each fixed below.

1. With no Daily checklists in the period, the email says "Every store started
   its checklists" directly above "No tracked daily checklists in this period".
   Vacuous praise.
2. The Recipients line on the card says "as ticked below"; the Admins/Managers
   boxes are ABOVE it.
3. A team message posted by indianathomas (ADMIN, no staff record) shows
   "Team member" in the email, while the Messages feed shows "indianathomas".
   The email must never be less specific than the app.
4. The card's description reads "One email a day …" regardless of the saved
   frequency. The email footer already follows the schedule ("at most once a
   week"); the card description must too.

## Fixes

1. Daily checklists section:
   - No Daily checklists due anywhere in the recipient's stores for the period
     → "No daily checklists were due".
   - Some due, every store with any due started at least one → "Every store
     with daily checklists due started them".
   - Otherwise the existing "did not attempt" lines, unchanged.
2. "as ticked below" → "as ticked above". Grep for any other "below" that
   points the wrong way on this card.
3. Author name, in this order:
   (a) staff first name;
   (b) the SAME display name the /messages feed renders for that author — find
       the function the feed uses and call it, do not re-derive it;
   (c) "Team member".
   Keep the guard: any candidate containing "@" is treated as absent, and the
   User email column is never read. Report which function the feed uses, with
   file:line.
4. Card description: say "a day", "a week" or "a month" from the saved
   frequency, using the same source the footer uses. With no schedule saved,
   the kind's default (daily).

## Fixture

Extend scripts/verify-notify-taskcomm.ts on dev br-broad-wave-a6vpjdw0 (branch
named in output):
- zero Daily checklists → "No daily checklists were due", and NOT "Every store";
- some due, all started → "Every store with daily checklists due started them";
- an author with no staff record and no User name falls to the feed's display
  name; one whose feed name contains "@" falls to "Team member";
- negative control: break the "@" guard and confirm the check fails, then restore.
Re-run the full fixture. npm run build must pass.

## Commits (scope git add to touched files; never -A)

Commit 1 (fix): code + fixture, message cites 12c5474.
Commit 2 (docs): NOTIFY-4 row — dated rider "2026-11-06 staging findings 1–4
fixed in <fix SHA>", fix and docs SHAs appended, staging re-check list:
(a) empty-period preview shows "No daily checklists were due";
(b) Recipients line says "above";
(c) a message by indianathomas shows "indianathomas" in the email;
(d) card description says "a week" with Weekly saved.
Add a line to the DRAFT-free NOTIFY-4 DECISIONS entry ONLY if a choice was made
that the four fixes above don't already state; otherwise leave DECISIONS alone.

## Report and STOP

SHAs, files touched, the feed's name function (file:line), fixture count with
branch, findings classified FIX NOW / RULING NOW / COMMENT / ROW. Do not push.
