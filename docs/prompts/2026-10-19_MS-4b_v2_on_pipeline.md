TIER 3 session. Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/2026-10-19_MS-4b_v2_on_pipeline.md and execute it. Repo gate first, one command at a time. Stop where it says stop.

# MS-4b v2 — Milestone emails as the first new kind on the NOTIFY-6 pipeline — TIER 3

TIER 3: a migration (one org column), a new notification kind, a new batch
mode in the dispatcher, a producer leg in a cron, a new per-user switch.
Audit → plan → STOP for Gary → build → STOP at the migration. Commit only.
Never push. Never run a migration.

Written 2026-10-19. **This prompt SUPERSEDES
`docs/prompts/2026-10-17_MS-4b_notifications.md`** (v1). v1 is a claim
wholesale and is not edited; where v1 and this file disagree, this file wins.
v1 is still the source for what a milestone email IS (F2, F6, F7, F9, F10,
F13 and the MS-4a facts, repeated below). It is NOT the source for how the
email is sent, logged, locked, retried or tested. NOTIFY-6 now owns all of
that. If something here is wrong by the time it runs, say so in the audit
rather than working around it.

## PRECONDITION — LIFTED
v1's precondition (Gary, MS-4 session: *"MS-4b: don't build until I confirm
production's NOTIFY_EMAIL_PROVIDER."*) is lifted. Gary, 2026-10-19, his
words: *"Hold lifted: production's NOTIFY_EMAIL_PROVIDER is unset (confirmed
in Vercel 2026-10-18), so production dry-runs safely."* And P0's hold is
met: *""Held behind NOTIFY-6" means on staging, which it is."* No further
quote is needed to start.

## What MS-4b delivers (plain English, unchanged from v1)
When an employee reaches a tenure milestone or a checklist milestone, Froot
emails the ADMINs and that employee's MANAGERs once, in the branded
template, with a link to the employee's Milestones tab. Each recipient gets
at most ONE email per day, listing every new milestone in their stores.
Froot NEVER emails the employee. Each ADMIN/MANAGER can be switched off in
the Edit User grid ("Milestone reached"). An org switch, OFF by default,
turns the whole thing on.

What changed from v1 is the plumbing. Milestones become one more kind on
the NOTIFY-6 pipeline (`src/lib/notifications/`). The delivery mode table
(`deliveryMode()`, NOTIFY-5) decides live / sandbox / dry-run, exactly as for
every other email.

NOT in MS-4b: raise-eligible emails (F2: off), the Milestone Report (MS-5),
suppression (NOTIFY-7), unsubscribe / From name / reply-to / the generic
per-org setting table (NOTIFY-8).

## Read first, in order
1. `docs/DECISIONS.md` — the 2026-10-19 "MS-4b re-scoped onto the NOTIFY-6
   pipeline" entry (the five rulings below, Gary's words); the 2026-10-18
   NOTIFY-6 entry (R1, R2, P6 and the 18 ratified choices); the NOTIFY-5
   entry (the mode table, the test-send ruling); the MS-4 and MS-4a entries.
2. `docs/prompts/2026-10-18_NOTIFY-6_AUDIT.md`, and
   `docs/prompts/2026-10-18_NOTIFY-3_AUDIT.md` section 4.7 ("How a new type
   plugs in — milestones as the worked example") and the MS-4b line of
   section 7.
3. `docs/ROADMAP.yaml` — the MS-4, MS-4a, MS-4b, NOTIFY-5, NOTIFY-6 and
   NOTIFY-11 rows, blockers first.
4. The pipeline code: `src/lib/notifications/define.ts` (NotificationKindDef,
   NotificationOrg, IntentState incl. the unused `known`),
   `registry.ts`, `dispatch.ts` (enqueueNotification, dispatchNotifications,
   resolveTransport, the R2 sweep guard), `kinds/pace-alert.ts`,
   `kinds/hr-ack.ts`, `kinds/test.ts`; `src/app/api/notify/test/route.ts`;
   `src/app/api/cron/notify-dispatch/route.ts`; `src/lib/notification-log.ts`
   (listRecentEmails); `src/lib/notify.ts` (deliveryMode, sandboxAllows).
5. `docs/prompts/2026-10-17_MS-4b_AUDIT.md` — A-section facts still hold for
   recipients and back-fill size; its F14 / F15 / F16 forks are answered
   below.
6. The MS-4a code: `src/lib/milestones.ts` (tenureProgress,
   checklistProgress), `src/lib/milestones-db.ts` (namedTaskDates,
   checklistMilestonesEnabled), `src/lib/milestones-access.ts`
   (milestonesActive).

## Rulings (do not re-open)

**Gary, 2026-10-19, his words exactly:**
1. *"Build the daily summary: one email per person per day, via a new
   grouping mode in the dispatcher."*
2. *"Milestones reached more than 7 days before the job runs are recorded as
   known without sending, and each milestone is dated the day it was reached,
   never "today"."*
3. *"P2 replaces F5: on staging, milestone emails go only to the allowlist,
   like every other email type."*
4. *"F15: yes — never email the employee about their own milestone, excluded
   by linked account and by matching email."*
5. *"Hold lifted: production's NOTIFY_EMAIL_PROVIDER is unset (confirmed in
   Vercel 2026-10-18), so production dry-runs safely."*

**Earlier rulings that still bind (as in v1 and DECISIONS):**
- F2: tenure milestone reached and checklist milestone reached send email.
  Raise eligible does NOT.
- F3: nothing reached more than 7 days before the check runs is ever
  emailed (now ruling 2's `known`).
- F4: once a day inside the existing pace-alerts cron (15:00 UTC), judged in
  each store's time zone; one email per recipient per day (now ruling 1).
- F6: every ADMIN, plus every MANAGER with a StoreUserAssignment to ANY of
  the employee's StoreStaffAssignment stores (the /staff rule). Never the
  employee; never a manager about their own milestone. Corporate staff
  (isCorporate): ADMINs only. Each recipient filtered by
  `can(…, "notify.milestone.receive")`. Resolved at dispatch, never cached.
- F7: employee name, store, milestone, recognition, the suggested employee
  message, a link to the Milestones tab. NO pay, rates, raise dates or
  amounts — asserted on the rendered HTML.
- F9: no email for archived milestones or terminated staff.
- F10: an org-level milestone email switch, OFF by default, a card on
  /settings/notifications like the pace-alert switch.
- F13 (MS-4a): checklist milestones exist only while
  MilestoneSettings.checklistMilestonesEnabled is on.
- MS-4a, Gary: *"a milestone email that was sent stays sent — if the
  milestone is lost and re-reached, don't send again."* NOTIFY-6's enqueue
  already makes `sent` / `partial` / `known` a no-op.
- P6 (replaces v1's F16): *"retry only the recipients who didn't get it,
  using per-recipient delivery rows."*
- R1: sandbox never changes a send's status. R2: the hourly retry never
  sends in sandbox (enforced by NOTIFY-11).
- NOTIFY-5 test-send ruling: "Send a test to me" may reach the admin who
  pressed it even when the allowlist is empty.

**F5 is retired by ruling 3.** v1's "send only when VERCEL_ENV ===
production; anywhere else log and write no rows" is gone. Production with
the provider unset is a dry run that consumes nothing; staging with resend
mails only NOTIFY_SANDBOX_ALLOWLIST and, by R1, never moves an intent to
`sent`. **F14 is answered by the same table** and needs no code of its own.

## Remove / Keep (Claude's review of v1 against NOTIFY-6, 2026-10-19 — not a ruling)

REMOVE from v1 — NOTIFY-6 already does it:
1. The `MilestoneNotice` table and its `known` / `sent` / `failed` states.
   The intent ledger (`NotificationIntent`, dedupeKey
   `staffMemberId:milestoneKind:milestoneId`) is the sent-once lock. v1's
   "row written before the send and removed if the send fails" step goes
   with it.
2. Its own production-only guard and its own dry-run log. `resolveTransport()`
   / `deliveryMode()` decide; the dispatcher writes the message rows.
3. Its own "Send a test to me" button and route. Instead the milestone kind
   gets a `sample()` used through the existing `/api/notify/test` route
   (NOTIFY-6 choice 13: "No `sample()`; `batch` is `"per-intent"` only
   (MS-4b adds both)"). Whether that is a kind selector on the existing
   button or a second button on the milestone card is a plan choice; say
   which.
4. Adding `"milestone"` to `NotificationKind` in notification-log.ts as the
   way to add a type. A new kind is an entry in
   `src/lib/notifications/registry.ts`. (If the reader still needs the
   label, the audit says so.)

KEEP:
- Capability `notify.milestone.receive` (baseline ADMIN + MANAGER) and the
  "Milestone reached" grid line.
- `Organization.milestoneAlertsEnabled Boolean @default(false)` — a column,
  because NOTIFY-8's generic setting table does not exist. This is the
  phase's only schema change unless the audit finds the grouping mode needs
  one.
- The producer leg in the pace-alerts cron: detect reached milestones,
  enqueue them.
- The org switch card on /settings/notifications.
- `?tab=milestones` on /staff/[id], honoured only when the tab would render
  anyway.
- Phone width for every new surface.

## What the rulings change in NOTIFY-6 code (MS-4b owns these)
- **Ruling 1 — a new batch mode**, e.g. `batch: "per-recipient-daily"`, in
  `define.ts` and `dispatch.ts`. `render` today takes one payload; the
  grouping mode needs a render that takes every milestone queued for one
  recipient. Schema note for the audit to confirm: `NotificationDelivery`
  has `messageId` and is unique on (intentId, recipient), and
  `NotificationMessage.intentId` is nullable, so one summary message with
  one delivery per (intent, recipient) pointing at it looks possible without
  a column. P6 then holds per milestone per recipient: a failed summary
  retries only the (milestone, recipient) pairs with no `sent` delivery.
  `"per-intent"` kinds (pace, hr.ack, test) must behave exactly as before;
  their fixtures prove it.
- **Ruling 2 — `known` and the reach date.** `enqueueNotification` only
  creates `queued`. Add a way for a producer to record a milestone as
  `known` without sending (the state exists in `IntentState` and nothing
  writes it). The producer passes `eventAt` = the store-local reach date,
  never the run time: a re-enqueue of a `queued` / `expired` intent replaces
  `eventAt`, so "today" there would get past the 7-day rule. Freshness for
  the kind is 7 days (10080 minutes).
- **`NotificationOrg`** gains `milestoneAlertsEnabled` so the kind's
  `enabled` can read the org switch.
- **Ruling 4 — `exclude`.** The kind's `exclude` drops a recipient whose
  User.id equals StaffMember.userId AND a recipient whose email matches
  StaffMember.email (trimmed, case-insensitive).

## MS-4a facts the design must respect (unchanged from v1)
- A checklist count CAN GO DOWN (un-tick deletes the TaskLog). The intent is
  never deleted or reset because a count dropped, so a milestone that
  un-reaches and re-reaches is not emailed twice.
- A checklist milestone's reach date is the store-local date of the Nth
  named task (checklistProgress). Ruling 2's 7-day rule judges that date.
- Covering staff get no named credit (CHK-16). Not MS-4b's to change.

## Repo gate (one command at a time, paste each result)
pwd                → must end in Froot/froot
git status         → on staging, tree clean, up to date with origin (fetch first)
git log --oneline -5
If any check fails: STOP and report.

## Phase 1 — SHORT AUDIT (read-only), written to docs/prompts/2026-10-19_MS-4b_v2_AUDIT.md
Write the file BEFORE reporting (CLAUDE.md § Where documents live).
B1. Re-check against the code AS IT IS NOW, after NOTIFY-6 (3ffb3f6) and
    NOTIFY-11 (9f54bd8), not against 64569a4: `src/lib/notifications/*`
    (the KindDef shape, enqueue's state table, the dispatcher's per-intent
    loop, the R2 sweep guard, how P6 is enforced twice), the test route,
    the notify-dispatch cron, listRecentEmails, permissions (Capability,
    GRANTS, ENFORCED_CAPABILITIES), email-template, the pace-alerts cron
    route, /settings/notifications, the Edit User grid. Name the exact seams
    the grouping mode and the `known` write touch, and whether either needs
    a schema change.
B2. What production does on deploy, given ruling 5 (provider unset): dry
    run, nothing consumed. Confirm at source that a dry-run milestone
    intent stays `queued` and expires by freshness rather than reaching
    `sent` or `known`, so switching Resend on later still sends anything
    within 7 days.
B3. Back-fill size on staging: hand Gary v1's A4 query, extended with a
    checklist half (named TaskLog counts per member against
    ChecklistMilestone thresholds), for the Neon console on preview/staging
    (br-square-feather-a63z92vz), org cmr54z65v000105jxczpt72w1. The query
    selects current_setting('neon.branch_id', true).
B4. Dev DB level: `npx prisma migrate diff` (read-only). Not level: STOP.
B5. Anything that would let a send reach the employee or an out-of-scope
    manager — name the code path or say none.
B6. Staging exposure: NOTIFY_SANDBOX_ALLOWLIST is set in Preview
    (gary@kevajuice.com). Gary is an ADMIN, so a producer dispatch on
    staging (a hand-fired pace cron) WILL email him about in-window
    milestones once the org switch is on. Say what a first staging run would
    send, from B3's numbers.
Then the plan, with any NEW fork stated plainly with your lean. STOP for
Gary's go.

## Phase 2 — BUILD (only after Gary's go)
1. Migration `ms4b_milestone_alerts`: `Organization.milestoneAlertsEnabled
   Boolean @default(false)`, plus anything B1 proved the grouping mode
   needs. Additive only. `npx prisma migrate diff` into a new folder, then
   STOP. Gary applies it to dev with `npx prisma migrate deploy` and says
   go. Then confirm with `migrate diff` that dev is level BEFORE building —
   a report of "applied" is not the evidence; the empty diff is.
2. Capability `notify.milestone.receive` (baseline ADMIN + MANAGER), grid
   line "Milestone reached".
3. Pipeline changes: the grouping batch mode, the `known` write,
   `NotificationOrg.milestoneAlertsEnabled`, `sample()` support in the test
   route.
4. `kinds/milestone.ts` and its registry entry: kind, label, capability,
   enabled, freshness 7 days, the grouping batch, resolveRecipients (F6),
   exclude (ruling 4), render (F7, many milestones → one email), sample.
5. The producer leg in the pace-alerts cron: its own function and result
   key, its own try/catch; enqueue within-7-day reaches as `queued` with
   eventAt = reach date, older ones as `known`; then a producer dispatch.
6. The org switch card and the milestone test send on
   /settings/notifications; `?tab=milestones` on /staff/[id]; phone width.
7. Fixture `scripts/verify-ms4b.ts`, all on DEV:
   - one email per recipient per day, listing every new milestone; a rerun
     sends nothing;
   - more than 7 days → `known`, no send, never sent later; eventAt is the
     reach date (a re-enqueue does not move it to today);
   - grid switch-off respected; employee never a recipient, by link AND by
     email; a manager never emailed about themselves; out-of-scope manager
     never a recipient; corporate → ADMINs only;
   - archived milestone and terminated staff send nothing; org switch off
     sends nothing; checklist switch off sends no checklist email; a
     checklist count that drops and recovers does not resend;
   - THE MODE TABLE (replaces v1's "non-production sends nothing and writes
     no rows"): dry-run writes a dry-run message row and consumes nothing
     (intent stays queued); sandbox mails only allow-listed recipients and
     leaves the intent queued with zero delivery rows (R1); a sweep never
     makes a sandbox send (R2); live sends and marks `sent`;
   - P6 on the summary: a failed recipient is retried alone, a recipient
     who got it never gets it twice;
   - the rendered HTML has no pay, rate or raise date; the email's message
     equals the stored message; the test send uses sample() and reaches
     only the caller.
   Negative control: break one rule, confirm a check fails, restore.
   Re-run, all must stay green: verify-notify6, verify-notify5,
   verify-f5-polish, verify-notify-template (the per-intent kinds are
   unchanged by the grouping mode), and verify-ms1, ms2, ms3, ms3b, ms4a,
   chk15.
8. `npm run build` passes, gate chain with no pipes.

## Commits (scope `git add` — never `git add -A`)
- Work commit: code + migration + fixture, after the fixture is green
  against the applied schema.
- Docs commit: MS-4b row, DECISIONS draft (Gary's words exact, your choices
  separate), MIGRATIONS entry, the audit file. This prompt is already
  committed.
No DEPLOY_LOG entry — PRE-PUSH-CHECK writes it.

## Final report
Commits, migration name, prisma commands verbatim, fixture counts, build,
choices for ratification, findings triage (FIX NOW / RULING NOW / COMMENT /
ROW), and a staging checklist, every query naming br-square-feather-a63z92vz
and every browser observation naming org cmr54z65v000105jxczpt72w1:
- milestone test send reaches Gary only;
- the "Milestone reached" line in Edit User; the org switch OFF by default;
- with the switch ON, a hand-fired pace cron: allow-listed Gary gets ONE
  summary email for in-window milestones; any other recipient reads "Dry
  run — not sent" / "Held back by the staging allowlist"; intents stay
  `queued` (R1); older milestones are `known`;
- the hourly notify-dispatch sweep sends nothing in sandbox (R2);
- 403/404s as Tommy switched to STORE and as gary@keva.com;
- switch the org switch back OFF after the pass.
End with the unpushed-commits line and: "Done and committed. Next:
PRE-PUSH-CHECK for MS-4b." Do not push.
