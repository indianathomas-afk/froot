# NOTIFY-DOC-DIGEST AUDIT — overdue & due-soon document digest (NOTIFY-14)

Written 2026-10-27 by a **TIER 3** session (declared by the prompt,
`docs/prompts/NOTIFY-DOC-DIGEST.md`), Phase 1, read-only. No code was changed,
no database was touched and **no `prisma` command of any kind was run**. The
only write is this file.

**Repo gate, as found:** `/Users/garythomas/Claude_Projects/Froot/froot`, branch
`staging`; `staging`, `main`, `origin/staging` and `origin/main` all at
`6cefd63` (after a `git fetch`). The only thing in `git status` was the untracked
session prompt `docs/prompts/NOTIFY-DOC-DIGEST.md` itself, so the tree was
treated as clean.

**THE ID IS NOTIFY-14.** `docs/ROADMAP.yaml` holds NOTIFY-1 … NOTIFY-13 (last
row `:21923`, NOTIFY-13). `NOTIFY-14` through `NOTIFY-19` appear nowhere in
`docs/`, `src/` or `scripts/`. NOTIFY-13a/13b are riders on NOTIFY-13 (prompt
files, no rows of their own). **The NOTIFY-3 row (`:20919`, employee-facing,
deferred 2026-09-20) is not this phase.** Its scope and status are untouched.
The one-line cross-reference the prompt asks for goes into NOTIFY-3's notes in
the Phase 2 docs commit, not now.

Rows read: DOC-8 (`:7050`), NOTIFY-12 (`:21783`), NOTIFY-13 (`:21923`),
NOTIFY-2c (`:20775`), F-5b (`:4168`), NOTIFY-3 (`:20919`) and DEBT-106
(`:33119`).

**Short answer: buildable with ONE additive column and no new table.** The
digest can be read entirely off DOC-8's engine through the same function that
`/hr/compliance` calls. It rides the NOTIFY-6 pipeline, so the send log, the
`AuditLog` row, sandbox handling and dry runs come for free. NOTIFY-13's
scheduler takes a new kind without schema changes. **The org on/off toggle is
the only schema change** (F4). Two of the draft rulings need a code change to
mean what they say (§ 10 (c)).

---

## 1. Due-state source — the email cannot disagree with `/hr/compliance`

**`/hr/compliance` is one call.** `src/app/(app)/hr/compliance/page.tsx:41-43`:

```ts
const { isAdmin, storeIds } = await getUserStoreScope()
getOrgComplianceRollup(org.id, { storeIds: isAdmin ? null : storeIds })
```

`getOrgComplianceRollup` (`src/lib/hr-compliance.ts:930`) returns `staff:
StaffComplianceDetail[]` (`:198`). Each detail carries `items: ComplianceItem[]`.
Each document item (`ComplianceDocItem`, `:61-110`) carries `status`,
`recordMissing`, `dueDate` (member-local `YYYY-MM-DD`) and `daysUntilDue`.

**The digest calls the same function with the same `storeIds` argument per
recipient.** That is the whole guarantee: there is no second query to drift.
Every exclusion in draft ruling 7, plus the no-N rule in ruling 2, is already
enforced inside the engine, so the digest adds no filter of its own except
"has a due date and is in the window":

| Rule | Where it is already enforced |
|---|---|
| Terminated staff out | `getOrgComplianceRollup` fetches `status: "ACTIVE"` (`:942-954`) |
| `recordMissing` never overdue | `due = … completion.recordMissing ? null : documentDueState(…)` (`:587-597`), so `dueDate` is null |
| Complete items have no due date | same line, `baseStatus === "complete"` → `due = null` |
| No N set → no due date | `documentDueState` returns null when `signWithinDays` or `signWithinDaysSetAt` is null (`:740-752`) |
| Overdue = past the member-local due day | `overdue: daysUntilDue < 0` (`:767`), `status = "overdue"` (`:603`) |
| Archived documents out | `complianceDocumentWhere` / `isActive` (`:1150`, comment at `:330`) |
| MANAGER sees only staff assigned to their stores; corporate staff never | the scoped fetch `isCorporate: false, storeAssignments: { some: { storeId: { in } } }` (`:956-958`) |

**The digest's filter is therefore one predicate over items:** `kind ===
"document" && dueDate !== null && daysUntilDue <= 3`. Overdue items have
`daysUntilDue < 0`; "due soon" items are `0 … 3` (F7).

**Training items are skipped by the `kind` test** (draft ruling 8). Training
due dates carry instants and their own overdue rule (`:660-672`), which is part
of why a training section is a separate row.

**Wording:** `documentDueLabel()` (`src/lib/hr-due-wording.ts:17-24`) is pure,
with no server imports, and it takes exactly `{ dueDate, daysUntilDue }`. It
produces "Was due Nov 2" / "Due today" / "Due tomorrow" / "Due in N days". The
digest calls it per line and invents no wording of its own.

**Store grouping:** the rollup assigns each person to exactly one group through
`rollupStoreGroupId` (`:1165-1171`). That is the primary store, or, for a
manager whose staffer's primary store is outside their scope, the first
in-scope store. The digest uses the same function, so a person appears once,
under the same store as on `/hr/compliance`. Corporate staff are skipped by
By Store (`:992`) but kept in the ADMIN totals and employee table (F6).

**Cost:** `computeStaffComplianceDetails` is a fixed set of batched queries,
never per staff (`:210`). One call per distinct scope is a few rollups per org
per week.

## 2. Scheduler — NOTIFY-13

- **Storage:** `NotificationSchedule` (`prisma/schema.prisma:1127`), one row per
  `(organizationId, kind)`. **`kind` is a `String`**, as is
  `NotificationScheduleRun.kind` (`:1164-1173`; `scopeKey` is a storeId or
  `"org"`). The write route `PUT/DELETE /api/notify/schedule/[kind]` accepts any
  kind whose registry entry has a `schedule` (`route.ts:16`), validated by
  `scheduleProblem()` (`src/lib/notifications/schedule.ts:93-112`), which is the
  same check the runner uses.
- **What fires when:** `runScheduledEmails()` (`src/lib/scheduled-emails.ts:76`),
  called hourly by `/api/cron/scheduled-emails` at `"5 * * * *"`
  (`vercel.json`). For each unit it calls `slotDue(spec, row, now, zone)`
  (`schedule.ts:143`). That opens the slot once the local hour reaches
  `sendHour` on an allowed local day, for the rest of that local day. Then
  `claimScheduleSlot()` (`:178`) inserts the run marker (insert-as-lock), and
  then the producer runs. A 240 s budget defers the rest of the run
  (`scheduled-emails.ts:248`).
- **Store-local vs org time:** `scope: "store"` evaluates in `Store.timezone`
  (pace). `scope: "org"` evaluates in the row's own `timeZone` (milestones, F3),
  pre-filled with the org's most common active store zone and then frozen
  (`schedule-settings.ts:30-39`). **The digest is org-scoped**: one email per
  recipient across stores, like milestones.
- **A new kind needs no schema. It is code in three places:** (1) a
  `defineNotification()` with a `schedule` in `src/lib/notifications/kinds/`
  plus one line in `KINDS` (`registry.ts:23`); (2) **a third leg in
  `runScheduledEmails`**, because the runner is not generic: it hard-codes the
  pace and milestone legs (`:88-90`, `:92-93`, `:105-225`); (3) the schedule
  route's HR gate, which today names `milestone.reached` specifically
  (`route.ts:16-17`).
- **THE CATCH, which affects draft ruling 5.** With **no schedule row** the
  evaluator runs the kind's `legacyUtcHour` path: the slot opens at a UTC hour,
  every day (`schedule.ts:144-151`, `define.ts:107-112`). That models "what
  pace did before NOTIFY-13". It **cannot express "weekly, Monday, 8 AM
  Pacific"**. So "default weekly Monday 8:00 AM Pacific" is either a code
  change to the evaluator (a per-kind default row, F2) or a row written at
  first enable. Lean F2.
- **TIER consequence:** the scheduler adds no schema; the toggle does (§ 3). The
  phase stays TIER 3 regardless (a new email type, cron behaviour, a new
  capability).

## 3. Toggle

Existing per-type switches are **columns on `Organization`**, all
`@default(false)`: `paceAlertsEnabled` (`schema.prisma:83`, F-5b) and
`milestoneAlertsEnabled` (`:113`, MS-4b). The milestone switch is written by
`/api/milestone-alerts/settings`. The kind's `enabled(org)` reads the column
off `NotificationOrg`, a `Pick<Organization, …>` (`define.ts:11-33`) loaded by
the dispatcher's `ORG_SELECT` (`dispatch.ts:378`). The runner also reads the
column first so a disabled org burns no run marker (`scheduled-emails.ts:167-178`).

There is no settings-row pattern for a per-type switch. `NotificationSchedule`
holds schedules, not on/off, and using "a row exists" as the switch would make
"Reset to default" (which deletes the row, F15) switch the email off.

**Lean: a column**, `Organization.docDigestEnabled Boolean @default(false)` (F4).
**That is the migration.** It is additive: every existing org lands on `false`,
so promotion sends nothing (the F-5b argument, unchanged).

## 4. Recipients

- **The pace query** (`src/lib/notifications/kinds/pace-alert.ts:80-102`):
  `User` in the org where `role = ADMIN` OR (`role = MANAGER` AND a
  `storeAssignments` row for the store), selecting `role`,
  `deniedCapabilities` and `grantedCapabilities`. The milestone kind is the same
  shape across a member's stores. **A MANAGER's store scope there is
  `StoreUserAssignment`, which is exactly what `getUserStoreScope()` hands
  `/hr/compliance` (`src/lib/auth.ts:223-226`).** So "the stores a manager is
  assigned to" means the same thing in both places.
- **The `can()` post-filter (NOTIFY-2c):** applied by the dispatcher, not the
  kind (`dispatch.ts:424-437`), for every recipient carrying `user`, against
  `def.capability`. A denied user is dropped; nobody can be added (the key is
  absent from `GRANTABLE_CAPABILITIES`, `permissions.ts:584`). New key per the
  `notify.<email>.receive` convention (`:146-164`): baseline `MANAGE` (`:505`,
  `:511`), plus one `ENFORCED_CAPABILITIES` entry in the "Email notifications"
  area (`:1005-1017`). No grid or route change (NOTIFY-2c's one-line property).
- **NOTIFY-12 contacts:** for a kind with `extras: true` the dispatcher appends
  the org's active "Also send to" picks after the role default
  (`dispatch.ts:416-418`). Each runs through the same `can()` and `exclude`,
  and each carries the reason `extra-contact`. **User picks are refused**
  (`USER_PICKS_ENABLED = false`, `contacts.ts:21`) until DEBT-106 closes.
- **DEBT-106 affects this digest exactly as it affects pace.** A departed ADMIN's
  `User` row keeps `role = ADMIN` (`organizationMembership.deleted` deletes only
  store assignments), so the ADMIN arm matches them indefinitely, and **this
  digest would mail them org-wide staff names and document gaps every week.** A
  departed MANAGER drops out (no assignment rows). **Not fixed here**; named in
  the report, and the row gets a cross-ref. An admin can untick the departed
  person in Edit User, but such people appear on no Froot screen (DEBT-106's
  title), so in practice nobody will.

### The delivery-model problem, and the lean (F1)

Pace and milestones are about **one store or one employee**. Every recipient
gets the same email, so the kind renders once per recipient from one payload.
**The digest differs per recipient**: an ADMIN's covers the org, each MANAGER's
covers their stores. `render(payload, org, recipient)` receives the recipient
as a **bare address string** (`define.ts:168`), with no role and no reasons.

**Lean F1:** one intent per org per period (`dedupeKey "{orgId}:{periodKey}"`).
Its payload carries the org-wide snapshot (rows tagged by group) plus a
**scope map built by the producer**: `address → "all" | storeIds[]` for every
role recipient, and `"all"` for every active contact pick. `exclude()` drops any
address **not in the map** (fail closed), so a manager added between producer
and a retry can never default to the org-wide version. It also drops any
address whose filtered digest is **empty** (draft ruling 4), logging
`[doc-digest] skip org=… to=… reason=empty`. `render()` filters by the map.
Everything else (mode, sandbox, one message per recipient, the `sent` lock, the
logs) stays the dispatcher's.

Rejected: one intent per recipient. With `extras: true` the dispatcher would
append every contact to every manager's intent and mail each contact every
manager's digest. With `extras: false` the hub's "Also send to" picker (which
keys off `def.extras`) would not apply.

## 5. Sample send

**There is one.** `POST /api/notify/test?kind=<kind>` (`src/app/api/notify/test/route.ts:43-66`):
ADMIN only (`requireAdmin`, `:57`), no body, recipient = the caller's Clerk
primary email (`:78`). It is rendered through the `test` kind, so it inherits
`sandboxBypass` (reaches the caller even with an empty allowlist) and 15-minute
freshness (`kinds/test.ts:47-63`). It writes a normal message, so it shows on
Recent emails. The hub button is `<TestSendButton kind=… label="Send a sample
to me" />` (`page.tsx:310`).

**It does not do what the staging test plan asks.** `sample()` exists only on
`GroupedKindDef` (`define.ts:186`), and its contract is **"Fixed, fictional
payloads … Must never name a real person."** The prompt's plan wants (a) a
sample that shows **"Test - Handbook Regression" for Tommy**, which is real
data, and (b) **a manager-scoped sample**, while the route is ADMIN-only and
always the caller's own (org-wide) scope.

**Lean F9:** for this kind only, the test route builds a **real-data preview**
with the same builder the cron uses: org-wide for the calling ADMIN, or, with
`?asUser=<userId>` naming a MANAGER **in the caller's org**, that manager's
store scope. **The recipient is still only the caller.** `asUser` chooses whose
view to render, never who receives it. An ADMIN already sees the whole org on
`/hr/compliance`, so this exposes nothing new. The subject keeps the `Test — `
prefix. An empty preview sends nothing and the button says so. This bends the
route's stated rule ("the query names only WHAT to render"), so it is Gary's
call.

## 6. Hub UI

`/settings/notifications` (`page.tsx`, gated `settings.access`, ADMIN-only,
`:73`) renders, in order: the test button, Contacts, Signed-acknowledgment
(HR-gated), Behind-pace alerts, Milestone emails (HR-gated, `:268-329`), Recent
emails (`:332`). **The new card goes after Milestone emails and before Recent
emails**, with the milestone card's two gates (`:80-88`, `:113`): no card where
`hrModuleAvailable(org.clerkOrgId)` is false, and a disabled one-line
explanation where HR is off for the org.

Contents, built from existing components:
1. **Toggle row**: icon, "Overdue & due-soon documents", one-sentence description
   whose cadence words follow the saved schedule (the `milestoneCardText` /
   NOTIFY-13a pattern: one string, not a JSX join), Enabled / Disabled, and a
   switch. New `DocDigestToggle` in `pace-alerts-actions.tsx` beside
   `MilestoneAlertsToggle`, plus a small ADMIN `PUT` route.
2. **`<RecipientsSection kind="hr.doc.digest" … pickedIds={picks[…]} />`**: role
   default "Every admin (all stores); each manager for their assigned stores",
   the Users link, and "Also send to" (F8).
3. **`<ScheduleSection view={…} />`**: weekly/daily, hour, day. The "no row" text
   must read as the F2 default, not "15:00 UTC".
4. **"Send a preview to me"** (F9), plus a manager picker if F9's `asUser` is ruled in.

Recent emails needs nothing: it labels from the registry (`notification-log.ts:62`).

## 7. Timezones

- **The DB is UTC** (`TIMESTAMP(3)` everywhere, CLAUDE.md § Database Evidence).
  The engine never compares a raw timestamp to a date. `documentDueState()`
  converts every start instant with `localDateStr(at, tz)` in the **member's
  display zone** (`displayTimeZone(member, orgZone)`, `hr-compliance.ts:440`),
  takes `today = localDateStr(now, tz)` (`:441`), and returns `daysUntilDue =
  daysBetween(today, dueDate)`: whole calendar days in that zone.
- **So "due within 3 days" is counted in calendar days on the member's own
  calendar, not 72 hours.** At send time `now` is the cron instant. A member's
  `daysUntilDue` is the same number `/hr/compliance` would show at that instant.
- **Send time vs member date:** the default send is 08:00 America/Los_Angeles
  (`DEFAULT_TIME_ZONE`, `src/lib/hr.ts:259`), which is 11:00 Eastern and 05:00
  Hawaii, so every US member is on the same calendar Monday when it fires.
- **The schedule's own zone** follows NOTIFY-13 F3: the default row's zone is
  `DEFAULT_TIME_ZONE` (Pacific, per the draft). A saved row pre-fills with the
  most common active store zone, then freezes.
- **Printed dates** come from `documentDueLabel` → `formatCivilDate`, which
  prints the computed member-local day with no further zone shift
  (`hr-due-wording.ts:10-14`).

## 8. Records

**Draft ruling 9 is satisfied by the pipeline, with no new code.** Every message
the dispatcher writes also writes the parallel `AuditLog` row through
`recordEmailAttempt()` (`dispatch.ts:1003-1016` → `notification-log.ts:82-122`):
`email.sent` / `email.failed` / `email.dryrun`, with `kind`, `provider` (stamped
centrally, `:121`) and recipient. The durable record is `NotificationMessage`;
the `AuditLog` copy is the "one release" parallel write that NOTIFY-9 plans to
stop. `NotificationKind` in `notification-log.ts:60` is a narrow type union that
milestones already bypass by cast; the build adds the new key to it.

## 9. Things noticed, not this phase's

- **DEBT-106** (§ 4): the departed admin gets this digest. COMMENT on the row.
- **PERMISSIONS_INVENTORY §5 drift (DEBT-111)**: a new `notify.*` key widens it.
  The build adds the key to the inventory in the same commit.
- **Migration name.** The prompt names it `<timestamp>_notify3_doc_digest`. This
  phase is NOTIFY-14, and "notify3" repeats the NOTIFY-3 naming collision
  already recorded in `2026-10-18_NOTIFY-3_AUDIT.md`. RULING NOW (F17).

---

## 10. (a) Forks needing a ruling, each with a lean

| # | Fork | Lean |
|---|---|---|
| **F1** | Delivery model | **One intent per org per period, payload = org snapshot plus a producer-built address→scope map; `exclude` drops unknown and empty; `render` filters** (§ 4) |
| **F2** | Default schedule with no row | **Add an optional per-kind `defaultRow` to `KindSchedule`; `slotDue` uses it instead of `legacyUtcHour`. Digest default = weekly, Monday, 08:00, America/Los_Angeles.** Code only. Alternative: write a row at first enable (then "Reset to default" deletes the default) |
| **F3** | What the schedule editor offers | **Daily or weekly, hours 5 AM–8 PM (pace's F10 range), weekly = one day (F16)**; no monthly |
| **F4** | Toggle storage | **`Organization.docDigestEnabled Boolean @default(false)`, the one migration.** Default OFF; nothing sends until Gary flips it |
| **F5** | Capability key and grid row | **`notify.docdue.receive`, baseline ADMIN + MANAGER, deniable, never grantable; grid label "Overdue & due-soon document digest"** |
| **F6** | Corporate and unassigned staff | **ADMINs and contacts get them, under "Corporate" and "Unassigned" groups after the stores; MANAGERs never** (the engine's scoped fetch already drops corporate staff) |
| **F7** | The "due soon" window | **`daysUntilDue` 0–3 inclusive: today, tomorrow, in 2 days, in 3 days** |
| **F8** | "Also send to" contacts | **Allowed, and they get the org-wide version** (draft 1). An address that is both a manager and a picked contact gets the org-wide version. **A contact whose address is a store login is dropped with the warning**, as NOTIFY-12 ruled for pace alerts |
| **F9** | Sample send | **Real-data preview through `POST /api/notify/test?kind=hr.doc.digest`, recipient still only the caller; optional `&asUser=<managerUserId>` renders that manager's view; empty → no email, button says so** (§ 5) |
| **F10** | HR gating | **Digest exists only where `hrModuleAvailable(clerkOrgId)` and HR is active for the org**, checked in the runner leg, `enabled()`, the schedule route and the card |
| **F11** | Repeats within a period | **Send lock `"{orgId}:{periodKey}"`** (weekly `2026-W44`, daily `2026-11-02`): one digest per org per period. A hand-fired cron the same week does not resend; next week is a fresh snapshot (draft 6). Freshness 12 h for retries |
| **F12** | Kind key and send-log label | **`hr.doc.digest`, "Document due-date digest"** |
| **F13** | Ordering | **Stores A–Z, then Unassigned, then Corporate; people A–Z by display name; within a person, overdue first (most overdue first), then due soon (soonest first)** |
| **F14** | Subject line | **"{org}: {X} overdue, {Y} due soon — documents to sign"**, counts for that recipient's scope |
| **F15** | Which document statuses count | **Any open item with a due date: not started, in progress, new version to sign; overdue overrides all three, as DOC-8 F4 ruled.** recordMissing is already out |
| **F16** | Body copy | **One headline line, per store a heading, per person their name then lines "{Document} — {label}". Button "Open compliance" → `/hr/compliance`. Footer says the cadence and that an admin can turn it off per person. Plain text mirrors it** |
| **F17** | Migration name | **`<timestamp>_notify14_doc_digest`**, not `notify3_…` (§ 9) |

## 10. (b) Build plan

**Schema (F4):** one column, `Organization.docDigestEnabled Boolean @default(false)`.
Generated with `npx prisma migrate diff --from-config-datasource --to-schema
prisma/schema.prisma --script -o prisma/migrations/<ts>_notify14_doc_digest/migration.sql`.
**The session STOPS there.** Gary applies it to dev. A read-only check on dev
that prints `current_setting('neon.branch_id', true)` must show the column
before anything continues.

**Files:**
- `prisma/schema.prisma`: the column.
- `src/lib/notifications/define.ts`: `NotificationOrg` gains `docDigestEnabled`;
  `KindSchedule` gains optional `defaultRow` (F2).
- `src/lib/notifications/schedule.ts`: `slotDue` uses `spec.defaultRow` when
  there is no usable row and one is defined; the pace and milestone paths are
  byte-unchanged.
- `src/lib/notifications/dispatch.ts`: `ORG_SELECT` gains the column.
- `src/lib/hr-doc-digest.ts` (new): pure `buildDocDigest(rollup) → groups`, the
  F7 window, F13 order and F6 groups, plus `docDigestForScope()`, which calls
  `getOrgComplianceRollup(orgId, { storeIds })` (§ 1).
- `src/lib/doc-digest-alerts.ts` (new): the producer. Org gates (F10, F4) →
  role recipients → per-scope rollups → address→scope map, including contact
  picks (F8) → skip with a log line if every scope is empty → enqueue
  (`dedupeKey` F11) → inline dispatch, as `milestone-alerts.ts:234-245` does.
- `src/lib/notifications/kinds/doc-digest.ts` (new): the kind (F1, F5, F12,
  F14, F16), `renderEmail()` with a plain-text version, and `exclude` (F1, F8
  store-login drop).
- `src/lib/notifications/registry.ts`: one line. `src/lib/notification-log.ts`:
  the union member.
- `src/lib/scheduled-emails.ts`: a third leg, an org-scoped copy of the
  milestone leg, with its counters in the result and the log line.
- `src/lib/permissions.ts`: the key in the union, `GRANTS` (`MANAGE`) and
  `ENFORCED_CAPABILITIES`. `docs/PERMISSIONS_INVENTORY.md`: the key.
- `src/app/api/notify/test/route.ts` + `kinds/test.ts`: the F9 preview path.
- `src/app/api/notify/schedule/[kind]/route.ts`: the HR gate for the new kind.
- `src/app/api/doc-digest/settings/route.ts` (new, ADMIN `PUT {enabled}`), the
  `/api/milestone-alerts/settings` shape.
- `src/app/(app)/settings/notifications/page.tsx`, `pace-alerts-actions.tsx`,
  `test-send-button.tsx` (the `asUser` option if F9 is ruled in): the card (§ 6).

**Fixture `scripts/verify-notify14-doc-digest.ts`, on dev, against its own
named org (`NOTIFY-14 Org`, `NOTIFY-14 Staff …`):** empty digest → no intent
and the skip line; ADMIN sees every store, MANAGER only theirs and no corporate
staff; denied user (`notify.docdue.receive`) gets nothing; address not in the
scope map is excluded (late-added manager); contact gets the org-wide version;
store-login contact dropped; terminated staff out; `recordMissing` out;
no-N document out; day 3 in and day 4 out; overdue sorted first; every label
equals `documentDueLabel(item)`; one `NotificationMessage` and one `AuditLog`
row per recipient attempt; toggle off → zero intents and zero run markers; HR
off → same; `slotDue` with no row opens Monday 08:00 Pacific, not 15:00 UTC,
and pace/milestone no-row decisions are unchanged; same week, second run → no
resend. **Negative controls**: drop the window predicate; make `exclude` always
false; ignore the toggle. Each must fail its own checks. **Regression on dev:**
`verify-notify-sched`, `verify-notify12`, `verify-notify6`, `verify-notify5`,
`verify-ms4b`, `verify-f5-polish`, `verify-doc8-due-dates`.

**Gates:** `npm run build` green; scoped `npx eslint` on the changed files.

## 10. (c) Where the draft rulings need more than they say

1. **Draft 5, "default weekly Monday 8:00 AM Pacific", is not what NOTIFY-13
   does with no row.** No row means the kind's `legacyUtcHour`, every day
   (§ 2). Holding the draft needs F2's code change, or a row written at enable.
2. **Draft 3/9 and the staging test plan vs the sample contract.** The existing
   "Send a sample to me" is fictional by contract and ADMIN-scoped by
   construction. "Shows Test - Handbook Regression for Tommy" and "a
   manager-scoped sample" need F9's real-data preview, which bends the test
   route's own rule.
3. **Draft 1, "NOTIFY-12 contacts get the org-wide version"**, collides with
   NOTIFY-12's standing ruling that store-login contacts drop from pace alerts.
   This email names staff and their gaps across stores, so F8 drops store-login
   contacts here too. Gary should say so in his own words.
4. **Draft 9** holds as written, but the `AuditLog` row is the parallel write
   NOTIFY-9 plans to stop. After NOTIFY-9, "Recent emails" still shows the send
   (from `NotificationMessage`); the `AuditLog` copy goes. Noting so it is not
   read later as a regression.
5. **Draft 7, "exclude terminated staff and recordMissing"**: both are already
   excluded inside the engine (§ 1). The digest adds no filter for them. The
   fixture checks them anyway.
6. **The staging test expectation for Tommy** depends on data the prompt does
   not pin. DOC-8's row says "Test - Handbook Regression" is at N = 1, "to
   check on 2026-10-28" for the overdue state. The org is named in neither the
   prompt nor the DOC-8 row ("Browser, org not recorded"). The staging check
   must name the org id (§ Browser Evidence) and confirm Tommy is ACTIVE and
   unsigned on the current version before reading the email.
