# NOTIFY-SCHED — audit (Phase 1, read-only)

Session: 2026-10-24. TIER 3. Prompt: `docs/prompts/NOTIFY-SCHED.md`.
Nothing was built, nothing was committed. This file is the session's whole
product (CLAUDE.md § Where documents live).

---

## 0. Repo gate

| Check | Result |
|---|---|
| `git rev-parse --abbrev-ref HEAD` | `staging` ✅ |
| `git status --short` | `?? docs/prompts/NOTIFY-SCHED.md` only ✅ |
| `git log --oneline -1` | `797f100 docs(DOCS-CLEANUP-NOTIFY12): …` ✅ |
| `git log --oneline staging..main` | empty ✅ |
| `git log --oneline main..staging` | `797f100` only (docs commit) ✅ |

No surprises. Dev migration level is in § 11.

---

## 1. Every cron (`vercel.json` at `797f100`)

All eight routes check `Authorization: Bearer ${CRON_SECRET}` (500 if unset,
401 if wrong), are `GET`, and set `maxDuration = 300`. Times are UTC.

| Path | Schedule (UTC) | Sends email? | What it does / how it decides |
|---|---|---|---|
| `/api/cron/sales-reconcile` | `0 11 * * *` | no | Re-pulls the last 3 days of Square sales per linked store. **Pace depends on it** (§ 2). |
| `/api/cron/labor-timecards` | `30 11 * * *` | no | Square timecard re-pull (Advanced Labor orgs). |
| `/api/cron/labor-scheduled-shifts` | `45 11 * * *` | no | Square scheduled-shift re-pull. |
| `/api/cron/engagement-prune` | `0 12 * * *` | no | One `deleteMany` of UsageDaily > 180 days. |
| `/api/cron/pace-alerts` | `0 15 * * *` | **yes — two kinds** | Pace leg: every active store with DailyGoal rows this UTC month in an org with `paceAlertsEnabled` → `processPaceAlertForStore`. Then the **milestone leg** (MS-4b F4): `processMilestoneAlerts`, its own try/catch. Same `sender` and `mode` for both, resolved once. 15:00 UTC = 08:00 PDT / 07:00 PST — **the local send hour already moves with DST today.** |
| `/api/cron/checklist-day-close` | `0 * * * *` | no | Hourly, per store, closes business days past store-local close + grace. Precedent for "hourly so each store runs on its own clock". |
| `/api/cron/calendar-materialize` | `0 * * * *` | no | Hourly, CAL-1/CAL-2 occurrences + checklists. |
| `/api/cron/notify-dispatch` | `15 * * * *` | **retries only** | NOTIFY-6 sweep: `dispatchNotifications({ trigger: "sweep" })` over every `queued`/`partial` intent whose `nextAttemptAt` has passed, every kind, every org. Never a sandbox send (R2). Never a **grouped first send** (MS-4b C3: `attempts === 0` → "first send waits for the daily run"). It **does** make per-intent first sends in live mode for a queued pace intent that the producer left queued (e.g. an unrendered or thrown dispatch) — see F14. |

**Every email producer in `src/`** (searched by the dispatcher's two entry
points, `enqueueNotification` and `dispatchNotifications(`, not by kind name):

1. `src/lib/pace-alerts.ts` — `pace.alert` (scheduled, from the cron).
2. `src/lib/milestone-alerts.ts` — `milestone.reached` (scheduled, from the cron).
3. `src/lib/hr-ack-notification.ts` — `hr.ack` (event: on signing).
4. `src/app/api/notify/test/route.ts` — `test` (event: the admin button).
5. `src/app/api/cron/notify-dispatch/route.ts` — the sweep (no kind of its own).

So exactly two kinds are scheduled today, and both live in one cron entry.
No non-email cron needs to change (F7).

---

## 2. Pace alerts today

**Threshold** (`src/app/api/cron/pace-alerts/route.ts:33-98`):
`Organization.paceAlertThresholdPct` → else `PACE_ALERT_THRESHOLD_PCT` →
else 90. Resolved per org in the cron. The org gate (`paceAlertsEnabled`) is
**in the store query**, so a disabled org burns no lock (F-5b).

**Evaluation** (`src/lib/pace-alerts.ts:63-231`, `processPaceAlertForStore`):

- `today = localDateStr(now, store.timezone)`; `asOf = today − 1` (pace is
  "through yesterday", store-local). If `asOf` is in last month → "month just
  started", nothing (so day 1 of the month never alerts).
- Needs a `plan` goal with `mtdGoal > 0`; MTD actual = sum of
  `SalesPeriodCache.netSales` for the store-local month through `asOf`.
- `evaluatePaceAlert` (pure): alert iff `!alreadySent && pacePct < threshold`.
- **Already accepts `opts.now`** — the fixture clock seam exists.

**The lock — there are two, and the live one is NOT PaceAlertLog.**

1. **The real lock since NOTIFY-6 is the `NotificationIntent`**, unique on
   `(organizationId, kind, dedupeKey)`, with `dedupeKey = "{storeId}:{YYYY-MM}"`
   (store-local month, `pace-alerts.ts:141-148`). `enqueueNotification` is a
   no-op on `sent`/`partial`/`known`/`failed` and refreshes a
   `queued`/`expired` row with today's figures. "Once per store per month" in
   code = **one intent per (store, store-local month) that can reach `sent` once**.
2. **`PaceAlertLog` is a legacy GATE plus a parallel write**, kept for one
   release (NOTIFY-6 audit W4):
   - Read gate, `pace-alerts.ts:99-108`: `paceAlertLog.findUnique({ storeId_month })`
     → `alreadySent`. Exists so a store alerted by pre-pipeline code isn't
     alerted again.
   - Write, `kinds/pace-alert.ts:123-140` `onSent`: on first `sent`, create a
     row; **P2002 is swallowed** (an existing row for the store-month).
   - `@@unique([storeId, month])`, `month` = first-of-month `@db.Date`.
   - NOTIFY-9 retires both (gate + write) in one change.

**F-5b's compensating delete / DEBT-105.** The old shape (write the lock, send,
delete the lock on failure) **no longer exists**. Since NOTIFY-6 the lock row is
only written on success (`onSent`), so there is nothing to compensate. DEBT-105's
guarantee is kept by construction (`pace-alerts.ts:200-203`): a failed live send
writes no PaceAlertLog row, leaves the intent `queued` with a backoff, and
rethrows into the cron's per-store catch. Retries: `BACKOFF_HOURS = [1,2,4,8]`,
`MAX_ATTEMPTS = 5`, then `failed` ("gave up this month").

**Freshness:** `pace.alert` `freshnessMinutes = 24*60` from `eventAt` (the
producer's `now`). The producer refreshes it daily while the store stays behind.

**What this means for the schedule design (finding P1).** The "period lock"
the prompt asks for **already exists generically**: it is the intent's
`dedupeKey`. Generalising pace to daily/weekly is a change to the dedupeKey's
period suffix, not a new lock table. **But the PaceAlertLog gate blocks it**:
it is keyed by month, so under a daily or weekly frequency the second alert in a
month would read `alreadySent = true` and never send. The gate must apply only
to the monthly period (or NOTIFY-9 must land first). The `onSent` write would
P2002 on the second send in a month and be silently tolerated — harmless, but
it means PaceAlertLog stops meaning "every alert" the moment frequency ≠ monthly.

**Copy pinned byte-for-byte (finding P2).** The email text and HTML footer say
"You'll get at most one alert per store per month."
(`kinds/pace-alert.ts:94, 110`), and `scripts/verify-f5-polish.ts:308` pins it.
The hub card says "once per store per month" (`page.tsx`). Both become false
under daily/weekly; both must stay byte-identical with no schedule row (F6).

---

## 3. Milestone emails today

`src/lib/milestone-alerts.ts` + `src/lib/notifications/kinds/milestone.ts`.

- **Runs** once a day as the second leg of `/api/cron/pace-alerts` (15:00 UTC).
  Orgs with `milestoneAlertsEnabled` and `milestonesActive(org)`.
- **Detection** re-counts from scratch every run, per ACTIVE,
  `milestoneEligible` member, in the member's `displayTimeZone(member, org)`
  (primary store → `Organization.timezone` → LA). Tenure and (if F13 on)
  checklist milestones; archived skipped.
- **7-day lookback (ruling 2, Gary 2026-10-19):** reached ≤ 7 store-local days
  ago → `enqueueNotification` (`queued`, `eventAt` = local midnight of the reach
  date); > 7 days → `recordKnownNotification` (create-only `known`, never sent).
  Backstop: `freshnessMinutes = 8 days` (N2).
- **Lock:** one intent per `(member, tenure|checklist, milestoneId)` forever
  (`dedupeKey "{staffMemberId}:{kind}:{milestoneId}"`) — "sent stays sent".
- **"At most one a day" (ruling 1)** is NOT a lock row. It holds because:
  (a) `batch: "per-recipient-daily"` — every due intent for one recipient in one
  dispatch renders into ONE email (`dispatch.ts` `dispatchGrouped`); (b) the
  producer only dispatches what **this run** queued (C2); (c) the sweep never
  makes a grouped first send (C3); (d) the producer runs once a day. **(d) is
  the load-bearing part, and an hourly evaluator breaks it** unless something
  records that the org's milestone slot for the day has run (finding M1).
- **Grouping:** recipients are resolved per intent (every ADMIN + MANAGERs
  assigned to any of the member's stores; corporate → ADMINs only; never the
  employee). Each recipient's summary covers only intents they're eligible
  for (B5-6). So the send is **org-wide per recipient**, not per store: one admin
  can receive Store A (PT) and Store B (ET) milestones in one email. A
  per-store send hour therefore cannot apply to milestones (→ F3).
- **Copy:** footer "You get at most one milestone email a day."
  (`kinds/milestone.ts:92`).

**Finding M2 — the 7-day window and an 8-day freshness only work for a daily
cadence.** Weekly works at the edge (a milestone reached the hour after Monday's
send is 7 store-local days old at next Monday's send — sends; one missed weekly
slot loses it). Monthly does not work at all: anything reached more than 7 days
before the monthly send day is recorded `known` and never mailed, and a queued
one expires at 8 days. A monthly milestone digest **requires amending Gary's
ruling 2**, whose wording ("more than 7 days before the job runs") is his. → F12.

---

## 4. Time zones

| Where | Field | Values | Null? | Written by |
|---|---|---|---|---|
| `Store` | `timezone String @default("America/Los_Angeles")` (`schema.prisma:334`) | **IANA ids.** The UI shows labels ("Pacific (PT)", "Mountain (MT)", "Central (CT)", "Eastern (ET)", plus one more at `stores/store-actions.tsx:42-47`); the stored value is `America/…`. A non-list value is preserved and shown raw. | not null | store edit / Square import |
| `Organization` | `timezone String @default("America/Los_Angeles")` (`schema.prisma:160`) | IANA | not null | **Nothing in the app writes it.** Every org holds the default unless set by hand in SQL. |
| `SquareTimecard` / `SquareScheduledShift` | `timezone String?` | Square's second opinion | nullable | sync |

**`Organization.timezone` is fenced by two rulings.** DEBT-70a (Gary 2026-08-16,
schema comment `:142-159`): it exists as the fallback zone for corporate staff
with no store and "is only ever read at MINT time"; most-common-store-zone was
**rejected** there because it drifts under frozen records. BUG-15
(`reports.ts:58-70`): "Organization.timezone is DELIBERATELY NOT READ" for the
dashboard. In practice it is already read more widely (milestone detection via
`displayTimeZone`, `orgLocalDate` for usage, `staff/engagement`), but it has no
UI and is LA for every org.

**Existing helpers to reuse** (all `Intl.DateTimeFormat` with IANA zones → DST
correct):

- `localDateStr(instant, zone)` — `src/lib/reports.ts:52`. Store-local
  `YYYY-MM-DD`. The CAL-era "UTC today" fixes route through this.
- `localHourOf(instant, zone)` — `src/lib/labor-schedule.ts:729` (h23). **This
  is the evaluator's core test.** It sits behind labor's import wall
  ("a private copy per the labor-actuals precedent"), so the evaluator should
  take a small shared copy rather than import labor.
- `localMidnightUtc(date, zone)` — two copies (`sales-sync.ts:67`,
  `labor-schedule.ts:701`); `zonedInstant(date, time, zone)` —
  `checklist-lifecycle.ts:183`.
- `displayTimeZone(staff, org)` / `primaryStoreTimeZone` / `DEFAULT_TIME_ZONE` —
  `src/lib/hr.ts:240-290`.
- `addDaysStr` — `goal-engine.ts` / `labor-schedule.ts`.
- CAL-2a's fix itself (`calendar-client.tsx:86`) is client-side: "take a
  store-local date string, never read an instant as a day". Same discipline
  applies; nothing to import.

**How should an org-wide email pick its hour?** See F3. Lean: the schedule row
carries its own `timeZone` for org-scoped kinds, defaulted (once, at first
save) to the most common active-store zone and shown/editable beside the hour.
This avoids (a) giving `Organization.timezone` a second meaning against
DEBT-70a/BUG-15 and (b) the drift objection that killed most-common-zone in
DEBT-70a — a send hour is not a frozen record, and the value is stored, not
recomputed.

---

## 5. Registry fit

`src/lib/notifications/define.ts` `KindCommon<P>` has no notion of timing.
The registry (`registry.ts`) is the one place every kind is listed and the
dispatcher is the only reader.

**Proposed mark** (one optional field — absent = event kind, so `hr.ack` and
`test` are untouched):

```ts
schedule?: {
  /** "store": evaluated per store in the store's zone (pace). "org": one slot per org in the schedule row's zone (milestones). */
  scope: "store" | "org"
  /** Frequencies an admin may pick for this kind. */
  frequencies: ("daily" | "weekly" | "monthly")[]
  /** No schedule row → today's behaviour: fire at this UTC hour, current semantics. */
  legacyUtcHour: 15
}
```

**Where the evaluator calls in.** Not the dispatcher. The evaluator decides
*whether a slot is due* and then calls the **producer** — the producers already
own detection, enqueue and the inline producer-dispatch, and their result shapes
are what the fixtures pin:

```
/api/cron/scheduled-emails (hourly)
  for kind in KINDS where kind.schedule:
    for each org with the kind switched on:
      row = NotificationSchedule(org, kind) ?? legacy
      scope "store": for each store → due(row, now, store.timezone)? → claim run → processPaceAlertForStore(store, …)
      scope "org":   due(row, now, row.timeZone)? → claim run → processMilestoneAlerts({ organizationId: org.id, … })
```

`processMilestoneAlerts` already takes `organizationId` (fixture scoping) and
`now`; `processPaceAlertForStore` already takes `now`. Both take `sender` and
`mode` from the caller, resolved once per run — that rule carries over.

The `due()` function and the period-key function are pure and live in a new
`src/lib/notifications/schedule.ts`; the fixture drives them with an injected
`now`.

---

## 6. Hub UI

`src/app/(app)/settings/notifications/page.tsx` (329 lines). Gate:
`can(actor, "settings.access")` → `ADMIN_ONLY` (`permissions.ts:291`), not
grantable. Cards in order: Signed-acknowledgment (HR-gated, event — **no
schedule**), **Behind-pace alerts** (toggle, threshold field, `RecipientsSection`),
**Milestone emails** (HR + Milestones gated; toggle; `RecipientsSection`
with no extras), Contacts, Recent emails.

**Placement:** a `ScheduleSection` component rendered directly after
`RecipientsSection` in the pace card and the milestone card (inside the same
`milestonesOn` branch), mirroring `recipients-section.tsx` (server component,
reads `getKind(kind).schedule`, renders nothing for an event kind — so it can be
dropped onto every card and only the scheduled ones show it).

**Write route:** `PUT /api/notify/schedule/[kind]`, shaped on
`src/app/api/notify/recipients/[kind]/route.ts`: `requireAdmin()` first
(PERM-2 re-check; the page gate is not an endpoint gate), `getOrganization()`,
Zod, reject a kind with no `schedule`, upsert the row. A "Reset to default"
deletes the row (the only delete — a schedule row is config, not history; or
keep-and-flag if Gary prefers additive-only behaviour for config rows too → F15).

**Card copy that must become dynamic:** pace card "once per store per month";
milestone card text. Byte-identical when no row exists.

---

## 7. Vercel limits

- **Plan: Pro** — read today, `npx vercel api /v2/teams/team_263mbnLkV4Te2Ca9ssqrV0gl`
  → `billing.plan = "pro"` (2026-10-24). Matches `docs/prompts/CRON-DIAG_findings.md`.
  Pro cron frequency is not capped at daily; three hourly crons already deploy
  and run (`0 * * * *` ×2, `15 * * * *`).
- **Function limit:** every cron route sets `maxDuration = 300` s. Pro allows
  more (up to 800 s under Fluid compute, per Vercel's docs). **Not verified
  against this project's settings** — the repo isn't `vercel link`ed in this
  checkout, so the project's region/Fluid config was not read.
- **Run time at 100 orgs (estimate, not measured).** Assume ~5 stores/org →
  ~500 stores. A pace store that does not alert costs ~6–8 DB round trips
  (`getMonthGoal`, aggregate, PaceAlertLog read, plus the cron's own queries);
  an alerting store adds enqueue + dispatch (~10–15 more). The DB is in
  `us-west-2`; the function region is unverified. At 20–70 ms per round trip,
  500 non-alerting stores ≈ **60–280 s** sequentially. Milestones scale by
  members × `namedTaskDates` (one query per member when checklist milestones
  are on) — at 100 orgs × ~30 members that's ~3,000 more queries.
  - **With no schedule rows, every org still fires at 15:00 UTC**, so the
    hourly evaluator's worst hour equals today's daily run. **At 100 orgs that
    single run is close to the 300 s ceiling today** — this is not a new risk,
    but the redesign is the place to fix it.
  - **Mitigation built into the lean design:** the run marker (§ 9) plus
    F8's same-day catch-up make overflow self-healing — the evaluator stops at
    a time budget (e.g. 240 s), and the next hourly run picks up every slot not
    yet claimed that local day. Spreading admins across hours spreads load.
  - Keva today: 9 stores, one org — trivially inside the limit.

---

## 8. Staging testability

Vercel runs crons on **Production deployments only**, so nothing fires on
staging by itself. Precedent: CAL / CRON-DIAG manual `curl` with the Preview
`CRON_SECRET` (`Authorization: Bearer …`), against a deployment whose SHA
matches local HEAD (staging-SHA precondition) and was built after any secret
save.

**Proposal:**

1. **No clock override on the route.** A `?now=` parameter on a cron route is a
   way to make a production endpoint lie about time; even gated by
   `VERCEL_ENV`, it is surface for no gain. On staging, Gary sets a scheduled
   card to **the current local hour**, then curls `/api/cron/scheduled-emails`
   once. Expected: the slot fires (sandbox: allowlist only). Curl again the
   same hour: nothing (run marker). Set the hour to one already past today,
   curl: fires (F8 catch-up). Set an allowed-days set that excludes today,
   curl: nothing.
2. **Hand-fire caution unchanged:** a hand-fired producer dispatch re-sends to
   the allowlist (NOTIFY-5 choice 4); the sweep never does (R2).
3. **The fake clock lives in the fixture**, not the route: the evaluator core
   is `runScheduledEmails({ now, organizationId?, sender, mode, budgetMs })`;
   the route passes `new Date()`; `scripts/verify-notify-sched.ts` passes fixed
   instants (including both sides of 2026-11-01 09:00 UTC, the PDT→PST
   change, and a March 2027 spring-forward hour that does not exist locally).
   Pure `due()` / `periodKey()` are tested without a DB.

**Spring-forward gap (finding T1).** On the March DST day, local 02:00 does not
exist in `America/*` zones. A schedule at 2 AM would never match
`localHourOf == 2` that day. F8's catch-up ("first run at or after the chosen
hour on the same local day") covers it automatically — the 03:00 run sends. On
fall-back, local 01:00 occurs twice; the run marker stops the second.

---

## 9. Schema landing spot (proposal — nothing generated)

Two tables, both additive, both cascade on org (the NotificationContact
precedent: no app path deletes an org; fixtures do).

```prisma
/// NOTIFY-SCHED. One per (org, scheduled kind). No row = the kind's legacy behaviour (F6).
model NotificationSchedule {
  id              String   @id @default(cuid())
  organizationId  String
  kind            String
  /// "daily" | "weekly" | "monthly" (validated against the kind's `schedule.frequencies`)
  frequency       String
  /// Local wall-clock hour, 0–23.
  sendHour        Int
  /// ISO weekdays 1 (Mon) … 7 (Sun). Daily/weekly; ignored for monthly (F5).
  daysOfWeek      Int[]    @default([1, 2, 3, 4, 5, 6, 7])
  /// 1–28. Monthly only (F5).
  dayOfMonth      Int?
  /// Org-scoped kinds only (F3). Null for store-scoped kinds, which use Store.timezone.
  timeZone        String?
  updatedByUserId String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, kind])
}

/// NOTIFY-SCHED. "This slot has been evaluated." Claimed by insert BEFORE the producer runs;
/// P2002 = another run has it. Not a send record — the intent is that.
model NotificationScheduleRun {
  id             String   @id @default(cuid())
  organizationId String
  kind           String
  /// storeId for store-scoped kinds, "org" for org-scoped.
  scopeKey       String
  /// The local date of the slot, "YYYY-MM-DD", in the zone that decided it.
  slotDate       String
  claimedAt      DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, kind, scopeKey, slotDate])
}
```

**Two locks, two jobs — the design point.**

- **Run marker (`NotificationScheduleRun`)** = "evaluated this slot". Needed
  because the evaluator runs hourly: without it an on-pace store is re-evaluated
  every hour after its send hour (F8 catch-up), and a second milestone run in a
  day can send a second email (M1). One row per (org, kind, store|org, local
  day). Growth: ~stores × days; prune with the engagement-prune pattern later
  (a row, not now).
- **Send lock (period)** = the existing `NotificationIntent` dedupeKey — **no
  new table.** Period-key suffix by frequency, store-local:
  - monthly → `"{storeId}:YYYY-MM"` — **the existing string, unchanged**, so
    every live intent keeps locking and no-row behaviour is identical;
  - weekly → `"{storeId}:YYYY-Www"` (ISO week, Monday start — the
    MilestoneSettings week convention);
  - daily → `"{storeId}:YYYY-MM-DD"`.
  Milestones keep their per-milestone dedupeKey (sent once, ever); their
  "period" is enforced by the run marker alone.

**PaceAlertLog — preserve and mark, no drop.** The read gate applies only when
the period is monthly (equivalently: only when the dedupeKey is the monthly
string); the `onSent` parallel write stays as is (P2002 already tolerated) and
gets a comment that it records monthly-period alerts faithfully and is lossy for
daily/weekly. NOTIFY-9 still retires both. No migration touches PaceAlertLog.

**Frequency switch mid-period.** Monthly → weekly on the 10th, after an alert
on the 5th: the weekly key is new, so the store can alert again that week. That
is the admin's choice taking effect; stated in the UI help text, not prevented.

---

## 10. ROADMAP

- **Next free ids** (read from `docs/ROADMAP.yaml`, and grepped across
  `docs/ src/ scripts/`): highest NOTIFY row is **NOTIFY-12** → next free
  **NOTIFY-13**; highest DEBT row is **DEBT-121** → next free **DEBT-122**.
  Neither string appears anywhere in the repo.
- **Overlapping rows:**
  - **NOTIFY-3** (planned, deferred) — employee-facing emails + HR reminders. A
    reminder is a scheduled kind; when it is built it adds `schedule:` to its
    definition and gets this phase's UI for free. Out of scope here.
  - **NOTIFY-4** (planned) — operational reports email, "on a schedule". The
    obvious second consumer: org-scoped, digest, monthly-on-day-N is exactly
    F5's shape. This phase should be built so NOTIFY-4 is a kind file + a
    registry line. Out of scope.
  - **NOTIFY-9** (planned) — retire PaceAlertLog gate + write. Interacts with
    finding P1; this phase narrows the gate to monthly rather than waiting.
  - **NOTIFY-10** — production go-live checklist; DEBT-120 says production mail
    went live 2026-10-23. A schedule change in production mails real managers
    at new times — worth a line in the promotion entry.
  - **DEBT-120** — out of scope (per prompt). Untouched.

---

## 11. Dev migration level

```
env | grep -c DATABASE_URL           → 0
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
                                     → "-- This is an empty migration."  (exit 0)
```

Datasource (`prisma.config.ts` uses `DATABASE_URL_UNPOOLED` when set):
host **`ep-late-water-a6k53nv2`**.us-west-2.aws.neon.tech (dev) ✅. Dev is level
with `schema.prisma` at `797f100`. No other prisma command was run.

---

## 12. Forks for Gary

Leans are Claude's recommendations, not rulings.

- **F1 — which kinds get schedules now.** Lean: `pace.alert` and
  `milestone.reached`. `hr.ack` and `test` stay immediate (no `schedule` mark).
- **F2 — event-email digests.** Lean: defer; file as a row (NOTIFY-13 if Gary
  wants it filed now, else nothing — the prompt says ROW only if needed, and
  nothing here needs it).
- **F3 — zone for an org-wide send.** Lean: store-scoped kinds (pace) use each
  `Store.timezone`; org-scoped kinds (milestones) use a `timeZone` stored **on
  the schedule row**, pre-filled at first save with the org's most common active
  store zone and editable beside the hour. **Not** `Organization.timezone`
  (DEBT-70a / BUG-15 fence it; it has no UI and is LA everywhere). No row → no
  zone needed (legacy UTC hour).
- **F4 — pace frequency.** Lean as prompted: frequency = the send-lock period;
  a behind store gets at most one alert per day / week / month, at the chosen
  hour on an allowed day. Monthly with no row = today exactly.
- **F5 — monthly timing.** Lean: day of month 1–28, chosen hour, weekday boxes
  ignored — **for digest kinds (milestones, future NOTIFY-4)**. See F11 for why
  it doesn't fit pace.
- **F6 — defaults.** Lean: no row reproduces today byte-for-byte — fire at
  **15:00 UTC** (not a local hour: today's local hour already shifts with DST),
  pace monthly with daily evaluation, milestones daily. The fixture proves it
  against `verify-f5-polish` / `verify-ms4b` expectations.
- **F7 — cron shape.** Lean: one new route `/api/cron/scheduled-emails` at
  **`5 * * * *`** (off the two `:00` hourly crons and the `:15` sweep), replacing
  the `pace-alerts` `0 15 * * *` entry. `/api/cron/pace-alerts` stays as a file,
  unregistered, delegating to the same evaluator so a manual curl still works
  and still respects schedules. Non-email crons untouched.
- **F8 — missed hour.** Lean as prompted: first run at or after the chosen
  hour on the same local day sends; no next-day catch-up. Also covers the
  spring-forward gap (T1) and the time-budget overflow (§ 7).
- **F9 — who edits.** Lean: ADMIN only — `settings.access` page gate +
  `requireAdmin()` on the write route.

**Forks the code raised:**

- **F10 — pace hour vs sales-reconcile (11:00 UTC).** Pace is measured through
  yesterday; reconcile absorbs late refunds for the last 3 days. Today's 15:00
  UTC run is always 4 h after reconcile. An Eastern store at 6 AM local
  (10:00 UTC in EDT) would be evaluated **before** reconcile — figures are still
  webhook-fresh, only yesterday's late refunds/edits may be missing. Lean: allow
  any hour; accept the gap; one help line on the card ("Early-morning alerts
  may not include late refunds from yesterday"). Alternative: restrict pace to
  hours whose UTC instant is ≥ 11:30 for every store zone in the org.
- **F11 — "monthly" means different things for pace and digests.** Today pace
  evaluates **every day** and sends on the **first** day a store is behind. F5's
  "monthly = day N only" would turn pace into "check once a month on day N" —
  a different alert. Lean: for `pace.alert`, frequency is only the lock period
  and the evaluation runs on every allowed weekday at the chosen hour (no
  day-of-month field); for digest kinds, monthly = day N (F5). The UI shows a
  day-of-month picker only on digest kinds.
- **F12 — milestone cadence vs ruling 2's 7-day window.** Weekly is safe at the
  edge (one missed weekly slot loses a milestone to `known`); monthly breaks the
  ruling outright (M2). Options: (a) offer milestones **daily and weekly only**;
  (b) amend ruling 2 so the window is "since the previous scheduled send, at
  least 7 days" and freshness follows. Lean: **(a)** now — it keeps ruling 2
  exactly as worded; (b) is Gary's words to change, not ours.
- **F13 — copy under non-default frequencies.** The pinned lines "at most one
  alert per store per month" / "at most one milestone email a day" become false.
  Lean: keep them byte-identical with no row; with a row, render
  "…per store per day/week/month" and "…a week". Gary rules the exact words.
- **F14 — retries outside the chosen hour.** The sweep (`:15` hourly) retries
  `partial` / backed-off intents at any hour (1, 2, 4, 8 h), and can make a
  per-intent live first send for a pace intent the producer left `queued`.
  Lean: allow — a retry completes a send already decided at the chosen hour;
  holding it to the next slot could cost a day. Grouped first sends stay
  producer-only (C3, unchanged).
- **F15 — "Reset to default".** Lean: deletes the `NotificationSchedule` row
  (config, not history; additive-only governs schema, not config rows). If Gary
  prefers, keep the row with a `resetAt` instead.
- **F16 — weekday boxes with "daily" vs "weekly".** Lean: daily + boxes =
  every checked day; weekly + boxes = the first checked day of each ISO week on
  which the slot is due (a missed slot does not roll to the next checked day —
  F8 says same day only). Alternative: weekly takes exactly one weekday (radio,
  not boxes). Lean on the radio for weekly — simpler to read and to test.

---

## 13. Build plan (adjusted — do not start until Gary rules)

1. **Schema + migration** — `NotificationSchedule`, `NotificationScheduleRun`
   (§ 9), via `prisma migrate diff -o prisma/migrations/<ts>_notify_sched/…`
   only. **STOP.** No apply commands; Gary applies to dev from his planning
   chat (R2) and says go. Nothing committed until the fixture runs green
   against the applied schema.
2. **Registry + evaluator + locks.**
   - `define.ts`: optional `schedule` on `KindCommon`; mark `pace.alert`
     (`scope: "store"`, `["daily","weekly","monthly"]`) and `milestone.reached`
     (`scope: "org"`, per F12).
   - `src/lib/notifications/schedule.ts`: pure `due(row|legacy, now, zone,
     lastRunDate)`, `periodKey(frequency, now, zone)`, shared `localHourOf` copy.
   - `runScheduledEmails({ now, organizationId?, sender, mode, budgetMs })`:
     claims `NotificationScheduleRun` before each producer call; stops at the
     budget.
   - `pace-alerts.ts`: dedupeKey suffix from `periodKey`; PaceAlertLog gate only
     for the monthly key (P1); copy per F13.
   - `milestone-alerts.ts`: unchanged logic; called per due org.
   - `/api/cron/scheduled-emails` at `5 * * * *`; remove the `pace-alerts`
     entry from `vercel.json`; `pace-alerts/route.ts` delegates (F7).
   - No schedule rows ⇒ identical behaviour (F6).
3. **Hub UI** — `ScheduleSection` after `RecipientsSection` on the pace and
   milestone cards; `PUT /api/notify/schedule/[kind]` (requireAdmin, Zod, kind
   must carry `schedule`); dynamic card copy; zone picker on org-scoped kinds
   using the `stores/store-actions.tsx` list.
4. **Fixture** `scripts/verify-notify-sched.ts` with injected `now`, own named
   org (`NOTIFY-SCHED …`): defaults unchanged (incl. existing
   `verify-f5-polish`, `verify-ms4b`, `verify-notify6`, `verify-notify12`
   re-run green); chosen hour in store-local time on both sides of the
   2026-11-01 PDT→PST change; spring-forward 2 AM caught at 3 AM; disallowed
   day skipped; repeated runs in one hour → one send; missed hour caught later
   the same local day, not the next; monthly day 1–28 for an org-scoped kind;
   daily/weekly/monthly pace periods; PaceAlertLog gate not blocking a second
   weekly alert; org isolation (org B's schedule never moves org A). Negative
   controls: break `due()`'s hour test / the run marker and watch the matching
   assertions fail.
5. **Commits** (on `staging`, scoped `git add`, never push): work commit, then
   docs commit — ROADMAP row (NOTIFY-13 unless Gary names it otherwise),
   DECISIONS draft (the rulings on F1–F16 in Gary's words), MIGRATIONS entry.
   The docs commit also (a) adds a dated rider to
   `docs/prompts/PRE-PUSH-CHECK.md` where it says to stamp/commit "on `main`"
   (line 39 at `797f100`; superseded by R1 — rider, no delete); (b) records on
   the MS-6 MIGRATIONS entry (`docs/MIGRATIONS.md:1520`) that it was applied
   on staging (`br-square-feather`) at 2026-10-22 04:58:40Z, production not
   separately confirmed. PRE-PUSH-CHECK itself is a separate session.

---

## 14. Triage of findings (per the standing triage rule)

| Finding | Bucket | Where it goes |
|---|---|---|
| P1 — PaceAlertLog gate blocks non-monthly periods | FIX IN BUILD | build step 2 |
| P2 / F13 — pinned "once per month/day" copy | RULING NOW | F13 |
| M1 — hourly evaluator breaks "one milestone email a day" | FIX IN BUILD | run marker, step 2 |
| M2 / F12 — 7-day window vs monthly digest | RULING NOW | F12 |
| T1 — spring-forward gap | FIX IN BUILD | covered by F8; fixture case |
| § 7 — the 15:00 UTC run nears 300 s at ~100 orgs | FIX IN BUILD | time budget + catch-up |
| F10 — pace before sales-reconcile | RULING NOW | F10 |
| F11 — monthly means two things | RULING NOW | F11 |
| F14 — sweep retries at any hour | RULING NOW | F14 |
| Function region / Fluid setting unverified | COMMENT | read at build time if budget matters |

Rows filed: **0.** Counts: FIX IN BUILD 4 · RULING NOW 6 (+ F1–F9, F15, F16) ·
COMMENT 1 · ROW 0.

---

## 15. Commands run (verbatim, all read-only)

- `git rev-parse --abbrev-ref HEAD`, `git status -sb`, `git log --oneline -5`,
  `git log --oneline staging..main`, `git log --oneline main..staging`
- `cat`/`sed`/`grep`/`awk` over `vercel.json`, `src/`, `prisma/schema.prisma`,
  `docs/ROADMAP.yaml`, `docs/`, `scripts/`
- `npx vercel api /v2/teams/team_263mbnLkV4Te2Ca9ssqrV0gl` (plan only; printed
  `plan= pro`); `npx vercel api /v9/projects/…` attempt (no project id in this
  checkout; nothing returned)
- `env | grep -c DATABASE_URL` → 0
- `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
  → empty. **The only prisma command run.**
- No `vercel env pull`, no migrate dev/deploy/reset/execute, no DB writes, no
  commits, no push.
