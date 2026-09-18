# CAL-1b — Edit an existing reminder — TIER 2

Contained. One work commit, one docs commit. No schema change. No new
capability. You never push.

## Repo gate
pwd must end in Froot/froot. git status: on staging, clean, up to date
with origin/staging.

## Defect
The CAL-1 plan (B6, addendum in docs/prompts/CAL-1_calendar_reminders.md)
specified "Edit / Archive for calendar.manage" on the occurrence detail
dialog. The build shipped Archive only. Observed on staging 2026-09-18 by
Gary: the detail dialog for a reminder shows the fields read-only and a
single Archive button. There is no way to change a reminder after it is
saved.

## What exists already (verify, do not assume)
- PATCH /api/calendar/events/[id] — confirm it exists, what fields it
  accepts, and that on a recurrence/startDate/dueTime/endDate/stores
  change it deletes the event's Open occurrences for re-derivation
  (plan B5). If it does not exist, build it to that spec.
- create-reminder-form.tsx — the eleven-field form. Reuse it in edit
  mode; do not fork it.

## Build
- Detail dialog gains an **Edit** button beside Archive, visible only
  with calendar.manage (the same check that gates the day-click).
- Edit swaps the dialog body to the reminder form pre-filled from the
  event, Save calls PATCH, Cancel returns to the detail view unchanged.
- Fields editable: every field the create form has, including the
  attachment (replace or remove).
- On save: the grid re-fetches; the detail view re-opens on the same
  event showing new values.
- Completed occurrences are never touched by an edit (ruling 3 record
  stays). If the edit changes the schedule, the note in the detail view
  should say the next date will be re-derived by the hourly job.
- API enforces calendar.manage; the button is not the gate.

## Gates
npm run build exit 0 and scoped eslint, both read without a pipe.
verify-perm8-grants and verify-nav1-url-sets unchanged and green.

## Docs
ROADMAP: CAL-1b row citing the work SHA; prepend a rider to CAL-1 naming
the gap and this fix. One line added to CAL-1's DEPLOY_LOG entry. No
DECISIONS entry (no ruling).

Report the SHAs and stop. Do not suggest further work.
