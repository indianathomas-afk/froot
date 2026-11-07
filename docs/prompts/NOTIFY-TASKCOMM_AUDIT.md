# NOTIFY-TASKCOMM — AUDIT (read-only)

TIER 3. Audit only: no source, schema or migration file was touched. Prompt of
record: `docs/prompts/NOTIFY-TASKCOMM.md` (untracked at the time of writing).
Written 2026-11-06 by the audit session. This file is a session artifact: it is
a claim wholesale and is never edited afterwards (CLAUDE.md § Where documents
live).

## 0. Repo gate and preconditions

```
pwd                   → /Users/garythomas/Claude_Projects/Froot/froot
git status            → On branch staging, up to date with origin/staging;
                        only untracked file: docs/prompts/NOTIFY-TASKCOMM.md
git log --oneline -5  → 1b36e73 docs(NOTIFY-16): PRE-PUSH-CHECK — DECISIONS ratified, DEPLOY_LOG UNPROMOTED, status -> staging
                        17af011 docs(NOTIFY-16): row in_progress at d5d3202, DRAFT DECISIONS entry, prompt of record
                        d5d3202 feat(NOTIFY-16): collapsible sections on /settings/notifications; rename the door and the room
                        4e7948b docs(PROMOTE): BUG-26 + BUG-27 shipped in merge e647573
                        e647573 Merge branch 'staging'
```

**PRECONDITION MET.** NOTIFY-UI-ACCORDION shipped as NOTIFY-16, work commit
`d5d3202`, on staging (ROADMAP.yaml:24243, `status: staging`). The new card
lands inside its `CollapsibleSection`.

**ROW ID: TWO CANDIDATES, AND THE PROMPT'S OWN RULE PICKS THE FIRST.**
- `NOTIFY-4` (ROADMAP.yaml:22988), `status: planned`, title "Operational
  reports email — the scheduled digest Gary wants, recipient model TBD". Filed
  2026-09-20 in NOTIFY-2a and still undesigned. Its notes name /reports and
  /reports/operations as the data and "WHO GETS IT" as the open question. This is
  exactly the case the prompt describes: "if a planned NOTIFY row already
  describes an operational-reports email … lean is to build under that row with
  a dated rider."
- `NOTIFY-17`: free. The highest NOTIFY id in the file is NOTIFY-16.
  The ids run NOTIFY-1, 2a, 2b, 2c, 3–16 with no gaps.

Session instruction said "next free id should be NOTIFY-17; confirm from the
file". Confirmed free, **but NOTIFY-4 matches**, so this is fork **F0** below.

## 1. The notification pipeline — how a new kind plugs in

| Piece | Where | What a new kind needs |
|---|---|---|
| Kind registry | `src/lib/notifications/registry.ts:24` (`KINDS` array) | One `defineNotification()` file in `src/lib/notifications/kinds/` + one entry here. Header comment :1-9 says that is the whole contract. |
| Kind shape | `src/lib/notifications/define.ts:137-211` | `kind`, `label`, `roleDefault`, `extras`, `capability`, `schedule`, `enabled(org)`, `freshnessMinutes`, `resolveRecipients`, `exclude`, `render` (per-intent) or `renderGroup` (grouped). |
| Org fields a kind can read | `define.ts:11-36` (`NotificationOrg`), loaded by `dispatch.ts:364-387` (`ORG_SELECT`, `loadOrg`) | The org switch for this kind must be added to BOTH `NotificationOrg` and `ORG_SELECT`, or `enabled()` cannot read it. If it lives in a new table rather than on `Organization`, `loadOrg` needs a join like the existing `milestoneSettings` one (:374, :381-384). |
| Dispatcher | `src/lib/notifications/dispatch.ts` — header :1-60; recipient pipeline `eligibleRecipients` :412-450 | Nothing per kind. Resolver (reason "role") + extras → `can(capability)` → `exclude` → lower-case de-dup. Mode (live/sandbox/dry-run), sent-once lock and retries are all the dispatcher's. |
| Enqueue / send lock | `dispatch.ts:172-220` (`enqueueNotification`, upsert on `@@unique([organizationId, kind, dedupeKey])`, schema.prisma:999) | Producer picks a dedupeKey. |
| dedupeKey shapes today | pace `${store.id}:${period}` (`pace-alerts.ts:171`); milestone `${member.id}:${milestoneKind}:${milestoneId}` (`milestone-alerts.ts:223`); hr.ack `record.id` (`hr-ack-notification.ts:156`); doc digest `${org.id}:${periodKey(frequency, localDate)}` (`doc-digest-alerts.ts:112`); test `randomUUID()` (`api/notify/test/route.ts:156`) | Lean: doc digest's shape, `${org.id}:${periodKey}`. **But see finding A1. `periodKey` is the SEND date's period, not the REPORTED period.** |
| Schedule model | `NotificationSchedule` schema.prisma:1162-1190 (`@@unique([organizationId, kind])`); run marker `NotificationScheduleRun` :1199-1213 | One row per (org, kind). Re-used as-is. |
| Slot evaluation | `src/lib/notifications/schedule.ts` — `slotDue` :143-172, `periodKey` :73-77, `scheduleProblem` :93-112, `claimScheduleSlot` :183-195 | `KindSchedule` (define.ts:91-126) with `scope: "org"`, `frequencies`, `monthly: "day-of-month"` (dayOfMonth 1–28, schedule.ts:104-107), `hours`, and a `defaultRow` (doc digest precedent, `kinds/doc-digest.ts:137-145`). |
| Hourly runner | `src/lib/scheduled-emails.ts:88-321`, cron `/api/cron/scheduled-emails` at `5 * * * *` (vercel.json) | **Not registry-driven.** Each leg is hand-written: the kinds are hard-coded at :100-106 and :113, and each leg is its own block (pace :118-178, milestones :180-238, doc digest :240-297), plus result fields :53-82 and log lines :350-372. A new kind means a fourth leg, copied from the doc-digest leg. |
| Schedule API | `src/app/api/notify/schedule/[kind]/route.ts` — PUT; DELETE = reset, which **deletes the row** (:60-63) | Generic over any kind with `schedule`. The HR gate at :38 names kinds explicitly; the new kind is not HR-gated, so no change there. |
| Per-user grid | `src/lib/permissions.ts` — union :150-170, baseline :505-530, grid rows `ENFORCED_CAPABILITIES` :1018-1047 (area "Email notifications") | One union member + one baseline entry + one grid row. Deniable comes from the grid row; not-grantable comes from being absent from `GRANTABLE_CAPABILITIES`. **See finding A3: every notify.* baseline today is `MANAGE`; STORE is excluded on purpose (:509-513).** |
| "Also send to" picks | `src/lib/notifications/picks.ts` — `resolveExtras` :63-109; contact→user resolution (F9) :78-106; save path `contacts.ts:102-163`, route `api/notify/recipients/[kind]/route.ts:14-27` | `extras: true` on the kind. **See finding A2. A contact whose address belongs to a user is resolved AS that user (:103-105).** |
| Recent emails | `src/lib/notification-log.ts:27, 62` (labels via `kindLabel` from the registry); UI `settings/notifications/recent-emails.tsx:128` | Nothing. A registered kind is labelled automatically. |
| Sample / preview | `src/lib/notifications/kinds/test.ts` — fictional `sample()` path :19-31, :81-85 (contract define.ts:203-208: "Must never name a real person"); REAL-data `digestPreview` path :47-53, :76-80; route `api/notify/test/route.ts:80-123` incl. `asUser` (a named MANAGER's view, :100-109) | F11's "real data for the last period" is the **doc-digest preview shape** (NOTIFY-14 F9), not `sample()`. It needs a third branch in `test.ts` and in the route. The `asUser` precedent covers the staging check "sample as Tommy". |
| Settings card | `src/app/(app)/settings/notifications/page.tsx` — sections :189 contacts, :194 ack, :248 pace, :303 milestones, :361 docdue (incl. "Send a preview to me" :394-396), :419 recent | A new `CollapsibleSection` between :361 and :419. |
| Org switch precedent | `Organization.docDigestEnabled`, written by `api/doc-digest/settings/route.ts:38` | See § 8. |

**Closest analogue: the document digest (NOTIFY-14).** It is org-scoped and
scheduled, has one intent per org per period, carries a payload SNAPSHOT of
one view per distinct scope, and maps each recipient to a view. The map fails
closed (`kinds/doc-digest.ts:6-24, 166-179`; producer
`doc-digest-alerts.ts:1-79`). NOTIFY-TASKCOMM is the same machine with a
different builder. It needs no grouped batch mode: one intent per org per period
and one message per recipient is the per-intent mode.

## 2. TeamMessage

Schema: `prisma/schema.prisma:2378-2424`.

- `type` default `"general"` (:2386); allowed values `MESSAGE_TYPES`
  `src/lib/messages.ts:7-15`: `shift_note, shortage, equipment,
  customer_feedback, staffing, shoutout, general`.
- `shiftPhase` (:2387) `opening | mid | closing`, set when type = shift_note
  (`SHIFT_PHASES` messages.ts:18; required by POST
  `api/messages/route.ts:103`).
- Handoff notes vs feed posts: a handoff note carries `postedToTemplateId`
  (:2392), `postedForDate` (:2393), `sourceChecklistId` (:2394) and
  `expiresAt` (:2403). Store-wide notes have `postedToTemplateId` null
  (messages.ts:76). Active-handoff filter: `activeHandoffNotesWhere`
  messages.ts:81-105.
- Soft delete: `deletedAt` (:2406); the feed GET filters `deletedAt: null`
  (`api/messages/route.ts:58`). Edit: `editedAt` (:2405), with a 15-minute edit
  window (`EDIT_WINDOW_MS` messages.ts:28). An email shows current text.
- Status: `open | resolved | archived` (:2395, `MESSAGE_STATUSES`
  messages.ts:20), the "free ticket system for shortage/equipment";
  `resolvedAt`/`resolvedByUserId` (:2396-2397). The feed GET does NOT exclude
  `archived` unless asked (`api/messages/route.ts:60`).
- Author: `authorName()` messages.ts:181-188, which falls back to the local part
  of the user's EMAIL. F6's "author first name" needs its own first-token rule,
  and must never print an email local-part into a sent email.
- Visibility: the feed is per store. A non-admin gets 403 for a store outside
  their assignments (`api/messages/route.ts:42-45`); an admin sees all. Body cap
  2,000 chars (`MAX_BODY_LENGTH` messages.ts:25); up to 4 attachments
  (messages.ts:24).

**Measured, dev `br-broad-wave-a6vpjdw0` (branch id selected in the same
query, `current_setting('neon.branch_id', true)`), 2026-11-06 20:13:30 UTC
(13:13 PDT):**

```
br-broad-wave-a6vpjdw0  TeamMessage type=shift_note phase=opening total=1 deleted=0 handoff_to_template=1 posted_for_date=1 from_checklist=1 edited=0
br-broad-wave-a6vpjdw0  TeamMessage live, status=open: 1 (shift_note)
br-broad-wave-a6vpjdw0  TeamMessage per org: org cf888f2d-f234-48c7-8097-fd5b44b5b3dd (clerkOrgId org_3FhYUR4l0ue7egug1I0Ig8wxOVn) live=1, created 2026-07-11 21:25:44 UTC
br-broad-wave-a6vpjdw0  MessageAttachment on messages: 0
```

**Dev holds ONE message, and no other type has a single row.** "Counts by type"
is therefore not a usable distribution from dev; it only proves the columns
exist. The org id above is a production-originated row inherited by the dev
fork (CLAUDE.md § Browser Evidence correction, 2026-08-06), so it names a row,
not a dev Clerk org. A real distribution needs staging or production, through
the Neon console (Gary). See finding A7.

## 3. CorporateUpdate

Schema `prisma/schema.prisma:2479-2496`: `title`, `body`, `storeIds String[]`
("empty = visible to all stores", :2485), `pinnedUntil`, `publishedAt` (NULL =
draft), `deletedAt`, `authorUserId` (admin only), attachments.

- Audience: per store, optionally. Empty `storeIds` = org-wide.
- Who sees what in the app (`api/corporate-updates/route.ts:46-80`): ADMIN sees
  everything, drafts included. Everyone else sees PUBLISHED, non-deleted
  updates whose `storeIds` is empty OR overlaps their own store ids (:71-77).
  So a MANAGER/STORE does **not** see every update; they see the org-wide ones
  plus those targeted at their stores. F3's "only where the recipient could see
  them in the app" is this exact predicate.
- Authoring is `corporate.updates.manage` = ADMIN_ONLY (`permissions.ts:229`).

Measured: `br-broad-wave-a6vpjdw0  CorporateUpdate total=0 drafts=0 deleted=0
targeted=0 all_stores=0`. **No rows on dev.**

## 4. /reports and /reports/operations — what the email would have to call

**The functions the prompt says the email "must CALL" do not exist as callable
functions.** Both computations are private, session-bound functions inside the
page files:

- `/reports`: `getReportsData()` at `src/app/(app)/reports/page.tsx:9-84`.
  Not exported. Reads `auth()` (:10) and `getUserStoreScope()` (:15), so it
  cannot run in a cron. The window is a **rolling 7 × 24 h UTC instant**
  `since = Date.now() − 7d` (:18), not a store-local business day. It counts
  **every frequency**: no Daily filter, no `dayCloseJudgesChecklist`. The
  tiles (Total, Completed, In Progress, Pending, Non-Compliant, Missed) are a
  partition (:48-72). The per-store table (:74-81) is **Total, Completed,
  Pending, Missed, Rate**; there is **no per-store Non-Compliant column**,
  which F9's lean lists. `rate = round(completed / total × 100)` (:79). The
  page's period and store `<Select>`s (:44-52 of the JSX block) have only
  `defaultValue` and no wiring; they are decoration.
- `/reports/operations`: `getOperationsData()` at
  `src/app/(app)/reports/operations/page.tsx:125-287`. Not exported, reads
  `auth()` (:133). Store-local date range (:156-172), **Daily-only (or
  calendar-linked)** via `dayCloseJudgesChecklist(dayCloseAppliesTo(frequency),
  calendarOccurrenceId)` (:230), Missed via the lifecycle helpers, late via
  `isCompletedLate` (:237).
- `isMissed()` = `closedAt != null && status !== "Completed"`
  (`src/lib/checklist-lifecycle.ts:482-484`). Daily-only materialisation:
  `dayCloseAppliesTo()` :556-558.

**So the two report surfaces disagree on what a checklist even is.** /reports
counts all frequencies over a UTC rolling week. /operations counts Daily (or
linked) over store-local days. F9's "store performance from /reports" has to
pick one definition. DEBT-26's "call, never re-derive" also means the chosen
computation must first be **extracted into `src/lib/` as a pure
`(organizationId, storeIds | null, window)` function**, with the page calling it.
That is a refactor of a live page, inside a TIER 3 phase. → **F9a, RULING NOW.**

## 5. "Did not attempt" — what the data can and cannot say

How rows come to exist:
- A Checklist row is created only on "Start Checklist"
  (`api/checklists/route.ts:130`), by the admin bulk-generate button (:167), by
  the calendar cron for linked occurrences, **or by day close**, which
  MATERIALISES a `status: "Missed", closedAt, completionRate: 0` row for every
  applicable Daily template nobody started (`api/cron/checklist-day-close/
  route.ts:17-34, 455-470`). A materialised row has no task logs and no
  `sectionsSnapshot` (:440-445).
- "Started" = `startedAt` set on the first task log
  (`api/checklists/[id]/task-log/route.ts:117-121`).
- Materialisation skips: non-Daily templates (:415-436); templates created
  after the window's end (the createdAt floor, :438-468); **weekly-closed days,
  `StoreHours.isClosed` (:375-376), where NOTHING is created**.

**Detector:** store S, business day D is "did not attempt" ⇔ S has ≥ 1 Daily
Checklist row dated D, and every one of them has `startedAt IS NULL` and no
`TaskLog`. Stores with no applicable Daily template have no rows and are never
flagged. This matches F8.

**Can a closed day be told apart from a skipped one?**
- **Weekly closures: YES.** `StoreHours.isClosed` for that weekday → no Missed
  rows are materialised → no rows → not flagged.
- **One-off closures (holiday, weather, renovation): NO.** `StoreHours` is keyed
  `@@unique([storeId, dayOfWeek])` (schema.prisma:424-436) and is weekday-only.
  There is no date-specific closure model; the only date-specific "holiday"
  in the schema is a labor-forecast adjustment (:3727), which day close does
  not read. A store closed for Thanksgiving gets Missed rows materialised and
  **will be flagged**. F8's fallback applies: state it on the email's face and
  file a ROW.
- Second-order hole, already documented at day-close :455-466: a store newly
  assigned to an OLD template can collect up to `DAY_CLOSE_LOOKBACK_DAYS` (2)
  days of misses for days it was not on the template, because
  `TemplateStoreAssignment` has no `createdAt`. Those store-days would read as
  "did not attempt".
- **A store with no StoreHours rows at all still materialises** (`hoursRow`
  null is not `isClosed`, :376; `dayCloseInstant` "no-hours" fallback,
  checklist-lifecycle.ts:276).

Measured: `br-broad-wave-a6vpjdw0  last 30 days: store-days with ≥1 Daily row = 0,
untouched = 0`; `rows with task logs but startedAt null = 0` (the start signal
is consistent). **No checklist rows on dev in 30 days, so no candidate
store-days to count.**

## 6. Day-close timing — the honest send-hour floor

- Day close = store-local close time + `DAY_CLOSE_GRACE_HOURS` = 3
  (`checklist-lifecycle.ts:38`, `dayCloseInstant` :245-290).
- Overnight close (close ≤ open) belongs to D+1 (:281-283).
- No hours / closed weekday / no close time → **03:00 local on D+1** (local
  midnight + 3 h, :265-276).
- The day-close cron runs `0 * * * *`; scheduled-emails runs `5 * * * *`
  (vercel.json). The close for D is written at the first `:00` run at or after
  the close instant. The lookback is 2 days (:41, route :212).

**Floor per store = hour(close(D−1) + 3 h), rounded up to the next :00.** For
a 21:00 close that is 00:00. For 23:00 it is 02:00. For no hours it is 03:00.
For a 01:00 overnight close it is 04:00. The schedule's existing minimum send
hour is **5 AM** for every scheduled kind (doc digest `hours: { min: 5 }`,
`kinds/doc-digest.ts:141`). **5 AM is honest for any store whose close (incl.
overnight) is at or before 02:00 local.** A store open past 02:00 local would
need a later floor.

Measured: `br-broad-wave-a6vpjdw0  active stores: America/Los_Angeles=8,
America/Denver=2; StoreHours rows on those stores = 0 (all 10); closed weekdays = 0`.
**Every active dev store closes on the 03:00 fallback.** No Missed rows were
closed in the last 60 days, so there is no observed `closedAt` hour to report.

**Cross-zone caveat (F4).** The schedule runs in ONE zone, the row's
`timeZone` (org scope). With Denver stores and a 5 AM Los Angeles send,
Denver is at 06:00, which is fine. A store EAST of the schedule zone is always
later; a store WEST of it (e.g. a Hawaii store under a Pacific schedule) reaches
its 03:00 fallback at 06:00 Pacific. **The floor must be computed against the
westernmost store's zone, not just the schedule zone.**

## 7. Store scoping

`getUserStoreScope()` `src/lib/auth.ts:223-237`: ADMIN → `isAdmin: true`
(all stores); everyone else → `storeIds` = their `StoreUserAssignment` rows. It
is session-bound (`getCurrentUser()`), so a cron uses the direct query the doc
digest uses (`doc-digest-alerts.ts:50-56`: `role` + `storeAssignments`).

- ADMIN: every active store.
- MANAGER: assigned stores.
- STORE (device login): **exactly one** assigned store by construction
  (`src/lib/device-login.ts:10-13`).
- Section gates, as the app enforces them today:
  - messages: store scope (`api/messages/route.ts:42-45`);
  - corporate updates: the storeIds predicate (§ 3);
  - reports: `reports.view` = **ADMIN + MANAGER only** (`permissions.ts:264`),
    and the /reports layout redirects without it (`reports/layout.tsx:23`).
    **A STORE login cannot see /reports**, so under F3 a STORE recipient gets
    no section (d). A MANAGER who has `reports.view` denied does not get it
    either.

## 8. Where subject/body overrides (and the rest of the card) should live

- `NotificationSchedule` is the wrong home: "Reset to default" DELETES the row
  (`api/notify/schedule/[kind]/route.ts:60-63`), which would wipe copy. This is
  the F5 lean's reasoning, confirmed.
- The precedent for an org switch is a column on `Organization`
  (`docDigestEnabled`, written at `api/doc-digest/settings/route.ts:38`; read
  via `ORG_SELECT` dispatch.ts:373).
- **This card also needs: the on/off switch, three role checkboxes (F2) and a
  threshold (F9).** Lean: put ALL of it in the one new additive table F5
  proposes. Shape: `NotificationKindSettings(organizationId, kind, enabled,
  subject?, body?, sendToAdmins, sendToManagers, sendToStores, thresholdPct?)`,
  `@@unique([organizationId, kind])`, null = default. That avoids four new
  `Organization` columns and fits NOTIFY-8's "generic per-org setting table"
  (ROADMAP.yaml NOTIFY-8 notes). `loadOrg` gains one join. → **F5a.**
- Escaping: `renderEmail` HTML-escapes `intro` (`email-template.ts:96, 225-227`)
  but renders it as ONE `<p>`. **Line breaks are not kept today**, so F5's "line
  breaks kept" needs a small template change (split on newlines → `<br>` after
  escaping). COMMENT.

## 9. Findings, triaged

**A1 — PERIOD vs SEND DATE (FIX NOW at build, no ruling).** `periodKey`
(schedule.ts:73-77) keys the SEND date's period. This email reports the PRIOR
period. A weekly send on Monday 2026-11-09 has `periodKey` "2026-W46" but
reports W45. The producer must derive the reported window from
`decision.localDate` (yesterday / prior Mon–Sun / prior month), and the
dedupeKey should carry the REPORTED period so the subject, the window and the
lock all name one thing. The build session can just do it.

**A2 — A CONTACT CAN WIDEN A MANAGER'S OR STORE LOGIN'S VIEW (RULING NOW).**
`resolveExtras` resolves a contact whose address matches a Froot user AS that
user (picks.ts:78-106). The doc digest then writes contacts LAST as the
org-wide view (`doc-digest-alerts.ts:13, 65`: "both a manager and a contact →
the org-wide version", ruled NOTIFY-14 F8). For the doc digest that only widens
a MANAGER. Here STORE logins can be recipients, and STORE-login emails are
plus-addresses of one real mailbox (`device-login.ts:113-133`). So an admin who
adds a store login's address as a contact would mail every store's staffing
and customer-feedback text to a shared counter iPad's inbox. **Lean:** a
contact that resolves to a user gets THAT user's scope (narrower wins). Only a
contact that matches no user gets the org-wide view. This departs from NOTIFY-14
F8 for this kind only.

**A3 — STORE LOGINS AS RECIPIENTS REVERSE A STANDING RATIONALE (RULING NOW).**
Every notify.* key is `MANAGE` today, and the comment that set the convention
excludes STORE because "a shared iPad login is not a person, and an email
addressed to one reaches whoever is holding it" (permissions.ts:509-513). F1/F2
make `notify.taskcomm.receive` the first notify key with STORE in its baseline
(`OPERATIONAL`). Also, STORE-login addresses are plus-addresses of the
provisioning admin's mailbox (device-login.ts:113-133). So the "Store logins"
box most likely lands N extra copies in the ADMIN's own inbox, not at the
store. On dev, 0 users have role STORE and 0 addresses are plus-addressed
(measured below), so this cannot be checked here. Gary to confirm F2's Store
box knowing that.

**A4 — THE /reports FUNCTIONS MUST BE EXTRACTED FIRST, AND THE TWO PAGES
DISAGREE (RULING NOW → F9a).** § 4. The "call, never re-derive" rule cannot be
met without a refactor of `/reports/page.tsx`. /reports (all frequencies, UTC
rolling week, no per-store Non-Compliant) and /operations (Daily, store-local)
use different definitions.

**A5 — HOLIDAYS WILL BE FLAGGED (ROW, per F8's own fallback).** § 5. No
date-specific closure model exists. File a ROW for a store-closure-by-date
model if Gary accepts F8 as leaned. The newly-assigned-store hole (§ 5) rides
the same row.

**A6 — PAYLOAD RETENTION (RULING NOW, small).** The doc-digest pattern stores
the rendered snapshot in `NotificationIntent.payload` (schema.prisma:986).
NOTIFY-8 P5 prunes messages, events and deliveries at 180 days but **keeps
intent state forever**. A taskcomm snapshot would hold staff-authored message
bodies (staffing, customer feedback) indefinitely in `payload`. **Lean:** the
payload holds ids and counts only, and the dispatcher's render re-reads the
bodies. If the snapshot is kept, P5's prune must also null the payload.

**A7 — DEV CANNOT EVIDENCE THIS FEATURE (COMMENT).** Dev
`br-broad-wave-a6vpjdw0` has 1 message, 0 corporate updates, 0 StoreHours,
0 checklist rows in 30 days and 0 STORE users. The build fixture must SEED
every case it asserts (it would anyway, as `verify-notify14-doc-digest.ts`
does). Any real-distribution numbers come from the Neon console, run by Gary.

**A8 — RUNNER IS NOT REGISTRY-DRIVEN (COMMENT).** § 1. A fourth hand-written
leg in `scheduled-emails.ts`. Copying the doc-digest leg is the honest move
for one more kind. Making the runner registry-driven is a separate refactor
and not this phase's.

**A9 — LINE BREAKS IN THE BODY (FIX NOW at build).** § 8, a small template
change.

**A10 — AUTHOR NAME FALLBACK (FIX NOW at build).** `authorName()` falls back to
an email local-part (messages.ts:181-188). The email's "author first name" must
not print that. Use the display name's first token, or "A team member".

## 10. Forks — leans as written in the prompt, with audit riders

- **F0 ROW ID.** Lean: build under **NOTIFY-4** with a dated rider ("built as
  Tasks and Communication, 2026-11-xx"), per the prompt's own rule. NOTIFY-17
  is free if Gary prefers a new row. In that case NOTIFY-4 stays planned and
  gets a cross-ref.
- **F1 KIND** `tasks.comm.recap`, "Tasks and Communication",
  `notify.taskcomm.receive`, deniable, never grantable to STAFF. Rider: its
  baseline would be `OPERATIONAL`, the first notify.* key including STORE (A3).
- **F2 WHO.** Admins on, Managers on, Store logins off, plus "Also send to".
  Rider: A3 (store-login mail likely lands in the admin's mailbox).
- **F3 SCOPING.** ADMIN all, MANAGER assigned, STORE own store; contacts
  org-wide; corporate per § 3's predicate; one email per recipient per
  period. Riders: A2 (narrower wins for a contact that is a user), and § 7
  (section (d) only for holders of `reports.view`, so never STORE).
- **F4 FREQUENCY/WINDOW.** Reuse NotificationSchedule, org scope; Daily =
  prior store-local business day, Weekly = prior Mon–Sun, Monthly = prior
  calendar month (`monthly: "day-of-month"`, dayOfMonth 1–28). Default Daily
  7 AM, OFF by default. Riders: A1; § 6 floor (5 AM minimum holds for closes ≤
  02:00 local, computed against the westernmost store).
- **F5 SUBJECT/BODY.** Plain text, subject ≤ 120, body ≤ 1,000, blank =
  default, reset button, new additive table. Rider **F5a**: the same table
  also holds enabled, the three role boxes and the threshold (§ 8); A9.
- **F6 MESSAGES SECTION.** Store → category, daily itemised, weekly/monthly
  counts + still-open equipment/shortage, 300-line cap. Riders: A10; archived
  status is in the feed by default (`api/messages/route.ts:60`). Lean: include
  archived, labelled.
- **F7 CORPORATE.** Title, date, first line, link; posted in window =
  `publishedAt` in window, `deletedAt` null.
- **F8 DID NOT ATTEMPT.** As § 5's detector. Holidays WILL be flagged, so
  state it on the email and file a ROW (A5).
- **F9 STORE PERFORMANCE — RULING NOW.** Metric and number. Rider **F9a**:
  which definition, /reports (all frequencies) or /operations (Daily,
  store-local)? It must be extracted to `src/lib/` and the page re-pointed at
  it (A4). Audit lean: the /operations definition (Daily, store-local), which
  is the only one that matches the email's store-local windows. The per-store
  Non-Compliant column would be new.
- **F10 QUIET PERIODS.** Always send once on; empty-section copy.
- **F11 TESTING.** "Send a sample to me", ADMIN, caller only, real data. Rider:
  this is the NOTIFY-14 `digestPreview` shape, not `sample()` (whose contract
  forbids real names, define.ts:203-208). The `asUser` precedent covers
  "sample as Tommy".
- **A6 retention** — payload of ids vs snapshot of bodies (lean: ids).

## 11. Commands run

Repo gate: `pwd`, `git status`, `git log --oneline -5`. Reads: `cat`, `sed -n`,
`grep`, `wc`, `ls`. One read-only measurement script
(`npx tsx --env-file=.env <scratchpad>/taskcomm-measure.ts`, SELECT statements
only, branch id selected in every query) against dev `br-broad-wave-a6vpjdw0`.
**No prisma CLI command was run.** No file in the repo was written except this
one.

Additional measured lines (same run, same branch):
```
br-broad-wave-a6vpjdw0  User role=ADMIN 4 (plus-addressed 0), MANAGER 10 (0), STAFF 1 (0), STORE 0
br-broad-wave-a6vpjdw0  NotificationSchedule rows: 0
br-broad-wave-a6vpjdw0  Missed rows closed in the last 60 days: 0
```
