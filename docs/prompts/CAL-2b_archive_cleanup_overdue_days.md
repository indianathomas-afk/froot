# CAL-2b — Archive cleans up generated checklists; "N days overdue" counts from the due date — TIER 2

Contained. One work commit, one docs commit. No schema change. You
never push.

## Repo gate
pwd must end in Froot/froot. git status: on staging, clean, up to date
with origin/staging (DOCS-5's two commits present).

## Defect 1 — archiving a template-backed event orphans its checklists
Observed on staging 2026-09-18 by Gary. "CAL-2 test" (Weekly, all
stores) was materialised at 22:14Z → 12 occurrences, 12 checklists.
Gary archived the EVENT at ~21:20 PDT. Ruling 6 deleted the 12 Open
occurrences; the FK is SetNull, so all 12 checklists remain, Pending,
unlinked — SQL on br-square-feather: status Pending, linked false,
count 12. Day close now skips them as frequencyExcluded. They are new
DEBT-61 litter, created by the feature that closed DEBT-61.
(Note: Carson's checklist reads Pending too; Gary believed he had
submitted it. Record that the submit either did not persist or was not
made; do not investigate beyond one grep of the submit route for an
occurrence-linked path that could reset status.)

Fix: the archive cascade for a template-backed event (both routes —
[id] and the /templates bulk bar, via archive-cascade.ts) applies the
S5-D78 rule already used by PATCH re-derive: for each Open occurrence
being deleted, if its linked Checklist has no started work (define
"started" exactly as S5-D78 does — reuse the helper, do not fork),
delete the Checklist in the same transaction. Started or Completed
checklists are kept, unlinked, and the cascade body reports
{ occurrencesDeleted, checklistsDeleted, checklistsKept }. Same for
archiving a template (ruling 6 terminal path).

Cleanup of the 12 rows on staging is NOT this session's job — Gary
will delete them by SQL after the fix is verified, or leave them; note
this in the row.

## Defect 2 — "N days overdue" counts 24-hour periods (DEBT-101)
Ruling (Gary, chat 2026-09-18): "date." Overdue-ness still begins at
dueAt per ruling 8; the NUMBER shown is the count of store-local
calendar days from dueDate to today, so a reminder due Monday viewed
any time Friday reads "4 days overdue". Change lib/calendar.ts
daysOverdue (and its fixture case in verify-cal1-projection §8 — this
is the one gate that MUST change, and the change is the ruling) and
every caller (banner feed, chip). Same-day due, past close → "due
today", not "0 days overdue". Close DEBT-101 in the docs commit with
the ruling quoted.

## Gates
npm run build, scoped eslint, no pipes. verify-cal1-projection
updated per Defect 2 and green; verify-cal2-generation, perm8, nav1,
store-hours unchanged and green.

## Docs
ROADMAP: CAL-2b row; prepend riders to CAL-2 (archive gap) and CAL-1
(overdue count); DEBT-101 closed. DECISIONS: one-line entry for the
DEBT-101 ruling, DRAFT for PRE-PUSH-CHECK. One line on CAL-2's
UNPROMOTED DEPLOY_LOG entry.

Report SHAs and stop.
