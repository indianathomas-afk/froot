# TAB-16 — Ask a manager — Phase A audit

Session: 2026-11-12. TIER 3. Prompt of record: `docs/prompts/TAB-16.md`
(untracked). Design: "Tablet checklist — training resources" PDF (7 boards;
this phase is A4, the Ask-a-manager buttons in A2/A3/B, C1, C2). Branch
`staging` at `9f6cc43` (= `origin/staging`). Nothing in `src/` or `prisma/`
was touched. No database was queried; no prisma command was run.

## 0. Preconditions

- **TAB-15 is on staging.** `git log origin/staging`: `d7331ec` (work),
  `abfe736`, `ba72497` (fix), `149f620`, `b774132`, `9f6cc43` (PRE-PUSH-CHECK).
- **TAB-16 is free.** `grep -c "id: TAB-16" docs/ROADMAP.yaml` → 0. The
  TAB-15 row already points here: "Ask a manager (design A4, C1, C2) — TAB-16;
  the three button slots are marked in tablet-howto.tsx" (ROADMAP.yaml ~26882).
- **The three slots exist:** `src/app/(app)/dashboard/tablet-howto.tsx:341`
  (panel, above Mark done), `:383` (B's expanded row, beside Mark done), `:492`
  (A3 player's bottom bar).

## 1. Messages

- **Model:** `TeamMessage`, `prisma/schema.prisma:2462–2511`. `type` is a
  free TEXT column, default `"general"` (`:2471`); no Postgres enum, so a new
  type needs no migration by itself.
- **Types:** `MESSAGE_TYPES` in `src/lib/messages.ts:7–15` — `shift_note,
  shortage, equipment, customer_feedback, staffing, shoutout, general`. It is
  BOTH the composer's allow-list (`POST /api/messages` zod `type:
  z.enum(MESSAGE_TYPES)`, `src/app/api/messages/route.ts:19`) and the GET
  filter's (`route.ts:58`). Display labels/icons: `TYPE_META`,
  `src/app/(app)/messages/messages-client.tsx:103`, iterated with
  `Object.entries` to build desktop's filter (`:331`) and picker (`:973`);
  the tablet picker uses `TABLET_TYPE_ORDER` (`type-picker.tsx`). Unknown
  types already fall back to General at render (`messages-client.tsx:1242`,
  `messages-tablet.tsx:389`).
- **Can a message reference a checklist task today? No.** The columns that
  exist: `sourceChecklistId` → Checklist ("which checklist the author was
  working when they posted", `:2477`, written only by
  `api/checklists/[id]/handoff-messages/route.ts`), `postedToTemplateId`,
  `linkedIngredientId`. There is no task column. `activeHandoffNotesWhere`
  (`src/lib/messages.ts:81`) keys handoff notes on `postedForDate: { not:
  null }`, so a message carrying `sourceChecklistId` with `postedForDate`
  null is NOT read as a handoff note — reusing `sourceChecklistId` for the
  help request's checklist is safe and matches its comment.
- **Who's posting:** `authorUserId` (the login) + `authorStaffId` (the
  "who is posting" roster pick) already exist (`:2467–2468`); `authorName()`
  prefers the staff name (`messages.ts:181`). R4's asker maps onto
  `authorStaffId` with no new column.
- **What a "Help request" type takes:**
  1. A type string `help_request` that is NOT in `MESSAGE_TYPES` — otherwise
     the generic composer (`POST /api/messages`) could post one without a
     task, and desktop's `Object.entries(TYPE_META)` would put it in the
     picker. Plan: a separate display-only list (`FEED_TYPES` =
     `MESSAGE_TYPES` + `help_request`) for the GET filter and rendering, and a
     picker list that excludes it.
  2. A task reference (new column — § 6).
  3. The quick reason (new column) and the email outcome to render "Emailed
     to …" (new column — § 6). The note is the `body` (NOT NULL; an empty
     string when there is no note).
  4. Its own write route — the help request validates task, asker and
     recipients, which `POST /api/messages` does not.

## 2. Email

- **Registry:** `src/lib/notifications/registry.ts:25` — one
  `defineNotification()` per kind under `kinds/`, one line in `KINDS`. Kind
  shape: `src/lib/notifications/define.ts:155–238` (`roleDefault`, `extras`,
  `capability`, `enabled`, `freshnessMinutes`, `resolveRecipients`,
  `exclude`, `hydrate`, `render`).
- **On/off:** per kind. The NOTIFY-4 pattern is a `NotificationKindSettings`
  row (`schema.prisma:1272–1300`: `enabled`, `subject`, `body`,
  `sendToAdmins`, `sendToManagers`, `thresholdPct`); **no row = off**. Loaded
  into every dispatch as `org.kindSettings` (`dispatch.ts` ORG_SELECT /
  `loadOrg`). R7 ("ships switched off") is therefore the default with no
  data step. There is no column for "Team members can add more contacts".
- **"Also send to" (NOTIFY-12):** `NotificationRecipientPick`
  (`schema.prisma:1161–1176`) over the org address book `NotificationContact`
  (`:1132–1150`, archived never deleted). UI: `RecipientsSection`
  (`settings/notifications/recipients-section.tsx:13`) → `AlsoSendTo`
  (`also-send-to.tsx`, its own Save, `PUT /api/notify/recipients/[kind]`).
  Route: ADMIN (`requireAdmin`, `api/notify/recipients/[kind]/route.ts:16`),
  `validatePicks` (`lib/notifications/contacts.ts:108`: kind must have
  `extras: true`, contacts only, ≤ 10 per kind, each active and this org's).
- **How extras reach a send:** `eligibleRecipients` (`dispatch.ts:417`)
  appends EVERY active pick of the kind after the resolver when `extras:
  true`. **Consequence for TAB-16:** the tablet's per-request ticks cannot be
  expressed by picks alone — an unticked default would still be mailed. The
  kind must honour the request's own list (§ 6: `exclude` drops any
  `extra-contact` address the request did not tick; no dispatcher change).
- **Contacts address book:** `ContactsCard` (`contacts-card.tsx`),
  `listContacts` (`contacts.ts:57`), `MAX_ACTIVE_CONTACTS = 100` (`:14`).
- **"Send a test to me":** `TestSendButton` → `POST /api/notify/test`
  (`api/notify/test/route.ts`, ADMIN `:85`); kind `test`
  (`kinds/test.ts`) whose only recipient is the caller's own Clerk email,
  with `?kind=` sample variants (`:94`, milestone sample, doc digest,
  tasks.comm preview). "Send a test help request" fits as one more `?kind=`
  with a fixed, fictional sample, inheriting the test kind's security model.
- **Sample previews:** `sample()` on grouped kinds (`define.ts:235`); the
  per-intent kinds have none; the test route special-cases them.
- **Accordion (NOTIFY-16):** `CollapsibleSections` / `CollapsibleSection`
  (`components/settings/collapsible-section`), page
  `settings/notifications/page.tsx:185`; the order list is `sectionIds`
  (`:173–180`), summaries built at `:140–170`. Current order: contacts, ack,
  pace, milestones, docdue, taskcomm, **recent** (last).
- **How sends are logged:** one `NotificationMessage` row per recipient per
  provider call (`schema.prisma:1067`, `recipientReasons` NOTIFY-12),
  `NotificationDelivery` per (intent, recipient) in live mode,
  `NotificationEvent` from the Resend webhook (`/api/webhooks/resend`) moves
  it to Delivered. "Recent emails" reads them. Every kind gets this for free.
- **An event-triggered email to copy: `hr.ack`**
  (`kinds/hr-ack.ts`, producer `src/lib/hr-ack-notification.ts`:
  `enqueueNotification` then `dispatchNotifications({ trigger: "producer",
  intentIds })`, `:172–182`). It runs inside `after()` and never reports
  back; TAB-16 must dispatch **inline and await** it so the sheet can say
  whether the email went out (R9) — the test button already does exactly
  that.
- **Retry — conflicts with R9.** `MAX_ATTEMPTS = 5`, `BACKOFF_HOURS =
  [1,2,4,8]` (`dispatch.ts:108–109`): a failed live send leaves the intent
  `partial`/`queued` with `nextAttemptAt`, and the hourly sweep retries it for
  ~15 h. R9 says "Nothing retries silently." → **RULING NOW 1.**
- **Sandbox on staging:** `deliveryMode()` (`src/lib/notify.ts:185`) —
  staging is SANDBOX: only `NOTIFY_SANDBOX_ALLOWLIST` addresses get real mail;
  everyone else is a logged dry run (`dispatch.ts:528–533`). Staging test 1
  ("Resend shows Delivered") needs the store's managers' and the ticked
  contact's addresses on the Preview allowlist.
- **Layout:** `renderEmail` (`src/lib/email-template.ts:295`) — heading,
  intro, rows, `sections`, ONE `cta`, footer. C2 needs a second button; plan
  is an additive optional `secondaryCta`.

## 3. Store managers

- **No standalone helper.** Two kinds inline the same query: pace
  (`kinds/pace-alert.ts:86` — `{ role: "MANAGER", storeAssignments: { some:
  { storeId } } }`) and milestones (`kinds/milestone.ts:190`).
- **Correction to the prompt's premise:** `StoreStaffAssignment`
  (`schema.prisma:604`) links a `StaffMember` (roster person) to a store; it
  carries no role. The MANAGER role is on `User.role` (`Role` enum,
  `schema.prisma:1370`), and a login's stores are `StoreUserAssignment`
  (`schema.prisma:454`, `User.storeAssignments`). "Everyone with the Manager
  role at this store" = Users with `role = MANAGER` and a
  `StoreUserAssignment` for the store — pace's shape. Plan: one
  `storeManagers(orgId, storeId)` helper in `src/lib/help-requests.ts`.
- **Do they all have an email?** `User.email` is `String` NOT NULL
  (`schema.prisma:279`), written from Clerk. NOT NULL does not exclude an
  empty string; pace filters `!!u.email` (`pace-alert.ts:92`) and so will
  this. Not measured on any branch. A store can also have NO assigned
  manager — then the sheet shows the managers row as "No managers assigned"
  and it cannot be ticked. Query for Gary to run in the Neon console if he
  wants the numbers (org id to fill in; branch from `neon.branch_id`):

  ```sql
  SELECT current_setting('neon.branch_id', true) AS branch_id,
         s.id, s.name,
         count(u.id) FILTER (WHERE u.role = 'MANAGER') AS managers,
         count(u.id) FILTER (WHERE u.role = 'MANAGER' AND coalesce(trim(u.email), '') = '') AS managers_without_email
  FROM "Store" s
  LEFT JOIN "StoreUserAssignment" a ON a."storeId" = s.id
  LEFT JOIN "User" u ON u.id = a."userId"
  WHERE s."organizationId" = '<organization id>' AND s."isActive"
  GROUP BY s.id, s.name
  ORDER BY s.name;
  ```

## 4. "Who's asking?"

- The tablet's "Who completed this task?" list is `TabletStore.staff`
  (`dashboard/tablet-data.ts:107`, `:119–120`), loaded at `:207–235`:
  `StaffMember` in this org, `status: "ACTIVE"`, assigned to the store,
  `displayName` asc — the same filter as the desktop execution page
  (`store-view/checklist/[id]/page.tsx:58–69`). Server-side rule for a
  submitted name: `src/lib/task-log-staff.ts` (CHK-15). Reused as is.
- Two edges R4 does not settle → **RULING NOW 3:** the desktop/tablet picker
  PREPENDS two generic options, "Team Member" and "Manager" (both saved as no
  name), and it is SKIPPED entirely when the store has no active staff
  (tablet-home.tsx:119 comment; TAB-1b row).

## 5. Permissions

- **Posting:** `POST /api/messages` gates on the session + store scope only
  (`getUserStoreScope`, `route.ts:92–95`): any login with the store in scope —
  STORE (its one store), MANAGER (assigned stores), ADMIN (all), and a STAFF
  login with an assignment. `messages.use` is ALL (`permissions.ts:232`) and
  not deniable; the route never checks it (out-of-scope finding F1). Tablet mode is a
  per-device cookie (`view-mode-server.ts:6`), not a role, so the server
  cannot know the request came from Tablet mode; the new route gates on
  `messages.use` + store scope, and "Tablet mode only" is a UI fact. The
  TAB-4 PIN gate does not cover messages (TAB-4 Q11: "messages are
  unchanged"), so a help request asks for no PIN.
- **Editing /settings/notifications:** ADMIN only, as expected. Page:
  `can(actor, "settings.access")` (`page.tsx:86`), `settings.access:
  ADMIN_ONLY` (`permissions.ts:302`), held out of the override grid. Write
  routes re-check with `requireAdmin()` (recipients route `:16`, test route
  `:85`). A MANAGER is redirected to /dashboard by the page and gets 403 from
  every write route. The new settings route copies that.

## 6. Plan

### Schema — one additive migration

`prisma/migrations/2026111XHHMMSS_tab16_help_requests/` via `npx prisma migrate
diff --from-config-datasource --to-schema prisma/schema.prisma --script -o …`
(MIGRATIONS.md § 3). Session STOPS after generating it (Phase B); Gary applies
to dev; nothing committed before that.

- `TeamMessage.taskId String?` → `Task`, `onDelete: SetNull` (a hard-deleted
  task with no history must not take the message, and a retired task keeps
  it), `@@index([storeId, taskId, createdAt])` for R5's lookup.
- `TeamMessage.helpReason String?` — `still_stuck | broken | supplies`
  (R6), validated in the route.
- `TeamMessage.helpEmail Json?` — the email outcome snapshot written after
  dispatch: `{ state: "off" | "sent" | "partial" | "failed" | "dry-run",
  managers: boolean, managerCount, contacts: string[], intentId }`. Lets every
  Messages surface render "Emailed to Carson managers + 1 contact" without
  ever listing manager addresses (R3) and without joining the notification
  ledger on a feed read.
- `NotificationKindSettings.tabletAddContacts Boolean @default(true)` —
  "Team members can add more contacts" (R3). Only the help kind reads it.
- The checklist is `TeamMessage.sourceChecklistId` (existing; § 1). The
  asker is `authorStaffId` (existing).

No column drops, nothing renamed, no backfill.

### The kind — `help.request` (`src/lib/notifications/kinds/help-request.ts`)

- `roleDefault`: "The managers of the store that asked (everyone with the
  Manager role there)."; `extras: true` (so the NOTIFY-12 picker works and the
  picks are R2's defaults); no capability.
- `enabled(org)`: `org.kindSettings["help.request"]?.enabled === true`.
- `resolveRecipients`: the store's managers (reason role) + the contacts the
  request ticked, re-read and re-checked active at send time
  (reason extra-contact).
- `exclude`: drops any `extra-contact` address the request did not tick — so
  an unticked default pick that the dispatcher appends is not mailed.
- `hydrate` (NOTIFY-4 rider: ids in the payload, text at send time): message,
  asker, store (name, timezone), checklist/template name, task description,
  training (video title, attachment label).
- `render`: R8 subject "Help needed at [Store]: [Task]"; body per C2; time in
  `Store.timezone`; buttons Reply in Messages (`/messages?storeId=`) and Open
  the checklist (`/store-view/checklist/[id]`); footer per prompt step 5 with
  the Settings link.
- `freshnessMinutes`: 60. Retry per RULING NOW 1.

### The send path, end to end

1. Sheet → `POST /api/stores/[id]/help-requests` (new) with `{ checklistId,
   taskId, askerStaffId, reason?, note?, contactIds[] }`.
2. Route, in order: session (401) → `messages.use` (403) → store in scope +
   this org's (403/404) → checklist is this store's and this org's → task is
   on that checklist's template (live, or retired with history on it) → asker
   ACTIVE and assigned to the store (task-log-staff rule) → reason in the
   three, note ≤ 280 → settings row. Emails on: every `contactId` an ACTIVE
   contact of this org, and a subset of the default picks when
   `tabletAddContacts` is off; managers resolved server-side, never sent by
   the client. Any failure = 400, nothing written.
3. R5 inside one transaction with `pg_advisory_xact_lock(hashtext(storeId ||
   ':' || taskId))`: an undeleted `help_request` for (store, task) in the last
   15 minutes → return `{ duplicate: true, first: { createdAt, emailedTo } }`,
   no write, no email. Otherwise create the `TeamMessage`.
4. Emails off → `helpEmail = { state: "off" }`, done. On →
   `enqueueNotification({ kind: "help.request", dedupeKey: messageId,
   entityId: messageId })`, `dispatchNotifications({ trigger: "producer",
   intentIds })` awaited inline, outcome written to `helpEmail`. A failure
   never deletes the message (R9).
5. Response → the sheet closes; the panel/row/player shows "Help sent to …",
   or "Posted in Messages. The email didn't go out." on failure.

### Files

New: `src/lib/help-requests.ts` (reasons, window, `storeManagers`,
validation, tablet view loader), `src/lib/notifications/kinds/help-request.ts`,
`src/app/api/stores/[id]/help-requests/route.ts`,
`src/app/api/notify/help-request/route.ts` (ADMIN PUT: enabled,
tabletAddContacts — upsert NotificationKindSettings),
`src/app/(app)/settings/notifications/help-request-actions.tsx`,
`src/app/(app)/dashboard/tablet-ask-manager.tsx` (A4 sheet),
`scripts/verify-tab16-help.ts` (fixture, dev branch).

Changed: `prisma/schema.prisma`; `registry.ts` (+1 kind); `kinds/test.ts` +
`api/notify/test/route.ts` (`?kind=help.request` fixed sample);
`email-template.ts` (additive `secondaryCta`); `settings/notifications/page.tsx`
(section `help`, "New" badge, summary "On · Store managers + N contacts" /
"Off · Messages only", placed after Tasks and Communication and before Recent
emails); `dashboard/tablet-data.ts` (help settings, managers count, active
contacts, defaults, recent requests per task inside the window);
`tablet-howto.tsx` (the three buttons); `tablet-home.tsx` (sheet state,
`useBusyFlag("tasks:help")` so TAB-5 holds refresh, closed by the TAB-9 idle
like the PIN sheet); `tablet-messages.tsx`, `messages/messages-tablet.tsx`,
`messages/messages-client.tsx` (Help request chip, task chip, "Emailed to …",
read-only); `src/lib/messages.ts` (`FEED_TYPES`, include task + checklist
template, serialize `helpRequest`); `api/messages/route.ts` (GET filter
accepts `help_request`). Docs: ROADMAP row, DECISIONS entry, MIGRATIONS entry.

Desktop changes are limited to the Settings section and the Messages
rendering, as the prompt allows.

## 7. RULING NOW

1. **Retry vs R9.** The dispatcher retries a failed live email for ~15 h
   (`dispatch.ts:108–109`). R9: "Nothing retries silently." Recommend: the
   help kind does not retry — a per-kind `retry: false` that settles a failed
   send as `failed` at once (a few lines in `finalize`; every other kind
   unchanged). Alternative: keep the house retry and have the sheet say "We'll
   keep trying to send the email."
2. **Can the team member untick the managers row, or a default contact?**
   The design draws checkboxes on both; C1 calls managers "Always send to".
   Recommend: managers row shown ticked and locked; default contacts can be
   unticked. Send's "at least one recipient" rule then only bites when the
   store has no manager with an email.
3. **Who's asking, two edges.** (a) Include the generic "Team Member" /
   "Manager" options the tick picker has? Recommend no — names only, so the
   email can say who to follow up with. (b) A store with no active staff:
   recommend a single "Team member" choice so the button still works (the
   email then reads "A team member needs a hand…").
4. **Dry run on staging.** Managers not on the Preview allowlist get a logged
   dry run, not mail. Recommend the sheet and the Messages line say "Emailed
   to …" only for real sends and "Not emailed in this environment" for a dry
   run, so staging never claims an email that did not leave.

## 8. Out of scope, triaged

- **F1 — COMMENT.** `POST /api/messages` never checks `messages.use`
  (`route.ts:79–95`; capability ALL at `permissions.ts:232`). No live
  exposure today: `messages.use` is not in `ENFORCED_CAPABILITIES`
  (`permissions.ts:773`), so nobody can be denied it from the /users grid.
  It becomes a gap the day it is made deniable. The new route checks it
  anyway.
- **F2 — COMMENT.** `POST /api/messages` checks `authorStaffId` against the
  org only (`route.ts:112–118`): a terminated staff member, or one from
  another store, can be named as author. The new route uses the CHK-15 rule.
- **F3 — COMMENT.** The prompt's "StoreStaffAssignment" for managers is the
  roster table; managers come from `StoreUserAssignment` (§ 3). No code
  impact beyond using the right table.

Counts: FIX NOW 0 · RULING NOW 4 · COMMENT 3 · ROW 0.
