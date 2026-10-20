TIER 3 session. Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/2026-10-17_MS-4b_notifications.md and execute it. Repo gate first, one command at a time. Stop where it says stop.

# MS-4b — Milestone emails to ADMINs and MANAGERs — TIER 3

TIER 3: schema, a cron leg, a new email type, a new per-user switch. Audit →
plan → STOP for Gary → build → STOP at the migration. Commit only. Never
push. Never run a migration.

Written 2026-10-17 by the MS-4a session (Gary, F11: "Write the MS-4b prompt
during MS-4a."). This prompt is a claim wholesale once committed; if
something in it is wrong by the time it runs, say so in the audit rather than
working around it.

## PRECONDITION — DO NOT START WITHOUT IT
Gary, MS-4 session: *"MS-4b: don't build until I confirm production's
NOTIFY_EMAIL_PROVIDER."* The session prompt must quote his confirmation (the
value, read in the Vercel dashboard — never by `vercel env pull`). No quote:
STOP after the repo gate and ask for it.

## What MS-4b delivers (plain English)
When an employee reaches a tenure milestone or a checklist milestone, Froot
emails the ADMINs and that employee's MANAGERs once, in the branded
template, with a link to the employee's Milestones tab. Froot NEVER emails
the employee. Each ADMIN/MANAGER can be switched off in the Edit User grid
("Milestone reached"). An org switch, OFF by default, turns the whole thing
on. Milestone emails send from production only; an ADMIN "Send a test to me"
button proves the content anywhere.

NOT in MS-4b: raise-eligible emails (F2: off), the Milestone Report (MS-5).

## Read first, in order
1. docs/prompts/2026-10-17_MS-4_AUDIT.md — A2 (how an email type is added:
   NotificationKind, the notify.*.receive capability, renderEmail,
   getEmailSender), A3 (sending, de-dup, STAGING SENDS REAL MAIL), A4
   (back-fill size query), A6 (recipients and store scope), and the MS-4b
   section of A10.
2. docs/DECISIONS.md — the MS-4 entry (Gary's rulings F0-F13, quoted) and
   the MS-4a entry (what MS-4a built and why).
3. docs/ROADMAP.yaml — MS-4, MS-4a, MS-4b rows; blockers.
4. The MS-4a code: src/lib/milestones.ts (tenureProgress, checklistProgress),
   src/lib/milestones-db.ts (namedTaskDates, checklistMilestonesEnabled),
   src/lib/milestones-access.ts (milestonesActive).

## Rulings already made (approved leans — do not re-open)
- F2: tenure milestone reached and checklist milestone reached send email.
  Raise eligible does NOT.
- F3: nothing reached MORE THAN 7 DAYS before the check runs is ever
  emailed; it is recorded as "known" silently. Covers the first run,
  switching Milestones or the email switch on, start-date corrections, and a
  cron outage, with one rule.
- F4: once a day inside the existing production cron (pace-alerts, 15:00
  UTC), judged in each store's time zone; ONE email per recipient per day
  listing every new milestone in their stores; a sent-once record per
  (employee, milestone) so a rerun never sends twice.
- F5: milestone emails send only when `VERCEL_ENV === "production"`;
  anywhere else the leg logs what it would have sent and writes no sent-once
  rows. An ADMIN-only "Send a test to me" on /settings/notifications sends a
  fixed sample to the person who clicked, which works on staging.
- F6: every ADMIN, plus every MANAGER with a StoreUserAssignment to ANY of
  the employee's StoreStaffAssignment stores (the /staff rule — not primary
  only). Never the employee; never a manager about their own milestone
  (StaffMember.userId). Corporate staff (isCorporate): ADMINs only. Each
  recipient filtered by `can(…, "notify.milestone.receive")`. Recipients
  resolved at send time, never cached.
- F7: employee name, store, milestone, recognition, the suggested employee
  message, a link to the Milestones tab. NO pay, rates, raise dates or
  amounts — asserted on the rendered HTML. Gary's addition (built in MS-4a):
  the settings page warns admins not to type pay into the text.
- F9: no email for archived milestones or terminated staff.
- F10: an org-level milestone email switch, OFF by default, a card on
  /settings/notifications like the pace-alert switch.
- F13 (MS-4a): checklist milestones exist only while
  MilestoneSettings.checklistMilestonesEnabled is on. Off = no checklist
  milestone emails.

## MS-4a facts the design must respect
- A checklist count CAN GO DOWN (un-tick deletes the TaskLog). The sent-once
  row is never deleted because a count dropped, so a milestone that
  un-reaches and re-reaches is not emailed twice.
- A checklist milestone's reach date is the store-local date of the Nth
  named task (checklistProgress). F3's 7-day rule judges that date.
- Covering staff get no named credit (CHK-16, Gary: "ship without
  covering-staff credit"). Not MS-4b's to change.
- There is no `?tab=milestones` deep link yet (audit A6). MS-4b adds it,
  honoured only when the tab would render anyway.

## Repo gate (one command at a time, paste each result)
pwd                → must end in Froot/froot
git status         → on staging, tree clean, up to date with origin (fetch first)
git log --oneline -5
If any check fails: STOP and report.

## Phase 1 — SHORT AUDIT (read-only), written to docs/prompts/2026-10-17_MS-4b_AUDIT.md
B1. Re-check A2/A3/A6 against the code as it is now: anything changed since
    64569a4 in notification-log, permissions (Capability, GRANTS,
    ENFORCED_CAPABILITIES), email-template, notify, pace-alerts, the cron
    route, /settings/notifications, the Edit User grid.
B2. Gary's production NOTIFY_EMAIL_PROVIDER value (from the precondition)
    and what it means for when production mail actually starts.
B3. Back-fill size on staging: hand Gary the A4 query, extended with a
    checklist half (named TaskLog counts per member against
    ChecklistMilestone thresholds), for the Neon console on preview/staging.
B4. Dev DB level: `npx prisma migrate diff` (read-only). Not level: STOP.
B5. Anything that would let a send reach the employee or an out-of-scope
    manager — name the code path or say none.
Then the plan, with any NEW fork stated plainly with your lean. STOP for
Gary's go.

## Phase 2 — BUILD (only after Gary's go)
1. Migration `ms4b_milestone_notices`: `MilestoneNotice` (organizationId,
   staffMemberId, milestoneKind "tenure"|"checklist", milestoneId, reachedOn
   @db.Date, state "known"|"sent"|"failed", createdAt;
   @@unique([staffMemberId, milestoneKind, milestoneId])) and
   `Organization.milestoneAlertsEnabled Boolean @default(false)`. Additive
   only. `npx prisma migrate diff` into a new folder, then STOP. Gary applies
   it to dev with `npx prisma migrate deploy` and says go. Then confirm with
   `migrate diff` that dev is level BEFORE building — a report of "applied"
   is not the evidence; the empty diff is.
2. Capability `notify.milestone.receive` (baseline ADMIN + MANAGER), grid
   line "Milestone reached"; `NotificationKind` "milestone".
3. The daily leg: its own function and result key inside the pace-alerts
   cron route (lean; Gary may overrule), production-only guard, dry-run log,
   sent-once row written BEFORE the send and removed if the send fails (the
   pace-alert PaceAlertLog shape), the 7-day "known" rule, one email per
   recipient per day.
4. The org switch card and "Send a test to me" on /settings/notifications.
5. `?tab=milestones` on /staff/[id].
6. Phone width for every new surface.
7. Fixture scripts/verify-ms4b.ts: sent once (rerun sends nothing);
   back-fill > 7 days sends nothing and records "known"; grid switch-off
   respected; employee never a recipient; a manager never emailed about
   themselves; out-of-scope manager never a recipient; corporate → ADMINs
   only; archived milestone and terminated staff send nothing; org switch
   off sends nothing; checklist switch off sends no checklist email; a
   checklist count that drops and recovers does not resend; non-production
   sends nothing and writes no rows; the rendered HTML has no pay, rate or
   raise date; the email's message equals the stored message. Negative
   control: break one rule, confirm a check fails, restore. Re-run
   verify-ms1, ms2, ms3, ms3b, ms4a, chk15.
8. `npm run build` passes, gate chain with no pipes.

## Commits (scope `git add` — never `git add -A`)
- Work commit: code + migration + fixture, after the fixture is green
  against the applied schema.
- Docs commit: MS-4b row, DECISIONS draft (Gary's words exact, your choices
  separate), MIGRATIONS entry, this prompt is already committed, the audit
  file.
No DEPLOY_LOG entry — PRE-PUSH-CHECK writes it.

## Final report
Commits, migration name, prisma commands verbatim, fixture counts, build,
choices for ratification, findings triage (FIX NOW / RULING NOW / COMMENT /
ROW), and a staging checklist: test-send to Gary only; the grid line in Edit
User; the org switch OFF by default; a hand-fired staging cron sends nothing
and logs the dry run; 403/404s as Tommy switched to STORE and as
gary@keva.com. End with the unpushed-commits line and: "Done and committed.
Next: PRE-PUSH-CHECK for MS-4b." Do not push.
