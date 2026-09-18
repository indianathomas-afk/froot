TIER 3 session. Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/CAL-1_calendar_reminders.md and execute it. Repo gate first, one command at a time. Stop where it says stop.

# CAL-1 — Calendar: reminders, month view, due banner, module toggle — TIER 3

**Track:** CAL (new)
**Branch:** staging
**Type:** Implementation — schema + capability + cron + UI. TIER 3: audit → plan → STOP → Gary's explicit approval → build. You never push. No `&&` chains — one command at a time. `docs/prompts/` files are never edited after execution — addenda only.
**Created:** 2026-09-17 (planning chat)
**Successor:** CAL-2 (template "Add to Calendar", checklist generation from occurrences, DEBT-61 closure). NOT this session. No riders.

## Repo gate

Run `pwd` — must be `/Users/garythomas/Claude_Projects/Froot/froot` (lowercase `froot`; the capital-F parent is a known trap). Run `git remote -v` — origin must be `indianathomas-afk/froot`. Run `git status` — on `staging`, clean. Read `/Users/garythomas/Claude_Projects/Froot/froot/CLAUDE.md` and `/Users/garythomas/Claude_Projects/Froot/froot/docs/WORKFLOW.md`. Confirm `CAL-1` is a free id in `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml`; if taken, say so and stop. Deviation numbers are read from the highest recorded entry, never assigned here. If the gate fails, stop.

## Why this exists

Each store has recurring work that is not a daily checklist: check the mailbox weekly, clean the Bunn juicer filters monthly, bank deposit weekly, order Redbull weekly. Today that lives in people's heads. CAL-1 adds a `/calendar` page under the Checklists nav group where admins (and managers they grant) schedule reminders that recur, show on a month grid, and surface as a red banner when due — with "N days overdue" escalation and a "You're all caught up" state on completion.

Context you must read before the audit: the DEBT-61 row in ROADMAP.yaml. `Template.frequency` Weekly/Monthly is display-only; its exit condition is frequency-aware generation with a day-of-week / day-of-month nobody collects. The calendar is that control. **CAL-2 closes DEBT-61; CAL-1 does not touch templates, bulk generate, or the day-close cron.** Build the projection helper so CAL-2 can reuse it, and nothing more.

## Rulings (Gary, in chat 2026-09-17)

Draft for `docs/DECISIONS.md`. Gary ratifies in the PRE-PUSH-CHECK session; a committed draft is not a ruling. Write it verbatim as below, headed "DRAFT — pending ratification":

> 2026-09-17 — Calendar (CAL-1). Ruled by Gary in planning chat:
> 1. Two entity types on one calendar: Reminder (standalone, tick to complete) and Event (a template scheduled to run — CAL-2). The calendar takes over generation for non-Daily templates and closes DEBT-61 in CAL-2.
> 2. Calendar items are per-store, with an "all stores" option that fans out per store. Every occurrence belongs to exactly one store.
> 3. One open occurrence per event per store at a time. The next occurrence is not materialised until the current one is completed. Future dates on the grid are projected from the rule, not stored.
> 4. Reminders are never auto-closed as Missed. They stay overdue until someone completes them. Scheduled checklists (CAL-2) follow the CHK-3 lifecycle.
> 5. Anyone who can complete a checklist at a store can complete a reminder at that store. Scheduling is `calendar.manage`: ADMIN baseline, grantable per-user to MANAGER via the PERM-8 grant model.
> 6. Priority is Critical / High / Standard. Critical carries a flag.
> 7. Color is by category, not per item. Fixed list in CAL-1: Ordering, Cleaning & Maintenance, Finance, Store Ops, Other. Each has one color. Priority is a flag, never a color.
> 8. Due date is required, time optional. Overdue begins at store close on the due date (or at the time, if set); with no store hours, end of the store's local day.
> 9. The calendar is a module: an admin toggle on /settings. Off = nav, page, API, banner and cron all inert.

## Phase A — audit (read-only, then STOP)

Report with file:line at HEAD. No edits, no commits.

1. **Permissions.** `src/lib/permissions.ts`: the registry shape, `ENFORCED_CAPABILITIES` (the /users grid), `GRANTABLE_CAPABILITIES` (PERM-8), and the exact capability that gates `POST /api/checklists/[id]/task-log`. That capability is the baseline for completing a reminder (ruling 5). Confirm the `can()` precedence: denied wins, else baseline OR grant.
2. **Module toggles.** How `/settings` stores and enforces feature on/off today (labor, inventory, or whichever exists). Column(s) on `Organization`, the API route, the sidebar read, the page guard. CAL-1 must copy the pattern exactly, not invent one.
3. **Nav.** `src/app/(app)/layout.tsx` and the NAV-1 accordion: how the Checklists group is declared and how a link is gated by capability + module flag.
4. **SELF-1 banner.** The compliance banner component on `/dashboard`: file, how it receives its list and earliest due date, the "single pulse on mount" rule, success surface colors. The calendar banner reuses its shell, not its data.
5. **Store day boundary.** The helper CHK-3's day-close cron uses to decide when a store's day ends (`src/lib/checklist-lifecycle.ts` or wherever). Does `Store` carry a timezone? What happens for the stores with no `StoreHours` rows (most of them, per CHK-3's evidence)? Ruling 8 depends on this. If no reusable helper exists, propose the extraction in Phase B; do not fork the logic.
6. **Attachments.** The `TaskAttachment` write path — the Vercel Blob upload route, size/type limits, authenticated serving (HELP-1b pattern). Event attachments reuse it.
7. **Cron.** `src/app/api/cron/checklist-day-close/route.ts`: `CRON_SECRET` check, `vercel.json` schedule entry, response-body reporting shape. The new cron copies all three.
8. **Daily Tasks page.** Where STORE/STAFF land for checklists (the NAV-1 "Daily Tasks" button target) — the banner mounts there and on `/dashboard`.
9. **Roadmap.** Confirm `CAL-1` free, read DEBT-61 in full, note the highest deviation number.

Classify anything out of scope FIX NOW / RULING NOW / COMMENT / ROW. Then **STOP** and wait for Gary.

## Phase B — plan (then STOP)

Write the plan as an addendum section at the end of this file (append only). It must cover:

### B1 Schema (one additive migration, hand-authored, shown in full)

```
model CalendarEvent {
  id              String   @id @default(cuid())
  organizationId  String
  title           String
  notes           String?
  url             String?
  category        String   // validated against CALENDAR_CATEGORIES, phases.ts-style
  priority        String   @default("Standard") // Critical | High | Standard
  recurrence      String   @default("None")     // None | Daily | Weekly | Biweekly | Monthly
  startDate       DateTime // date-only, store-local calendar date
  dueTime         String?  // "HH:mm", store-local
  endDate         DateTime?
  appliesTo       String   @default("all")      // mirrors Template.appliesTo
  isArchived      Boolean  @default(false)
  createdByUserId String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  // relations: organization, storeAssignments, occurrences, attachment
}
model CalendarEventStoreAssignment  // mirrors TemplateStoreAssignment, @@unique([eventId, storeId])
model CalendarEventAttachment       // mirrors TaskAttachment, one per event
model CalendarOccurrence {
  id                 String    @id @default(cuid())
  organizationId     String
  eventId            String
  storeId            String
  dueDate            DateTime  // date-only
  dueAt              DateTime  // instant overdue begins (ruling 8), frozen at materialisation
  status             String    @default("Open") // Open | Completed
  completedAt        DateTime?
  completedByUserId  String?
  completedByStaffId String?
  notes              String?
  photoUrl           String?
  createdAt          DateTime  @default(now())
  @@unique([eventId, storeId, dueDate])
  @@index([organizationId, storeId, status, dueDate])
}
```
Plus `Organization.calendarEnabled Boolean @default(false)` — or whatever shape A2 says the existing toggles use; match it. `Template` is untouched. No `templateId` on `CalendarEvent` yet — CAL-2 adds it. Precheck: none owed (all new tables); say so.

### B2 Projection helper — `src/lib/calendar.ts`
Pure functions, unit-tested with a fixture like PERM-8's:
- `projectDueDates(event, fromDate, toDate): Date[]` — None → `[startDate]` if in range; Daily; Weekly = same weekday as startDate; Biweekly = every 14 days from startDate; Monthly = same day-of-month, clamped to month end (31st → Feb 28/29). Respects `endDate`.
- `nextDueDate(event, afterDate)` — first projected date strictly after `afterDate`, or `startDate` if none yet.
- `dueAtFor(store, dueDate, dueTime)` — ruling 8, built on the A5 helper.
- `CALENDAR_CATEGORIES` with color tokens, `CALENDAR_PRIORITIES`, `CALENDAR_RECURRENCES`, and a `normalizeCategory()` that rejects unknown values by name (the phases.ts pattern).
CAL-2 will call `projectDueDates` for templates; keep it template-agnostic.

### B3 Cron — `GET /api/cron/calendar-materialize`, hourly
For each org with `calendarEnabled`, each active non-archived event, each applicable store: if no `Open` occurrence exists for (event, store), compute `nextDueDate(event, lastCompletedDueDate ?? day before startDate)`; if that date ≤ today (store-local), create the occurrence with `dueAt` frozen. Read-then-write plus unique-violation catch, as CHK-3 does. Body reports `{ scanned, materialized, skippedOpen, skippedFuture, skippedDisabled }` per org.

### B4 Capabilities
- `calendar.view` — baseline ALL, in `ENFORCED_CAPABILITIES`. Gates nav, page, `GET` routes.
- `calendar.manage` — `ADMIN_ONLY`, in `ENFORCED_CAPABILITIES` and `GRANTABLE_CAPABILITIES` for MANAGER. Gates create/edit/archive routes and the day-click affordance.
- Completing an occurrence: the A1 capability, AND-ed with store scope (actor must be assigned to the occurrence's store, same rule as task-log).
Nav visibility and API access are separate decisions (PERM-2). Every route enforces; the modal is not the gate.

### B5 Routes
- `GET /api/calendar/events?storeId=&from=&to=` → events + projected dates + real occurrences in range
- `POST /api/calendar/events`, `PATCH /api/calendar/events/[id]`, `DELETE` = archive (preserve-and-mark; also deletes that event's `Open` occurrences)
- On PATCH that changes recurrence/startDate/dueTime/endDate/stores: delete `Open` occurrences for the event and let the next cron re-derive. Completed rows untouched.
- `POST /api/calendar/events/[id]/attachment` (reuse A6 path)
- `POST /api/calendar/occurrences/[id]/complete` — notes + optional photo; 409 if already Completed
- `GET /api/calendar/due?storeId=` — banner feed: Open occurrences with `dueDate ≤ today`, earliest `dueAt`
- Settings toggle route per A2 pattern, ADMIN only

### B6 UI
- `/calendar` under the Checklists nav group. Month grid, Sun–Sat, 6 rows, prev / Today / next. Left rail: store picker (ADMIN/MANAGER; STORE/STAFF fixed to their store), category checkboxes with color swatches (local show/hide state), legend for the Critical flag.
- Item chip: category color bar, title, time if set, flag if Critical, strikethrough when Completed, red left edge when overdue.
- Click empty day (calendar.manage) → create popover, Apple-style: **Event | Reminder** tabs, Event tab disabled with "Coming in CAL-2". Fields: title, category, priority, store(s)/all, date, time (optional), repeat, end date, notes, URL, attachment.
- Click item → detail popover: all fields read-only, completion history for that occurrence, **Complete** (with notes + photo) for anyone with the A1 capability at that store, Edit / Archive for calendar.manage.
- shadcn/ui, Tailwind 4, no new dependencies. Popover, not a route change.
- `/settings`: "Calendar" toggle with copy "Scheduled reminders for tasks that aren't daily checklists."

### B7 Banner
On `/dashboard` and the A8 page, store-scoped to the actor's store(s), reusing the SELF-1 shell with error surface colors:
- Lists due + overdue Open occurrences (title, store, category). Each has Complete inline.
- If any are overdue: bold "**N days overdue**" from the earliest `dueAt`; "1 day overdue" singular. Single pulse on mount, overdue state only.
- When the fetched list transitions non-empty → empty within a session: "You're all caught up" on success surface colors with a light check/confetti animation for ~3s, then clear. First load with nothing due renders nothing — no reserved slot.
- Renders nothing when `calendarEnabled` is false.

### B8 Docs
ROADMAP.yaml `CAL-1` row (written at the END from what was actually done), CAL-2 row as `planned` with one paragraph, a prepended-style rider on DEBT-61 naming CAL-2 as the fix path (nothing above it edited), DECISIONS.md draft per Rulings above, DEPLOY_LOG heredoc drafted for Gary (sized to blast radius), this prompt file committed.

**STOP.** Wait for Gary's approval of the plan.

## Phase C — build

Two-commit pattern: work commit, then docs commit citing the work SHA. `npm run build` gates both; lint does not (DEBT-33). Scope `git add` to the files you touched — never `git add -A`. Migration is hand-authored, checked against `npx prisma migrate diff`, and NOT run locally: Gary runs it on dev, then pushes so staging/production take it through `migrate deploy` in the Vercel build. Commit is code landing, not evidence.

Deviations from the approved plan: number them from the highest recorded, record in the ROADMAP row, and if any would move a baseline or widen access, STOP and ask.

## Session report

1. The two SHAs.
2. `git log --oneline @{u}..`
3. The migration SQL in full.
4. The projection fixture results (Monthly clamp, Biweekly, Weekly, endDate cases).
5. **Staging test protocol, unrun** — Gary runs after push, in chat, per the browser-evidence standard (org `org_3G02wO4QlVVSWppi8aqlnSZnsDa`, Clerk `verified-snapper-7`, branch `br-square-feather` visible in every SQL result):
   - Toggle off: `/calendar` absent from nav, direct URL redirects, `GET /api/calendar/events` refuses.
   - Toggle on as Karson (ADMIN): create a Weekly reminder dated today for one store; grid shows it plus projected dates on the next four same-weekdays.
   - Cron curl with `$S` (length 64 verified in the same terminal) → body shows `materialized: 1`; SQL shows one `Open` row with `dueAt` at that store's close, branch column in output.
   - Tommy (MANAGER, per PERM-8 — not STORE): day-click shows nothing; grant `calendar.manage` in Edit User; day-click now opens the popover; API refuses before the grant, accepts after.
   - Complete the occurrence as a STORE account at that store: banner shows due, then "all caught up"; SQL shows `Completed` with `completedByUserId`; second cron run materialises the next weekday and nothing else (`skippedOpen` for events with an open row).
   - Backdate a reminder 3 days via SQL on dev only, reload: banner bold "3 days overdue", pulses once.
6. What CAL-2 needs from this build, stated in three lines.

Then say: "Built and committed. PRE-PUSH-CHECK is next." Do not suggest further work.

---

# ADDENDUM A — Phase A audit result and Gary's rulings R1–R5

**Appended 2026-09-17. Nothing above this line is edited.** Full audit:
`docs/prompts/CAL-1_AUDIT.md`, taken at HEAD `34fad03` on `staging`.

Gate: `pwd` lowercase `froot`; origin `indianathomas-afk/froot`; on `staging`,
clean but for this untracked prompt. **`CAL-1` free** — zero occurrences in
`docs/` outside this file. **Highest recorded deviation: S5-D76**, so CAL-1
numbers from S5-D77.

The audit raised five questions the plan below could not be written without.
Gary ruled all five on 2026-09-17, in chat:

- **R1 — Completing an occurrence mirrors task-log exactly: store-scope only,
  no capability check. `checklists.execute` stays unenforced; CAL-1 does not
  change checklist semantics.**
- **R2 — Dedicated column: `Organization.calendarEnabled Boolean @default(false)`,
  Instagram-shaped. The calendar is part of Checklists, not a billable add-on.
  Do not add it to `activeModules`.**
- **R3 — Add an optional `graceHours` param to `dayCloseInstant`, defaulting to
  `DAY_CLOSE_GRACE_HOURS`. Calendar calls it with 0. The four existing callers
  must be behaviour-identical; show that in the plan.**
- **R4 — Public blob store, same as `TaskAttachment`. Accepted limitation:
  calendar photos are the same sensitivity class as checklist task photos. No
  new store, no new env var.**
- **R5 — Add `/calendar` to `SANCTIONED_ADDITIONS`. This is the ruling the
  fixture asks for. Record it in the fixture comment.**

Two rows filed rather than fixed, and one comment accepted:

- **ROW 1 — `checklists.execute` is registered with zero call sites** (the TPL-1
  pattern: control exists, consumer missing). The PERM track decides.
- **ROW 2 — the `CRON_SECRET` comparison is un-trimmed and non-constant-time in
  every cron route.** CAL-1 copies the existing pattern as-is for consistency;
  one row covers all crons. **Do not fix one route in isolation.**
- **COMMENT — the fourth bespoke nav flag (`requiresCalendar`) is accepted for
  CAL-1.** `requiresModule` is group-level only; a later NAV phase generalises it.

**A correction to the audit, carried here so the plan is built on the right
number.** A5 said `dayCloseInstant` has "four call sites". It has **six**, in
four files: `(app)/stores/page.tsx:53`, `(app)/reports/operations/page.tsx:106`,
`api/cron/checklist-day-close/route.ts:210`, and **twice inside
`checklist-lifecycle.ts` itself** — `rawWindow` at `:341` and
`endClampsAtDayClose` at `:428`. The two internal ones were missed because the
grep that found the others was scoped to call sites outside the module. R3's
"the four existing callers" is answered for all six in B2 below.

---

# ADDENDUM B — Phase B plan

Written against HEAD `34fad03`. Every file:line below was read during Phase A.

## B0 What this plan does NOT touch

`Template`, `TemplateStoreAssignment`, `Checklist`, `Task`, `TaskLog`,
`TaskAttachment`, `api/checklists/*`, `api/cron/checklist-day-close`,
`src/lib/checklist-lifecycle.ts` **except** the one additive parameter R3
authorises. DEBT-61 stays open and CAL-1 does not touch its fix path.
`checklists.execute` gains no call site (R1).

## B1 Schema — one additive migration

`prisma/migrations/<YYYYMMDDHHMMSS>_cal1_calendar/migration.sql`, hand-authored
per CLAUDE.md § Database (`migrate dev` is broken; `db push` is retired),
checked against `npx prisma migrate diff`, **not run locally** — Gary runs it on
dev, then pushes so staging and production take it through `migrate deploy` in
the Vercel build.

**Precheck: none owed.** Four new tables and one new column with a default. No
column is dropped, no column changes type, and no existing row needs a backfill
— `calendarEnabled` defaults `false`, which is the ruling-9 "off" state, so
every existing org lands inert. Nothing in the migration can fail on existing
data.

### Prisma models

```prisma
model CalendarEvent {
  id              String   @id @default(cuid())
  organizationId  String
  title           String
  notes           String?
  url             String?
  // Validated against CALENDAR_CATEGORIES through normalizeCategory() — the
  // phases.ts pattern (src/lib/phases.ts:34). A String column rather than an
  // enum for the same reason Template.frequency is: the list is product copy
  // and a migration to add "Marketing" is not worth a deploy.
  category        String
  priority        String   @default("Standard") // Critical | High | Standard
  recurrence      String   @default("None")     // None | Daily | Weekly | Biweekly | Monthly
  // DATE-ONLY, store-local calendar date. Stored at 00:00:00.000 UTC and NEVER
  // read as an instant — see the note under "Two date columns" below.
  startDate       DateTime @db.Date
  dueTime         String?  // "HH:mm", store-local. Parsed by parseHhMm's twin.
  endDate         DateTime? @db.Date
  appliesTo       String   @default("all")      // mirrors Template.appliesTo
  isArchived      Boolean  @default(false)
  createdByUserId String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  organization     Organization                  @relation(fields: [organizationId], references: [id])
  createdByUser    User?                         @relation(fields: [createdByUserId], references: [id], onDelete: SetNull)
  storeAssignments CalendarEventStoreAssignment[]
  occurrences      CalendarOccurrence[]
  attachment       CalendarEventAttachment?

  @@index([organizationId, isArchived])
}

model CalendarEventStoreAssignment {
  id      String @id @default(cuid())
  eventId String
  storeId String

  event CalendarEvent @relation(fields: [eventId], references: [id], onDelete: Cascade)
  store Store         @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@unique([eventId, storeId])
}

model CalendarEventAttachment {
  id          String   @id @default(cuid())
  eventId     String   @unique
  label       String
  url         String
  contentType String
  sizeBytes   Int
  createdAt   DateTime @default(now())

  event CalendarEvent @relation(fields: [eventId], references: [id], onDelete: Cascade)
}

model CalendarOccurrence {
  id                 String    @id @default(cuid())
  organizationId     String
  eventId            String
  storeId            String
  dueDate            DateTime  @db.Date
  // The instant overdue begins (ruling 8), FROZEN at materialisation.
  dueAt              DateTime
  status             String    @default("Open") // Open | Completed
  completedAt        DateTime?
  completedByUserId  String?
  completedByStaffId String?
  notes              String?
  photoUrl           String?
  createdAt          DateTime  @default(now())

  organization     Organization  @relation(fields: [organizationId], references: [id])
  event            CalendarEvent @relation(fields: [eventId], references: [id], onDelete: Cascade)
  store            Store         @relation(fields: [storeId], references: [id], onDelete: Cascade)
  completedByUser  User?         @relation(fields: [completedByUserId], references: [id], onDelete: SetNull)
  completedByStaff StaffMember?  @relation(fields: [completedByStaffId], references: [id], onDelete: SetNull)

  @@unique([eventId, storeId, dueDate])
  @@index([organizationId, storeId, status, dueDate])
}
```

Plus, on `Organization` (R2):

```prisma
  // CAL-1. The per-org switch for the Calendar. A DEDICATED COLUMN, like
  // instagramEnabled above and deliberately NOT a fifth entry in activeModules
  // (Gary, R2 2026-09-17): activeModules is the BILLABLE ADD-ON list driving the
  // module cards on /settings, and the calendar is part of Checklists, not a
  // separate purchase. Off = nav, page, API, banner and cron all inert.
  calendarEnabled         Boolean   @default(false)
```

### Two date columns, and why they are `@db.Date`

**This is a deviation from the prompt's B1 block, which wrote `DateTime // date-only`
with no attribute, and it is the one place the plan overrides the brief.**
CLAUDE.md § Database Evidence records that every `DateTime` in this schema is
`TIMESTAMP(3)` with no zone and is therefore UTC, and that the UTC/local
confusion "fired THREE TIMES IN ONE DAY". A calendar date is not an instant: the
15th of the month is the 15th in every timezone. `@db.Date` makes the column a
PostgreSQL `DATE`, so it cannot carry a time to be misread, and it matches the
precedent already in this schema — `UsageDaily.date` is `DATE`
(`20260830120000_eng1_engagement_tracking/migration.sql`).

`dueAt` is deliberately NOT a date: it is a real instant, frozen at
materialisation, and it is the only column in these four tables that a timezone
question can be asked of.

**If Gary prefers the literal prompt shape**, `@db.Date` comes off all three
columns and B2's helpers are unchanged — they already take and return
`"YYYY-MM-DD"` strings and convert at the Prisma boundary. Recorded as a
deviation rather than taken silently: **S5-D77**.

### The migration SQL, in full

```sql
-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "calendarEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "url" TEXT,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'Standard',
    "recurrence" TEXT NOT NULL DEFAULT 'None',
    "startDate" DATE NOT NULL,
    "dueTime" TEXT,
    "endDate" DATE,
    "appliesTo" TEXT NOT NULL DEFAULT 'all',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEventStoreAssignment" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,

    CONSTRAINT "CalendarEventStoreAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEventAttachment" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarEventAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarOccurrence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "completedAt" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "completedByStaffId" TEXT,
    "notes" TEXT,
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarEvent_organizationId_isArchived_idx" ON "CalendarEvent"("organizationId", "isArchived");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEventStoreAssignment_eventId_storeId_key" ON "CalendarEventStoreAssignment"("eventId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEventAttachment_eventId_key" ON "CalendarEventAttachment"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarOccurrence_eventId_storeId_dueDate_key" ON "CalendarOccurrence"("eventId", "storeId", "dueDate");

-- CreateIndex
CREATE INDEX "CalendarOccurrence_organizationId_storeId_status_dueDate_idx" ON "CalendarOccurrence"("organizationId", "storeId", "status", "dueDate");

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventStoreAssignment" ADD CONSTRAINT "CalendarEventStoreAssignment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventStoreAssignment" ADD CONSTRAINT "CalendarEventStoreAssignment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventAttachment" ADD CONSTRAINT "CalendarEventAttachment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarOccurrence" ADD CONSTRAINT "CalendarOccurrence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarOccurrence" ADD CONSTRAINT "CalendarOccurrence_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarOccurrence" ADD CONSTRAINT "CalendarOccurrence_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarOccurrence" ADD CONSTRAINT "CalendarOccurrence_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarOccurrence" ADD CONSTRAINT "CalendarOccurrence_completedByStaffId_fkey" FOREIGN KEY ("completedByStaffId") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

**`onDelete` choices, stated because they are decisions.** `organizationId` is
`RESTRICT`, matching `UsageDaily` — an org is never deleted in this product and
a cascade there would be a silent mass delete. Event → assignments/occurrences/
attachment is `CASCADE`: an event's occurrences have no meaning without it, and
archive (not delete) is the normal path anyway. The two completed-by FKs are
`SET NULL` so **deleting a user never erases the fact that the work was done** —
the occurrence keeps `status: Completed` and `completedAt`, and loses only the
attribution. Store is `CASCADE`, matching `TemplateStoreAssignment`.

## B2 Projection helper — `src/lib/calendar.ts`

Pure functions. **No Prisma import**, for the same reason
`checklist-lifecycle.ts` has none: the month grid is a client component and must
be able to import this. No new dependency (there is no `date-fns-tz` in this
repo — audit C3); date-string arithmetic reuses `shiftDateStr` and
`jsDayOfWeek`, and zoned construction reuses `zonedInstant`, all imported from
`checklist-lifecycle.ts` rather than re-implemented.

**Every function takes and returns `"YYYY-MM-DD"` strings, not `Date`s.** The
conversion to and from Prisma happens at the route boundary, in one direction
each. This is what keeps the UTC/local trap out of the projection logic
entirely — there is no instant in it to misread.

```ts
export const CALENDAR_CATEGORIES = [
  { id: "ordering",   label: "Ordering",                 token: "--color-cal-ordering" },
  { id: "cleaning",   label: "Cleaning & Maintenance",   token: "--color-cal-cleaning" },
  { id: "finance",    label: "Finance",                  token: "--color-cal-finance" },
  { id: "storeops",   label: "Store Ops",                token: "--color-cal-storeops" },
  { id: "other",      label: "Other",                    token: "--color-cal-other" },
] as const
export const CALENDAR_PRIORITIES = ["Critical", "High", "Standard"] as const
export const CALENDAR_RECURRENCES = ["None", "Daily", "Weekly", "Biweekly", "Monthly"] as const

/** Rejects an unknown value BY NAME — the phases.ts pattern (phases.ts:34). */
export function normalizeCategory(value: string | null | undefined): string | null

export type ProjectableEvent = {
  recurrence: string
  startDate: string   // "YYYY-MM-DD"
  endDate: string | null
}

export function projectDueDates(event: ProjectableEvent, fromDate: string, toDate: string): string[]
export function nextDueDate(event: ProjectableEvent, afterDate: string | null): string | null
export function dueAtFor(store: { timezone: string }, hoursRow: HoursRow | null, dueDate: string, dueTime: string | null): Date
```

**`projectDueDates` rules**, each with a fixture case in B2's test:
- `None` → `[startDate]` if it falls inside `[fromDate, toDate]`, else `[]`.
- `Daily` → every date in the range at or after `startDate`.
- `Weekly` → the same weekday as `startDate` (`jsDayOfWeek`), every 7 days.
- `Biweekly` → every 14 days counted **from `startDate`**, never from the range
  start — so the phase is a property of the event, not of what you are looking at.
- `Monthly` → the same day-of-month, **clamped to the month end**: a 31st event
  falls on Feb 28 (29 in a leap year), Apr 30, and back to the 31st in May. The
  clamp never advances into the next month.
- Every rule is additionally bounded by `endDate` when set (inclusive), and
  nothing before `startDate` is ever emitted.

**`nextDueDate(event, afterDate)`** returns the first projected date **strictly
after** `afterDate`, or `startDate` when `afterDate` is null (nothing has been
completed yet). Implemented by projecting a bounded window forward from
`afterDate` and taking the head — never an unbounded loop.

**`dueAtFor`** is ruling 8, and it is where R3 lands:

```ts
// Ruling 8: overdue begins at store close on the due date, or at dueTime when
// one is set, or at the END of the store's local day when the store has no
// hours. graceHours: 0 — a reminder is due when the store shuts, not three
// hours later (Gary, R3).
export function dueAtFor(store, hoursRow, dueDate, dueTime) {
  if (dueTime) return zonedInstant(dueDate, dueTime, store.timezone)   // explicit time wins
  return dayCloseInstant(hoursRow, dueDate, store.timezone, 0).at
}
```

### R3 — the `graceHours` parameter, and why all six callers are unchanged

`checklist-lifecycle.ts:245` becomes:

```ts
export function dayCloseInstant(
  hoursRow: HoursRow | null,
  dateStr: string,
  timeZone: string,
  graceHours: number = DAY_CLOSE_GRACE_HOURS
): DayClose
```

with `DAY_CLOSE_GRACE_HOURS` replaced by `graceHours` at the three places inside
the function that add it (the `midnight()` closure and the two `hours` returns).

**Behaviour-identity, demonstrated per call site.** A defaulted trailing
parameter is invisible to a three-argument call, so the proof is simply that
every existing call passes exactly three arguments — and that no caller reaches
`dayCloseInstant` through a function reference, `.apply`, or a spread, where an
extra argument could arrive by accident. All six, read at HEAD `34fad03`:

| # | Call site | Args | Reads | Effect of the change |
|---|---|---|---|---|
| 1 | `(app)/stores/page.tsx:53` | 3 | `.source` only | none — `source` is not a function of grace at all |
| 2 | `(app)/reports/operations/page.tsx:106` | 3 | `.source` only | none — same |
| 3 | `api/cron/checklist-day-close/route.ts:210` | 3 | `.at`, `.source` | none — defaults to `DAY_CLOSE_GRACE_HOURS`, same value as today |
| 4 | `checklist-lifecycle.ts:341` (`rawWindow`) | 3 | `.at.getTime()` | none — same |
| 5 | `checklist-lifecycle.ts:428` (`endClampsAtDayClose`) | 3 | `.at.getTime()` | none — same |
| 6 | `src/lib/calendar.ts` (new) | **4**, `0` | `.at` | the only caller that differs, by design |

Sites 1 and 2 are immune twice over. Sites 3, 4 and 5 get the identical `Date`
they get today, because the default **is** the constant they were using. The
verification is `npm run build` (a changed arity is a typecheck failure across
the whole graph) plus a re-run of `scripts/verify-store-hours-engine.ts`, which
is the existing fixture over this function and must stay green **unchanged** —
a fixture edit here would be the tell that behaviour moved.

**A note goes at the parameter**, saying it is a PER-CALLER grace and explicitly
NOT the per-org grace the constant's own comment (`:24-37`) rules would need a
column plus a Settings control shipped together. The two are different things
and the next reader must not read one as the other.

### The fixture — `scripts/verify-cal1-projection.ts`

PERM-8-shaped: pure, no database, `npx tsx`. A DB-backed fixture would be green
on an empty table and prove nothing (`verify-perm8-grants.ts:8-11`). Cases, each
asserting an exact array:

- Monthly clamp: start `2026-01-31` → Jan 31, **Feb 28**, Mar 31, Apr 30, May 31.
- Monthly clamp, leap: start `2028-01-31` → **Feb 29**.
- Monthly no-clamp: start `2026-01-15` → the 15th every month, never shifted.
- Biweekly: start `2026-09-17` → 17th, Oct 1, 15, 29 — and the same set when
  queried from a window starting `2026-10-05`, proving the phase is anchored to
  `startDate` rather than to the range.
- Weekly: start `2026-09-17` (a Thursday) → four consecutive Thursdays, and
  `jsDayOfWeek` equal on all of them.
- `endDate`: the same Weekly event with `endDate: 2026-10-01` → exactly two
  dates; a date **on** `endDate` is included, one after is not.
- `None`: in range → one date; out of range → `[]`.
- Before `startDate`: a window entirely before it → `[]` for every recurrence.
- `nextDueDate`: null `afterDate` → `startDate`; `afterDate` **equal to** a
  projected date → the next one, never the same one (the strictly-after rule,
  which is what stops the cron re-materialising a date it just completed).
- `normalizeCategory`: each of the five ids round-trips; `"Ordering "` trims;
  `"marketing"` returns null.

## B3 Cron — `GET /api/cron/calendar-materialize`, hourly

New file `src/app/api/cron/calendar-materialize/route.ts`; new `vercel.json`
entry `{"path": "/api/cron/calendar-materialize", "schedule": "0 * * * *"}` —
the sixth. Copies the day-close cron's three mechanics verbatim per the brief:
the `CRON_SECRET` check (`:139-145`, **including its un-trimmed, non-constant-
time comparison — ROW 2, copied deliberately, not overlooked; a comment at the
site says so and names the row**), `export const maxDuration = 300`, and the
proof-surface response body.

**Algorithm.** For each org with `calendarEnabled` — for each active,
non-archived event — for each applicable store (`appliesTo === "all"` → every
active store in the org, else the event's `storeAssignments`):

1. If an `Open` occurrence exists for `(event, store)` → `skippedOpen++`,
   continue. **Ruling 3: the next occurrence is not materialised until the
   current one is completed.**
2. Otherwise find the latest `Completed` occurrence's `dueDate` for that
   `(event, store)`. `afterDate = thatDate ?? null`.
3. `next = nextDueDate(event, afterDate)`. With `afterDate` null this returns
   `startDate`, which is the prompt's "day before startDate" expressed without
   inventing a date.
4. If `next` is null (past `endDate`) → `skippedFuture++`, continue.
5. If `next > todayStr` (store-local, via `localDateStr(now, store.timezone)`)
   → `skippedFuture++`, continue.
6. Else create the occurrence with `dueAt = dueAtFor(store, hoursRow, next,
   event.dueTime)` **frozen at write time**, inside a read-then-write with a
   `P2002` catch on the `@@unique([eventId, storeId, dueDate])` index —
   `isUniqueViolation(e)` copied from the day-close cron (`:54`) → `raced++`.

**Response body**, per-org and summed to the top level — because the day-close
cron learned that "a counter that only exists inside `results[].days[]` is a
counter nobody reads":

```
{ ok, now, stores, events, scanned, materialized, skippedOpen, skippedFuture,
  skippedDisabled, raced, errors, results: [ { organizationId, ...same keys } ] }
```

`skippedDisabled` counts orgs filtered out by `calendarEnabled` — so a run that
materialised nothing because the module is off and a run that materialised
nothing because everything was already open **do not read identically in the
Runtime Logs**. One `console.log` line carries every counter.

**Org scope — the deliberate divergence from the day-close cron** (audit C1).
That job takes no org scope on the stated principle that inventing an org filter
"would just be a way to miss a tenant" (`:39-43`). This one iterates orgs
because `calendarEnabled` is a **per-org product predicate**, not a scoping
habit: an org with the calendar off must have nothing written for it. A comment
at the site names the divergence and cites that line, so the next reader does
not file it as a copy error. Every write is still keyed to the store's own
`organizationId`, exactly as the day-close job does it.

**Idempotence by construction, not by a marker table** — the `Open`-exists check
plus the unique index. A second run in the same hour reports `skippedOpen` and
writes nothing.

## B4 Capabilities

Two new entries in `src/lib/permissions.ts`:

- **`calendar.view`** — baseline `ALL`. In `ENFORCED_CAPABILITIES` under area
  `"Calendar"`, label "The calendar", `removes: "The Calendar page and the
  reminder banner."` Gates the nav item, the `/calendar` page, and every `GET`.
- **`calendar.manage`** — baseline `ADMIN_ONLY`. In `ENFORCED_CAPABILITIES`
  **and** in `GRANTABLE_CAPABILITIES` as `{ "calendar.manage": ["MANAGER"] }`.
  Gates create / edit / archive / attachment routes and the day-click
  affordance.

**`GRANTABLE_CAPABILITIES` gains its second entry ever**, and the file says in
two places that an append there is a security change with the same weight as a
baseline change. Ruling 5 is that ruling: *"Scheduling is `calendar.manage`:
ADMIN baseline, grantable per-user to MANAGER via the PERM-8 grant model."*
The entry names `MANAGER` explicitly — there is no "all roles" spelling and none
is introduced. A comment at the entry cites ruling 5 by date.

**Completing an occurrence asks NO capability (R1).** It mirrors
`api/checklists/[id]/task-log/route.ts` exactly: `auth()` 401 → org 404 →
occurrence scoped by `organizationId` 404 → `getUserStoreScope()` →
`isAdmin || storeIds.includes(occurrence.storeId)` 403. A comment at the site
records that this is R1 and that `checklists.execute` is deliberately not asked,
so the next reader does not "fix" it into existence.

`scripts/verify-perm8-grants.ts` gains cases for the new entry: `calendar.manage`
is false for MANAGER by baseline, true for MANAGER with the grant, **false for
STORE and STAFF even when granted** (the `isGrantable` half), and false for a
granted-and-denied MANAGER (denial beats grant).

Every route enforces independently. The modal is not the gate (PERM-2), and nav
visibility is a separate decision from API access.

## B5 Routes

All under `src/app/api/calendar/`. Every one: `auth()` → org → **module gate** →
capability → Zod → org-scoped query, in that order. The module gate is a shared
`requireCalendar()` helper in `src/lib/calendar-access.ts` returning a 404
(not 403) when `calendarEnabled` is false — **off means the API does not exist**,
per ruling 9, which is the `laborModuleAvailable` 404 shape at
`api/labor/toggle/route.ts:21-23`.

| Route | Gate | Notes |
|---|---|---|
| `GET /api/calendar/events?storeId=&from=&to=` | `calendar.view` + store scope | returns events, **projected** dates from `projectDueDates`, and real occurrences in range |
| `POST /api/calendar/events` | `calendar.manage` | 201 with the record |
| `PATCH /api/calendar/events/[id]` | `calendar.manage` | see the re-derive rule below |
| `DELETE /api/calendar/events/[id]` | `calendar.manage` | **archive**: `isArchived = true` (preserve-and-mark) **and** delete that event's `Open` occurrences. Completed rows untouched. Returns `{ success: true }` |
| `POST /api/calendar/events/[id]/attachment` | `calendar.manage` | R4: public store, `TaskAttachment` pattern |
| `POST /api/calendar/occurrences/[id]/complete` | **R1 — store scope only** | notes + optional photo; **409 if already Completed** |
| `GET /api/calendar/due?storeId=` | `calendar.view` + store scope | banner feed |
| `POST /api/calendar/toggle` | ADMIN (`requireAdmin()`) | flips `Organization.calendarEnabled` |

**The PATCH re-derive rule.** When a PATCH changes `recurrence`, `startDate`,
`dueTime`, `endDate`, or the store set: **delete that event's `Open` occurrences
and let the next cron re-derive them.** Completed rows are never touched — they
are a record of work that happened and no edit to the schedule can unmake it.
A title-or-notes-only edit deletes nothing. The predicate is computed from the
parsed body against the loaded row, not from which keys the client sent.

**Attachment route (R4).** Mirrors `api/upload/task-attachment/route.ts`:
`ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png"]`,
`MAX_BYTES = 10 MB` (413), replace-in-place via `del(old.url)` then row delete
then `put()`, `access: "public"` on the default store, key
`calendar-attachments/${org.id}/${eventId}/${Date.now()}.${ext}`. **No new env
var, no new store** — R4. A comment records the accepted limitation in Gary's
terms: calendar attachments are the same sensitivity class as checklist task
photos, and the HELP-1b private-store pattern is deliberately not used.

**The completion photo** follows CHK-7 (`api/upload/checklist-photo/route.ts`)
rather than the attachment route: **4 MB** (under Vercel's ~4.5 MB request cap,
so our message is the one the user reads), image types only plus the HEIC/HEIF
passthrough, and it **re-applies the completion route's own gates before storing
the blob** — "an upload route cannot lean on the write that follows it, by then
the blob is already stored". It writes nothing to the database; the
`complete` route writes `photoUrl`, so the fact has one author.

## B6 UI

**`/calendar`**, under the Checklists nav group, after `/checklists`:

```ts
{ href: "/calendar", label: "Calendar", icon: CalendarDays, capability: "calendar.view", requiresCalendar: true },
```

**On ONE line** — `scripts/verify-nav1-url-sets.ts` parses `sidebar.tsx` with a
line-oriented regex and a split literal makes the fixture blind to it silently,
with a green run (audit C4).

Sidebar changes: a `requiresCalendar?: boolean` on `NavItem` (the fourth bespoke
flag, **accepted by Gary for CAL-1**, with a comment noting that `requiresModule`
is group-level only and a later NAV phase generalises it); a `calendarEnabled`
prop threaded from `(app)/layout.tsx` beside `instagramEnabled`; and one clause
in `isVisible()` — `(!item.requiresCalendar || calendarEnabled)`.

**R5 — the fixture.** `SANCTIONED_ADDITIONS` gains:

```ts
"/calendar": "CAL-1 — calendar under Checklists, Gary's R5 ruling 2026-09-17",
```

and `Item` / `parse()` / `visible()` each gain `requiresCalendar`, so the
fixture models the real gate rather than asserting something untrue. `BASELINE_REV`
is **not** touched. The fixture's comment block gains a line recording that R5 is
the ruling it asks for.

**The page.** Month grid, Sun–Sat, 6 rows, prev / Today / next. Left rail: store
picker (ADMIN/MANAGER; STORE/STAFF fixed to their store), category checkboxes
with colour swatches (local show/hide state only, not persisted), and a legend
for the Critical flag. shadcn `Popover` already exists
(`src/components/ui/popover.tsx`); Tailwind 4; **no new dependencies**.

**Item chip:** category colour bar, title, time if set, flag if Critical,
strikethrough when Completed, red left edge when overdue. **Colour is by category
and priority is a flag, never a colour** (ruling 7) — the five category tokens
are added to `globals.css` beside the existing status colours.

**Click an empty day** (with `calendar.manage`) → create popover, Apple-style:
**Event | Reminder** tabs, **Event tab disabled with "Coming in CAL-2"**. Fields:
title, category, priority, store(s)/all, date, time (optional), repeat, end
date, notes, URL, attachment.

**Click an item** → detail popover: all fields read-only, completion history for
that occurrence, **Complete** (notes + photo) for anyone passing the R1 store-scope
test, Edit / Archive for `calendar.manage`. Popover, not a route change.
Destructive actions (Archive) get a confirmation `AlertDialog`, per § Design System.
Skeleton loaders, never spinners. Tap targets ≥ 44px — the floor completes
reminders on a phone.

**`/settings`** gains a "Calendar" card in the Integrations tab with the copy
*"Scheduled reminders for tasks that aren't daily checklists."* and a
`CalendarModuleToggle` client island copied from `settings/labor-actions.tsx`
(optimistic, reverts on failure, `router.refresh()` so the sidebar follows).
**No availability-gate env var** — R2 makes this a plain per-org column like
Instagram, and CAL-1 ships to production behind the org toggle, off by default.

## B7 Banner

New `src/components/calendar-due-banner.tsx` — **in `src/components/`, not under
`(app)/dashboard/`**. It mounts on `/dashboard` and on `/checklists` (the A8
"Daily Tasks" target), and a client component imported across route folders from
a sibling page directory is the exact shape of the HR-11j finding CLAUDE.md
§ "Verifying a guard covers every path" records.

Reuses the SELF-1 shell — `mb-6 flex items-center gap-3 rounded-lg border px-5
py-4`, icon, semibold line, `text-xs opacity-90` subline — and `fetchCard`'s
contract (12s timeout, console breadcrumb, null on failure). It does **not**
reuse SELF-1's data path: `getActiveStaffSelf` is an HR gate resolving a *staff
member*, and a calendar occurrence is scoped to a *store*.

- Feeds from `GET /api/calendar/due?storeId=`, store-scoped to the actor's
  store(s). Lists due + overdue `Open` occurrences: title, store, category, each
  with **Complete** inline.
- **Overdue**: destructive surface, and a bold **"N days overdue"** computed from
  the earliest `dueAt`. **"1 day overdue" singular.** Rendered in the store's
  zone via `formatInstant`, never the server's (DEBT-70b).
- **Single pulse on mount, overdue state only.** SELF-1 has no pulse and
  `globals.css` has no pulse keyframe — so CAL-1 **adds a one-shot keyframe** to
  `globals.css`, which is exactly where `compliance-banner.tsx:28-30` says it
  belongs ("a one-shot keyframe, not a looping utility class trimmed to one
  run"). It must not loop: WCAG 2.2.2, and the reason the SELF-1 blink was ruled
  out.
- **"You're all caught up"** on the success surface (`--color-success-bg` /
  `-border` / `-text`, already in `globals.css:36-38`) with a light check
  animation for ~3s, then clear — **only** on a non-empty → empty transition
  within a session, tracked in component state. **First load with nothing due
  renders nothing.** No reserved slot — SELF-1 made that call explicitly and a
  second banner reserving one would reintroduce the gap it rejected.
- **Renders nothing when `calendarEnabled` is false** — and the route 404s
  independently, so the flag is not the only thing holding it.

## B8 Docs

- **`docs/ROADMAP.yaml`** — the `CAL-1` row, written **at the END from what was
  actually done**, with `status`, `commits` (both SHAs), `blockers` (the
  migration is unrun on every branch until Gary runs it on dev and pushes) and
  `deferred`. Per WORKFLOW.md § Session completion rules, and **not** drafted in
  advance.
- **`CAL-2` row as `planned`**, one paragraph: template "Add to Calendar",
  checklist generation from occurrences, DEBT-61 closure.
- **A prepended-style rider on DEBT-61** naming CAL-2 as the fix path. **Nothing
  above it is edited** — the row's own convention, followed three times already.
- **Two new rows** — ROW 1 (`checklists.execute` registered with zero call
  sites) and ROW 2 (un-trimmed, non-constant-time `CRON_SECRET` compare across
  **all** cron routes; CAL-1 copies the pattern as-is and fixes nothing in
  isolation).
- **`docs/DECISIONS.md`** — the nine rulings, verbatim from the Rulings section
  above, headed **"DRAFT — pending ratification"**. Gary ratifies in
  PRE-PUSH-CHECK; a committed draft is not a ruling.
- **`docs/MIGRATIONS.md`** — the new migration appended to the ledger.
- **`docs/DEPLOY_LOG.md`** — a heredoc **drafted for Gary**, sized to blast
  radius, composed per CLAUDE.md § DEPLOY_LOG edits (short chunks, `wc -l` after
  each, `grep -c "^## "` to prove nothing was clobbered). Not written by this
  session.
- **This prompt file** committed, with these addenda.

## B9 Build order and the two commits

1. `permissions.ts` (both capabilities, both lists) → `verify-perm8-grants.ts` cases.
2. `checklist-lifecycle.ts` — the one defaulted parameter → `verify-store-hours-engine.ts` **unchanged and green**.
3. `src/lib/calendar.ts` + `src/lib/calendar-access.ts` → `verify-cal1-projection.ts`.
4. `prisma/schema.prisma` + the migration folder + `npx prisma generate`. **The migration is not run locally.**
5. Routes, then cron + `vercel.json`.
6. Sidebar + nav fixture + `/calendar` page + popovers + `/settings` card.
7. Banner + `globals.css` tokens and the one-shot keyframe.

**Work commit** — gate is `npx eslint <files this commit touches> && npm run
build > /tmp/build.log 2>&1 && git commit -F - <<'EOF'`, one chain, **no pipes**
(a pipeline returns the last command's status and would commit on a red build).
Lint is not a gate (DEBT-33); scoped eslint is. `git add` is scoped to the files
touched — **never `git add -A`**.

**Docs commit second, citing the work SHA.** Per memory and CLAUDE.md: the
recorded work commit is **never amended** (that invalidates the SHA the row
cites); amending the recorder is safe. Both messages go through a heredoc —
backticks in `-m` substitute.

**Claude never pushes.** The report ends with the explicit unpushed-commits line.

## B10 Deviations from this plan

Numbered from **S5-D77** (S5-D76 is the highest recorded). **S5-D77 is already
taken** by the `@db.Date` choice in B1. Anything further is recorded in the
ROADMAP row — and if a deviation would **move a baseline or widen access**, the
session STOPS and asks rather than recording it.

---

**STOP.** Phase B ends here. Awaiting Gary's approval of this plan before any
file is touched.
