# CAL-2a — Multiple items per day; "today" and due-date logic in store-local time — TIER 2

Contained. One work commit, one docs commit. No schema change, no new
capability, no route changes except where noted. You never push.

## Repo gate
pwd must end in Froot/froot. git status: on staging, clean, up to date
with origin/staging (CAL-2's three commits present).

## Defect 1 — only one item can be created per day
Observed on staging 2026-09-18 by Gary. Once a day cell holds a chip,
clicking the cell opens that chip's detail dialog; there is no way to
open the create form for a second item on the same day. Nothing in the
model prevents multiple items per day (uniqueness is per event / store /
dueDate), so this is a UI affordance gap.

Fix, both parts:
- Chips stop click propagation and open detail. Clicking the cell's
  blank area always opens the create form for that date (calendar.manage
  only, as today). Cells with several chips must still leave a clickable
  blank strip; if a cell is full, the "+N more" affordance and the header
  button below cover it.
- A **+ New** button in the page header (visible with calendar.manage)
  that opens the create form with the date defaulting to today.
- Cells render multiple chips stacked, capped at 3 with "+N more" that
  opens a small list; the list items open detail.

## Defect 2 — "today" is computed in UTC
Observed 2026-09-18 18:35 PDT: the today marker sat on Sat 19 Sep. The
grid derives today from a UTC instant. Same class as the CLAUDE.md
UTC/local entries.

Audit first (report file:line, do not assume): every place the calendar
page, the banner feed, the occurrence detail dialog, and
src/lib/calendar.ts derive "today" or compare a date to now. For each,
state whether it uses the STORE's timezone (Store.timezone — non-null,
default present), the browser's, or UTC.

Fix: "today" for grid marker, day-click default date, due/overdue
comparison and the "N days overdue" count is the store-local calendar
date of the selected store (server: Store.timezone via the same helper
CHK-3 uses; client: the store-local date passed down from the server,
not new Date()). The banner is store-scoped already, so it uses the
occurrence's store. If the audit finds the cron's "≤ today" test is
already store-local (it should be — it reuses dayCloseInstant), say so
and leave it.

Do not change what a "day" means for reminders (ruling 8 stands).

## Gates
npm run build and scoped eslint, both read without a pipe.
verify-cal1-projection, verify-cal2-generation, verify-store-hours-engine
unchanged and green.

## Docs
ROADMAP: CAL-2a row citing the work SHA; prepend a rider to CAL-2.
One line added to CAL-2's UNPROMOTED DEPLOY_LOG entry. No DECISIONS
entry unless the audit finds a today-source ambiguity that needs a
ruling — if so, STOP and ask before building.

Report the SHAs, the audit table, and stop. Do not suggest further work.
