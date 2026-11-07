# NOTIFY-TASKCOMM — TIER 3

TIER 3: new email kind, schema, cron consumer, recipient logic. AUDIT FIRST,
then STOP for Gary's rulings. Nothing is built until he says go. Never push.

Working name: NOTIFY-TASKCOMM. Row id is NOT assumed. Read
/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml: if a planned
NOTIFY row already describes an operational-reports email (NOTIFY-4 was filed
that way in NOTIFY-2a), say so — lean is to build under that row with a dated
rider. Otherwise take the next free NOTIFY-n.

PRECONDITION: NOTIFY-UI-ACCORDION is committed on staging (this card lands
inside its accordion). If it is not in git log, STOP.

## Repo gate (one command at a time, paste each result)

pwd                      → must end in Froot/froot
git status               → on staging, tree clean
git log --oneline -5     → paste it

## What Gary asked for (condensed)

A new email, "Tasks and Communication", recapping how the prior period's
daily tasks and team messages went, sent to managers and/or stores and/or
admins. Card on /settings/notifications with: frequency daily/weekly/monthly;
admin-editable subject (default "Store communication and operational tasks
update!"); admin-editable body intro. Email contents:
(a) every team message in the period, grouped by store and by type
    (openers, mid, closers, equipment, staffing, shoutout, …);
(b) all corporate communications in the period;
(c) every store that did not start any daily checklist, as
    "[Location] did not attempt any daily checklist for this day.";
(d) a store-performance summary from /reports, flagging stores below a
    threshold (Gary's sentence was cut off — see F9).

## AUDIT (read-only) — write docs/prompts/NOTIFY-TASKCOMM_AUDIT.md

Measure, don't cite. For each item give file:line.
1. The kind registry, dispatcher (src/lib/notifications/dispatch.ts),
   NotificationSchedule / NotificationScheduleRun, the hourly runner
   (src/lib/scheduled-emails.ts), dedupeKey shapes, the per-user grid
   (notify.* capabilities), "Also send to" picks, Recent emails, and whatever
   "send a sample" path exists today. How does a new kind plug into each?
2. TeamMessage: type values and shiftPhase in use; handoff notes
   (postedToTemplateId) vs feed posts; soft delete; status on
   equipment/shortage. Measured counts by type on dev br-broad-wave (branch
   column in the same output).
3. CorporateUpdate: fields, audience/targeting (org-wide or per store?), and
   whether a MANAGER/STORE can see every update in the app.
4. /reports and /reports/operations: the function(s) that compute the tiles
   and per-store table — the email must CALL these, never re-derive
   (DEBT-26). Daily-only tracking; isMissed() in checklist-lifecycle.ts.
5. "Did not attempt": what data distinguishes a store-day with Daily
   checklists none of which had any task logged or was started. Can a closed
   day (holiday / store hours) be told apart from a skipped one? If not, say so.
6. Day-close timing per store: earliest local hour at which "yesterday" is
   closed (Missed written), so the send hour floor is honest.
7. Store scoping: getUserStoreScope for ADMIN / MANAGER / STORE.
8. Where subject/body overrides should live (see F5).

## FORKS — print each with the lean, then STOP for Gary

F1 KIND. New kind "tasks.comm.recap", label "Tasks and Communication".
   Lean: joins the dispatcher, schedule, Recent emails, and the per-user grid
   as notify.taskcomm.receive (deniable for ADMIN/MANAGER/STORE, never
   grantable to STAFF; standing rule: notify.* keys only remove).
F2 WHO GETS IT. Lean: three role checkboxes on this card only — Admins (default
   on), Managers (default on), Store logins (default off) — plus the existing
   "Also send to" contacts. Not a general role-default switch for other kinds
   (that stays deferred, NOTIFY-12 F6).
F3 SCOPING. Lean: each recipient gets only stores they can see in the app —
   ADMIN all stores, MANAGER assigned stores, STORE login its own store.
   Extra contacts get the org-wide (admin) version. Corporate updates included
   only where the recipient could see them in the app. One email per recipient
   per period.
F4 FREQUENCY AND WINDOW. Reuse NotificationSchedule. Daily = prior
   store-local business day; Weekly = prior Mon–Sun, sent on the chosen day;
   Monthly = prior calendar month. Each store's period judged in its own
   Store.timezone; send hour in the schedule's zone (NOTIFY-13 F3 precedent).
   Lean default once switched on: Daily, 7 AM, with a send-hour floor from
   audit item 6. OFF by default for every org, like every other email.
F5 SUBJECT AND BODY. Lean: admin-editable, PLAIN TEXT only (escaped into the
   branded template, line breaks kept), subject ≤ 120 chars, body ≤ 1,000,
   blank = default, "Reset to default" button. Stored in a new additive table
   (orgId, kind, subject?, body?; null = default) so NOTIFY-13's "reset
   deletes the schedule row" never wipes copy. This kind only — other emails'
   subjects stay fixed. Default body (Gary's text, typos fixed):
   "Team communication and task completion are vital to strong employee
   morale, teamwork, and the overall customer experience. This email is
   designed to encourage, promote, and recap how effectively your team is
   working together. If you have questions, please don't hesitate to reach out."
F6 MESSAGES SECTION. Lean: grouped Store → category, categories in this order:
   Openers / Mid / Closers (shift_note by shiftPhase; no phase = "Shift
   notes"), Equipment, Shortage, Staffing, Customer feedback, Shoutouts,
   General. Daily = one line per message: time, author first name, body
   truncated at 200 chars, "+N attachments", and Open/Resolved on
   equipment/shortage. Weekly/Monthly = counts per store per category plus the
   equipment/shortage tickets still open at send time (itemising a month is
   hundreds of lines). Deleted messages excluded; edited shows current text.
   Handoff notes included. Hard cap 300 itemised lines, then "and N more —
   open Messages" with a link. Note for Gary: staffing and customer-feedback
   text will now leave Froot by email, including to extra contacts.
F7 CORPORATE COMMUNICATIONS. Lean: each update posted in the window — title,
   date, first line, link. No read-tracking numbers this phase.
F8 DID NOT ATTEMPT. Lean: flagged when the store had ≥1 Daily checklist for
   that business day and none was started or had any task logged. Stores with
   no Daily templates are not flagged. Weekly/Monthly list each store-date.
   If audit item 5 says closed days can't be told apart, they will be flagged
   — state it on the email's face, file a ROW.
F9 STORE PERFORMANCE — RULING NOW, Gary's sentence ended at "Stores that are
   below". Lean: per-store table from the /reports functions (Total,
   Completed, Non-Compliant, Missed, completion rate) and stores below the
   threshold listed first with a flag; threshold is an integer 50–100 input on
   the card, default 90 (pace-threshold precedent). Gary to confirm the
   metric and number.
F10 QUIET PERIODS. Lean: once switched on, always send; empty sections say
   "No messages posted" / "Every store started its checklists".
F11 TESTING. Cron fires only on production. Lean: "Send a sample to me"
   button (ADMIN, emails the caller only, current settings, real data for the
   last period) — this is how Gary verifies on staging.

## After Gary rules — BUILD

- Generate the migration with prisma migrate diff only. Then STOP: Gary
  applies it to dev himself (npx prisma migrate deploy) and says go. No
  commit until dev has it and the fixture has run (CLAUDE.md migration rule).
- Fixture scripts/verify-notify-taskcomm.ts on dev br-broad-wave, branch
  named in output, with at least one negative control per scoping rule
  (manager sees an unassigned store's message → must FAIL).
- Re-run the existing notify fixtures green.
- npm run build must pass.
- Commits: work, then docs citing the work SHA (ROADMAP row in_progress,
  DRAFT DECISIONS entry in Gary's ruled words, DEPLOY_LOG not touched — the
  check writes it). Scope git add to touched files.
- Staging test list in the row: card renders inside the accordion; save /
  reload / reset copy; sample email arrives for ADMIN; sample as Tommy
  (MANAGER) shows only his stores; "did not attempt" line appears for a store
  with untouched Daily checklists; denial in Edit User removes the recipient.

## Report and STOP

Audit stage: path of the audit file, forks F1–F11 with leans, any finding
classified FIX NOW / RULING NOW / COMMENT / ROW. Wait.
Build stage: SHAs, migration name, fixture counts with branch, findings. Do
not push.
