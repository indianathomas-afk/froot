# NOTIFY-6 AUDIT — one notification pipeline: intent ledger, dispatcher, registry, per-recipient sends, retry

TIER 3. Phase 1 (read-only audit) of
`docs/prompts/2026-10-18_NOTIFY-6_pipeline.md`. Written 2026-10-18.
Nothing under `src/`, `scripts/` or `prisma/` was touched. The only write is
this file.

**Prisma commands run, verbatim:** one.
`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
(the level check in C9). It reads and changes nothing. No other prisma command
was run.

---

## Repo gate

Run one command at a time, each result read before the next:

| Command | Result |
|---|---|
| `pwd` | `/Users/garythomas/Claude_Projects/Froot/froot` ✓ |
| `git fetch origin` | (no output) ✓ |
| `git status` | On branch `staging`, **up to date with `origin/staging`**, working tree clean ✓ |
| `git log --oneline -5` | `eae2aad` NOTIFY-6 session prompt · `67ec619` NOTIFY-6..9 rows · `29a32c9` NOTIFY-5 staging evidence · `1037b89` · `e27b4b0` |

Not ahead of origin: Gary has pushed everything, including this prompt's own
commit. HEAD is `eae2aad`, the commit that adds the prompt.

---

## The prompt has four things wrong. Read these first.

The prompt asks for this ("If something in it is wrong by the time it runs,
say so in the audit rather than working around it"). Two need a ruling
(**R1**, **R2**). Two are fixed in the plan without one (**W3**, **W4**).

**R1 — The staging checklist contradicts the design.** The design says, in
bold: *"Dry-run and sandbox never change an intent's state and never write a
`sent` delivery."* Fixture item 2 says the same. But the staging checklist
says: *"signing a test document with only Gary's address in `hrAckRecipients`
sends one email and writes one intent `sent` on `preview/staging`."* Staging is
`sandbox` (`NOTIFY_EMAIL_PROVIDER=resend`, `VERCEL_ENV=preview`). Under the
design that intent stays **`queued`**. Both cannot be true. **Lean: the design
wins.** It is stated twice, and it is NOTIFY-5's guarantee. The staging
evidence for that step then becomes: one `NotificationMessage` with
`mode = sandbox`, `status = sent`, `to` = Gary; **zero**
`NotificationDelivery` rows; the intent `queued` (it expires after 7 days).
The build writes the corrected checklist into the final report.

**R2 — The hourly sweep collides with a ratified NOTIFY-5 choice.** NOTIFY-5
choice 4, ratified by Gary on 2026-10-18: *"Sandbox pace sends are not
deduplicated. Every hand-fire on staging re-sends to the allow-listed
addresses."* Under NOTIFY-6 a sandbox send leaves the intent `queued`, by the
design. The sweep retries `queued` intents every hour. So without a rule, the
sweep would email Gary **every hour**: up to 24 times per behind store per day
for pace, and up to 168 times per signing for hr.ack (7-day window). **Lean:
the sweep never makes a sandbox send.** For a sandbox recipient that already
has a sandbox `NotificationMessage` for this intent, the sweep skips them.
Dispatches started by a producer (a hand-fired pace cron, a signing, the test
button) behave exactly as choice 4 says and re-send. This keeps the ratified
choice as worded and removes the hourly repeat. The other option is (b):
deduplicate sandbox sends everywhere, per (intent, recipient). That is
simpler, but a hand-fired pace cron would then stop re-sending, and that
reverses choice 4. If Gary wants (b), it needs his words.

**W3 — "test: freshness immediate" would expire every test before it is
sent.** Freshness is check 1 of dispatch. A window of zero is already passed
when the inline dispatch runs, milliseconds after the enqueue. **Fix in the
plan:** windows are counted in minutes. `test` gets **15 minutes**. The
inline dispatch sends it. If a test intent is still `queued` when the sweep
next runs (dry-run, sandbox, or a failed live send that the button already
reported), it is past 15 minutes, so it is expired and never retried. An admin
does not get a surprise test email an hour later.

**W4 — Existing `PaceAlertLog` rows would cause a second alert in the deploy
month.** On the day NOTIFY-6 deploys, `NotificationIntent` is empty. A store
that was already alerted this month under the old code has a `PaceAlertLog`
row and no intent. The producer would enqueue a fresh `queued` intent, and
dispatch would email the same managers a second time. Then the parallel
`PaceAlertLog` write would hit its unique constraint. **Fix in the plan:** the
producer keeps today's `PaceAlertLog` check (`pace-alerts.ts:88`) as a gate. A
row for (store, month) means "already alerted this month": nothing is
enqueued, and the result reason is unchanged. This also keeps honouring locks
burned before NOTIFY-5, as `NOTIFY-3_AUDIT § 6` step 15 expects.
**Consequence for NOTIFY-9:** when the `PaceAlertLog` write stops, this gate
must switch to the intent state in the same change. The build adds that to the
NOTIFY-9 row's notes.

One reading of the prompt, stated so it is not silent: *"Dry-run writes at
most one `NotificationMessage` per intent"* sits next to *"One message per
recipient, never a shared `to:`"*, and `NotificationMessage.to` is one
address. I read the dry-run rule as **at most one dry-run message per
(intent, recipient)**. The "once per intent, not once per daily run" property
the prompt names still holds: a store behind all month writes its dry-run
rows once.

---

## C1. Has anything changed since the prompt's commit?

**No.** The prompt's commit `eae2aad` is HEAD. Every file in "Read first"
item 4 was re-read at HEAD, and every line the prompt points at is still where
it says. The NOTIFY-5 code it builds on is `07e9253`. Points that matter for
the build:

- `notify.ts:185-205`: `deliveryMode()`, `sandboxAllowlist()`,
  `sandboxAllows()`. `getEmailSender()` is at `:207-226` and still fails
  closed: no fallback to console, and it throws on a missing key. Kept
  unchanged.
- `pace-alerts.ts:166-192`: the mode branch sits **before** the lock. The
  dry-run once-per-store-month check is the AuditLog query at `:179-191`.
  LOCK → SEND → RELEASE is at `:331-406`.
- `hr-ack-notification.ts:66-80`: `scheduleAckNotification` wraps `after()`
  in a try, and wraps the body in a second try. `:115-118`: the empty-list
  skip writes no row (F3).
- `notify/test/route.ts:54`: the recipient comes from
  `getClerkPrimaryEmail(userId)`. There is no request body.
- `notification-log.ts:252-263`: the "unknown" derivation (no `provider`)
  and "logged only" (provider not `resend`), both rulings.
- `webhooks/resend/route.ts:94-111`: raw-body Svix verification. 200 on no
  match (`:128-131`), idempotent on (resendId, action) (`:137-139`).
- `recent-emails.tsx` is a **server** component. Its
  `STATUS_STYLE: Record<EmailLogStatus, …>` typechecks the status union.
- `vercel.json`: **7 crons**, two of them hourly at `0 * * * *`
  (`checklist-day-close`, `calendar-materialize`).
- `prisma/schema.prisma`: `PaceAlertLog` (`:883`, `@@unique([storeId, month])`)
  and `AuditLog` (`:865`, one index, `[organizationId, entityType, createdAt]`)
  are unchanged. The schema already has 12 Postgres `enum`s; see choice 1.

---

## C2. Every caller, by name (`src/` and `scripts/`, every route group)

I searched by each name. `src/generated/roadmap.ts` is excluded: it is
generated from ROADMAP prose and holds no code. Comment-only mentions are
counted separately.

| Name | Production call sites | Script call sites | Disposition |
|---|---|---|---|
| `getEmailSender()` | **3**: `api/cron/pace-alerts/route.ts:30`, `lib/hr-ack-notification.ts:222`, `api/notify/test/route.ts:126` | `verify-notify5.ts` 4 (`:170, 173, 175, 178`; `:336` passes it as a sender) | **Migrated.** All three move behind `resolveTransport()` in the dispatcher (plan row 5). That function calls `getEmailSender()` itself, so fail-closed is untouched. The pace cron still resolves the transport **before** its loop, so a bad key still fails the run with zero rows. The script calls test `notify.ts` and are **left** unchanged. |
| `recordEmailAttempt` | **9**: `pace-alerts.ts:268, 293, 304, 373, 386`; `notify/test/route.ts:116, 128, 141`; `hr-ack-notification.ts:299` (through `recordOutcome`, itself called 4×: `:184, 252, 266, 275`) | `verify-f5-polish.ts:330` | **Migrated.** All 9 calls leave the three callers. **One** call site remains: inside the dispatcher's record step, writing one AuditLog row per `NotificationMessage` (the parallel write, choice 6). The fixture's direct call is **left**: it tests the function, which is unchanged. |
| `processPaceAlertForStore` | **1**: cron `route.ts:94` | `verify-f5-polish.ts` **9** (`:227, 381, 384, 440, 454, 488, 528, 552, 638`); `verify-notify5.ts` **8** (`:259, 275, 284, 293, 299, 318, 334, 518`) | **Kept as a wrapper, same signature** (choice 10): evaluate → enqueue → dispatch that one intent, with the given `sender` and `mode` as the transport. The cron and all 17 fixture calls keep their entry point. What changes underneath is listed in C3 and in the fixture section. |
| `sendAckNotification` | **1**: `scheduleAckNotification` (`hr-ack-notification.ts:70`), which discards the outcome | `verify-notify5.ts` **7** (`:395, 405, 417, 434, 446, 464, 479`) | **Kept as a wrapper, same signature and outcome type**: load → build payload → enqueue → dispatch inline → map the result to `AckNotificationOutcome`. It still never throws. |
| `scheduleAckNotification` | **1**: `lib/hr-signed-pdf.ts:803` in `ensureSignedRecord` (its route callers: `api/hr/documents/[id]/acknowledgments`, `…/signed-record`, `…/checkpoints/[checkpointId]/unretire`) | none | **Unchanged** signature and contract. The two page mentions (`(app)/hr/acknowledge/…`, `(my)/my/documents/…`) and `components/hr/signing-unavailable.tsx` are comments only. |
| `findAttemptByResendId` | **1**: `webhooks/resend/route.ts:127` | `verify-f5-polish.ts:339`, `verify-notify5.ts:512` | **Left, as the fallback.** The webhook asks `NotificationMessage.providerMessageId` first and calls this only on a miss (pre-pipeline sends). |
| `deliveryEventExists` / `recordDeliveryEvent` | **1** each, the webhook (`:137`, `:141`) | `verify-f5-polish.ts:347, 361` | **Left.** Still used for the parallel AuditLog event row, and for the fallback path. |
| `listRecentEmails` | **1**: `settings/notifications/page.tsx:73` | `verify-f5-polish.ts:363`, `verify-notify5.ts:504` | **Re-implemented, same name and same `EmailLogEntry` shape.** Reads `NotificationMessage` + `NotificationEvent`, then legacy AuditLog rows below them (plan row 9). The legacy derivations are moved into a helper **byte for byte**. |
| `PaceAlertLog` model | `pace-alerts.ts:88` (read), `:333` (create), `:400` (delete) | `verify-f5-polish.ts` 10, `verify-notify5.ts:246` | **Migrated.** `:88` stays as the producer gate (W4). The create moves to the kind's `onSent` hook (written when the intent becomes `sent`; P2002 is ignored). The delete goes away: a lock written after a send has nothing to release. `pace-alerts-actions.tsx:19`, `api/pace-alerts/settings/route.ts:98`, `cron/pace-alerts/route.ts:10, 43` and `notify.ts:214` are comments; the ones that describe lock-before-send are corrected in the build. |
| `consoleEmailSender` | 3 production uses (`test/route.ts:115`, `hr-ack:222`, `pace-alerts:267`) | — | **Migrated.** The dispatcher's dry-run path prints the same `[notify:console]` line (NOTIFY-5 choice 6), one per recipient. |
| `EmailSender` type | `pace-alerts.ts:7, 66` | `verify-f5-polish.ts` 6 capture senders; `verify-notify5.ts:118` | **Unchanged.** It is the dispatcher's transport type. |
| `deliveryMode` / `sandboxAllows` | 4 and 2 production uses | `verify-notify5.ts` | **Unchanged functions.** All uses move into `resolveTransport()` and the dispatcher's mode step. `deliveryMode()`'s table is not touched (out of scope). |
| `NOTIFICATION_ENTITY_TYPE` / `ACTION_DRY_RUN` | `pace-alerts.ts:182, 184` (the dry-run once-a-month query) | `verify-notify5.ts` | The `pace-alerts.ts` query is **replaced** by the per-(intent, recipient) message check. The constants stay for the parallel write. |

**Totals: 3 sender call sites, 9 `recordEmailAttempt` calls, 1 cron caller
of the pace function plus 17 fixture callers, 1 + 7 calls of
`sendAckNotification`, 1 `scheduleAckNotification` caller, 1 + 2
`findAttemptByResendId`, 1 + 2 `listRecentEmails`, 3 `PaceAlertLog`
operations in `src/`.** Every one of them is in the table, either migrated or
named as deliberately left.

---

## C3. Every reader of `PaceAlertLog` and of Notification AuditLog rows

**`PaceAlertLog`: one reader in `src/`.** `pace-alerts.ts:88`, the `already`
check. It stays as the producer gate (W4), so the parallel-write release reads
it exactly as today. Writes during the release: written once, when a live
intent becomes `sent`, with `recipients` = the addresses that have a `sent`
delivery and `thresholdPct` = the threshold used, so the row means what it
meant before. `verify-f5-polish.ts`'s ten reads assert those fields.

**Notification AuditLog rows: five readers in `src/`.**

| Reader | After NOTIFY-6 |
|---|---|
| `listRecentEmails` attempts query (`notification-log.ts:185`) | Legacy section only, for AuditLog rows older than the org's first `NotificationMessage` (choice 6). So parallel rows never show twice. |
| `listRecentEmails` events query (`:213`) | Same legacy section. Unchanged logic. |
| `findAttemptByResendId` (`:287`) | Webhook fallback only. Parallel attempt rows carry the same `resendId`, so even if the new lookup missed (it cannot, both are written in one dispatch step) the fallback would still find the org. |
| `deliveryEventExists` (`:302`) | Guards the parallel AuditLog event row. Unchanged. |
| `pace-alerts.ts:179` dry-run once-a-month | **Removed.** Replaced by the (intent, recipient, dry-run) message check. |

`/api/forecasting/audit` (`route.ts:90`) filters `GOAL_ENTITY_TYPES` and
cannot see Notification rows. Checked, not affected.

**Rollback check:** if NOTIFY-6 were reverted, the NOTIFY-5 reader would read
the parallel AuditLog rows. Each is a normal `email.sent` / `email.failed` /
`email.dryrun` row with one recipient and that message's own `resendId`, so it
renders correctly and webhook events still correlate. That is why the
parallel write is one row **per message** and not one per intent (choice 6).

---

## C4. Sweep placement — **lean: a new `/api/cron/notify-dispatch`, hourly at `15 * * * *`**

The cron count first: `vercel.json` has **7** entries, and two already run
hourly. Hourly schedules only run on a paid Vercel plan, so the project is
already on one. Vercel's per-project cron limit is far above 8 on paid plans
(40 when I last knew it; it may be higher now). **I could not check the plan
from here.** Gary, please confirm in the dashboard that an eighth cron is
allowed. Nothing in the repo records the plan.

Why a new route and not a leg in `checklist-day-close`:

1. **Failure domain.** `checklist-day-close` says of itself *"THE ONLY WRITER
   OF THE CLOSED FACT"*. With a send leg inside it, a provider timeout (10 s
   each, `notify.ts:74`) could use up its `maxDuration` of 300 s and leave
   days unclosed. The reverse also holds: a day-close failure would stop email
   retries.
2. **One question per log line.** The Vercel function log is where both are
   read. Two routes answer "did the checklists close" and "did the retries
   go" separately.
3. **`:15`, not `:00`.** The two hourly crons and pace (`0 15 * * *`) fire on
   the hour. At `:15` the sweep runs after pace's own inline dispatch has
   finished. The 1-hour minimum backoff (C5) means nothing that pace just
   failed is due yet anyway.

The route copies `pace-alerts/route.ts`'s shape: `CRON_SECRET` Bearer,
`maxDuration = 300`, transport resolved before the loop, and a summary line
with org ids, never names. `/api/cron(.*)` is already public in
`src/proxy.ts:10`.

---

## C5. Retry cap and backoff — **lean: 5 attempts; backoff 1 h, 2 h, 4 h, 8 h**

- An **attempt** is one dispatch of an intent that made at least one live
  provider call. Dry-run and sandbox dispatches are not attempts.
- After attempt *n* fails for anyone, `nextAttemptAt = now + 2^(n-1) h`. The
  fifth failed attempt sets `failed`. The schedule spans about 15 hours, which
  fits inside pace's day before the next producer run and well inside hr.ack's
  7 days.
- **All recipients failed** → the intent stays `queued` (nobody got it).
  **Some failed** → `partial`. Both are retried. **Freshness applies only to
  `queued`** (choice 4). A `partial` intent already reached someone, so it
  retries until the cap whatever its age, and the org switch can still stop
  it.
- **What `failed` looks like on /settings/notifications:** no new card. Each
  failed attempt is already a "Failed" row with the error in Recent emails.
  For an intent in `failed`, the newest failed row's detail adds
  *"— gave up after 5 attempts"*. So the row an admin reads says both what
  went wrong and that Froot has stopped trying.

**A behaviour change, named:** hr.ack gains retries. Today a failed signing
notice is *"recorded and lost"* (`hr-ack-notification.ts:11`). Under the
pipeline, a failed live send is retried hourly with backoff. The 2026-09-20
"no retry" note was about the pre-pipeline shape. The pipeline's whole point
is the retry (P6). No ruling is needed, but the file header comment changes.

---

## C6. NOTIFY-8 headroom — **no column needed now**

- **P1 unsubscribe.** A delivery row carries `recipient` (lower-cased
  address) and `userId?`, so it resolves to a user (deny the kind's
  capability) or to a bare address (an `hrAckRecipients` entry). The link
  itself is signed over (org, kind, userId or address). It does not need a
  message id, which matters because the link is rendered **before** the
  message row exists. Nothing to add.
- **P4 reply-to.** One nullable `replyTo` column on `NotificationMessage`
  when NOTIFY-8 lands. Additive. `EmailMessage.replyTo` already exists
  (`notify.ts:22`).
- **P5 prune by age, intents kept forever.** No FK points **from** an intent
  to anything prunable. The FKs point the other way:
  `Delivery.intentId → Intent` (CASCADE, never fires because intents are never
  deleted), `Message.intentId → Intent` (SET NULL),
  `Delivery.messageId → Message` (**SET NULL**, so pruning a 180-day-old
  message cannot fail on a delivery that points at it),
  `Event.messageId → Message` (CASCADE: an event without its message is
  meaningless). The sent-once lock is `Intent.state`, which pruning never
  touches. Old deliveries can go too: they only matter for P6 while an intent
  is `partial`, and a `partial` intent is at most about 15 hours old (C5).

---

## C7. Test samples — **lean: no `sample()` now; MS-4b adds it**

The registry does not need it to exist. The `test` kind renders its own fixed
delivery-test body, which is what the button sends today. A per-kind sample
is NOTIFY-3 § 4.5's `{ kind }` body. The prompt puts *"kind-specific test
samples beyond what the registry needs to exist"* out of scope. Adding an
optional field that nothing implements would be a field nobody reads. MS-4b
adds `sample` and the `{ kind }` body together, with the first real use.

`batch: "per-recipient-daily"` is **not free**. It needs a second dispatch
loop grouped by recipient across intents, and a different sent-once rule (one
delivery covers several intents). The type's `batch` union has only
`"per-intent"` in NOTIFY-6. MS-4b widens it.

---

## C8. Concurrency — **lean: the delivery row is claimed before the send**

The mechanism is the `NotificationDelivery @@unique([intentId, recipient])`
row, used as a per-recipient lock. This is `PaceAlertLog`'s lock-before-send,
moved down to one recipient:

1. **Claim, live mode only, before calling the provider.** For a new
   recipient, `create` a delivery with `state = "pending"`. A unique
   violation (P2002) means another dispatcher has this recipient, so skip
   them. For a recipient with a `failed` row (the P6 retry), run
   `updateMany({ where: { id, state: "failed" }, data: { state: "pending" } })`.
   A count of 0 means someone else claimed it, so skip. Both are single atomic
   statements, so only one dispatcher can win a given recipient.
2. **Send, then settle:** `pending → sent` (with `messageId`) or
   `pending → failed`.
3. **Finalize the intent from the delivery rows**, not from what this call
   did. If any row is still `pending` and fresh, another dispatcher is in
   flight. The intent's state is left for that dispatcher to finish.
4. **A stale `pending`** (older than 15 minutes) means a dispatcher died
   between claiming and settling. **Lean: treat it as `failed` and retry
   it** (choice 2). The only window for a duplicate is a function killed after
   Resend accepted the message and before the next database write. That is
   one HTTP round trip, and losing a signing notice is the worse failure.
   Gary may prefer the pace lock's old bias (never twice, accept the loss).
   Either is a two-line change.

`pending` is a third delivery state the prompt's table does not list (it
lists `sent | failed`). It is required by this mechanism. A delivery is only
ever `pending` while a send is in flight.

**Proof in the fixture:** two `dispatchNotifications({ intentIds: [id] })`
calls in one `Promise.all`, against a capture sender that waits 200 ms per
message, three recipients. Expected: exactly three captured messages, one per
address; three deliveries, all `sent`; intent `sent`. Then the negative
control from the prompt (P6 filter broken) confirms the fixture can fail.

**Not covered, accepted:** sandbox and dry-run write no delivery row, so two
**producer** dispatches of the same intent in the same second could write two
dry-run rows (NOTIFY-5 choice 7, already ratified as cosmetic) or send Gary
two sandbox copies. Under R2's lean the sweep never sends in sandbox, so the
only way this could happen is two hand-fires at once.

---

## C9. Migration SQL preview

**Dev is level now:**

```
dev ep-late-water-a6k53nv2
$ npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
Loaded Prisma config from prisma.config.ts.
-- This is an empty migration.
```

`env | grep -c DATABASE_URL` printed `0`, so the config read `.env`. Its only
endpoint is `ep-late-water-a6k53nv2` (and `-pooler`), the dev endpoint.

**Expected migration `YYYYMMDDHHMMSS_notify6_pipeline` (timestamp taken at
generation), and nothing else:**

| Statement | Kind |
|---|---|
| `CREATE TABLE "NotificationIntent"`: `id` PK, `organizationId`, `kind`, `dedupeKey`, `entityId?`, `eventAt`, `payload JSONB`, `state TEXT DEFAULT 'queued'`, `attempts INT DEFAULT 0`, `lastError?`, `nextAttemptAt?`, `sentAt?`, `createdAt`, `updatedAt` | new table |
| `UNIQUE INDEX (organizationId, kind, dedupeKey)` | index |
| `INDEX (state, nextAttemptAt)` — the sweep's query | index |
| `CREATE TABLE "NotificationDelivery"`: `id` PK, `intentId`, `recipient`, `userId?`, `messageId?`, `state`, `error?`, `createdAt`, `updatedAt` | new table |
| `UNIQUE INDEX (intentId, recipient)`; `INDEX (messageId)` | index |
| `CREATE TABLE "NotificationMessage"`: `id` PK, `organizationId`, `kind`, `mode`, `provider`, `providerMessageId?`, `to`, `subject`, `status`, `error?`, `intentId?`, `createdAt` | new table |
| `UNIQUE INDEX (providerMessageId)` (nullable; Postgres allows many NULLs); `INDEX (organizationId, createdAt)`; `INDEX (intentId)` | index |
| `CREATE TABLE "NotificationEvent"`: `id` PK, `messageId`, `type`, `reason?`, `at`, `createdAt` | new table |
| `UNIQUE INDEX (messageId, type)` | index |
| FKs: Intent→Organization RESTRICT; Message→Organization RESTRICT; Delivery→Intent CASCADE; Delivery→Message SET NULL; Message→Intent SET NULL; Event→Message CASCADE | FKs |

The `Organization` back-relation fields are Prisma-only and produce no SQL.
**No `ALTER TABLE` on any existing table. No enum type** (choice 1). If the
generated diff contains anything outside this table, that is drift, and the
session STOPS and reports it.

---

## The plan: files to touch and why

| # | File | Change |
|---|---|---|
| 1 | `prisma/schema.prisma` | The four models above, plus `Organization` back-relations. `npx prisma format`, `npx prisma validate`. |
| 2 | `prisma/migrations/<ts>_notify6_pipeline/migration.sql` | Generated with `migrate diff -o`. Read it, check it against C9. **STOP: report the SQL; step 3 (Gary's `migrate deploy` on dev) is owed; nothing is committed.** |
| 3 | `src/lib/notifications/registry.ts` (new) | `defineNotification`, the `NotificationKindDef` type (`kind, label, capability?, enabled(org), freshnessMinutes, batch: "per-intent", resolveRecipients, exclude?, render, sandboxBypass?, onSent?`), and `getKind()`. |
| 4 | `src/lib/notifications/kinds/{pace-alert,hr-ack,test}.ts` (new) | One entry each. **Pace subject and text are moved byte for byte** from `pace-alerts.ts:230-262`. hr.ack's are moved byte for byte from `hr-ack-notification.ts:176-248`. Test's from `test/route.ts:74-107`. `render` is a pure function of (payload, org, recipient). Pace's `onSent` writes the parallel `PaceAlertLog`. Test has `sandboxBypass: true`, the NOTIFY-5 ruling *"may email the admin who pressed it even when the allowlist is empty"*. |
| 5 | `src/lib/notifications/dispatch.ts` (new) | `enqueueNotification` (the upsert, never throws), `resolveTransport()`, `dispatchNotifications({ organizationId?, kinds?, intentIds?, transport, trigger })`: freshness → switch → recipients (`resolveRecipients` → `can()` → `exclude` → lower-case de-dup → drop `sent`) → mode per recipient → render → one message per recipient → claim/settle (C8) → record (Message + parallel AuditLog row + Delivery) → finalize (C5) → `onSent`. Returns per-intent, per-recipient results for the callers' responses. |
| 6 | `src/lib/pace-alerts.ts` | Producer `evaluatePaceForStore`: today's evaluation, the `PaceAlertLog` gate (W4), and the recipient count (kept so the "no admin/manager recipients" / "every … denied" reasons survive), then enqueue with `dedupeKey "{storeId}:{YYYY-MM}"` and a payload of the computed figures. `processPaceAlertForStore` (same signature) = evaluate → enqueue → dispatch that intent, mapped back to `PaceAlertResult` with the same reason strings. The LOCK/RELEASE block and the AuditLog dry-run query are removed. |
| 7 | `src/app/api/cron/pace-alerts/route.ts` | Resolve the transport before the loop (still fails with zero rows on bad config). Otherwise unchanged; same JSON shape. |
| 8 | `src/lib/hr-ack-notification.ts` | `scheduleAckNotification` unchanged outside; inside `after()` it calls `sendAckNotification`. That function loads, skips **before enqueueing** when the list is empty (row-less, F3), builds the payload, enqueues (`dedupeKey` = `signedRecordId`), dispatches inline, and maps to `AckNotificationOutcome`. Still never throws. The header's "no retry" claim is corrected (C5). |
| 9 | `src/lib/notification-log.ts` | `listRecentEmails` re-implemented (same name, same shape): newest 50 `NotificationMessage` rows, each with its latest `NotificationEvent`, and a legacy section of AuditLog attempts older than the org's first message, using the existing derivations moved into a helper unchanged. `EmailLogEntry` gains `section: "pipeline" \| "legacy"`. New: `findMessageByProviderId`, `recordMessageEvent`. `recordEmailAttempt` gains an optional `notificationMessageId`. |
| 10 | `src/app/api/webhooks/resend/route.ts` | After verification: look up `NotificationMessage` by `providerMessageId`. On a hit, append `NotificationEvent` (P2002 = already recorded → 200) **and** the parallel AuditLog event row (existing guard); the org comes from the message row. On a miss, run today's code exactly. Svix, 200 on no match, idempotency: unchanged. |
| 11 | `src/app/api/notify/test/route.ts` | Enqueue (fresh `dedupeKey`, payload carries `to`), dispatch inline, and map the one result to the same response (`ok, mode, provider, to, id`; 502 on failure). The recipient source is unchanged. |
| 12 | `src/app/api/cron/notify-dispatch/route.ts` (new) + `vercel.json` | The sweep (C4), `trigger: "sweep"` (R2). |
| 13 | `src/app/(app)/settings/notifications/recent-emails.tsx`, `page.tsx` | One row per message (choice 7). A legacy section under the heading "Before the notification pipeline", with its rows rendered exactly as today. The "gave up after 5 attempts" detail (C5). The intro sentence says each recipient now gets their own row. |
| 14 | `scripts/verify-notify6.ts` (new) | The prompt's fixture, every item, against dev, with `NOTIFY-6 …` fixture orgs and users, cleaned up at the end. Shaped as a template: a `kindHarness(kind)` block that a future kind reuses for enqueue / mode table / freshness / switch / P6 / concurrency, and adds only its resolver checks. |
| 15 | `scripts/verify-notify5.ts`, `scripts/verify-f5-polish.ts` | Re-run. **Expected changes, each reported:** captures assert one message per recipient (`sent[0].to` holding everyone becomes "the set of `to`s across messages"); per-store AuditLog counts become per-recipient; the lock-before-send assertions become "row written when sent; no row after a failed send". DEBT-105's guarantee (no lock survives a failed send) still holds and keeps its check. `verify-notify-template.ts` should be untouched and green: `email-template.ts` is not edited. |
| docs | `docs/ROADMAP.yaml` (NOTIFY-6 row; the NOTIFY-9 note from W4), `docs/MIGRATIONS.md`, `docs/DECISIONS.md` draft, this file | The docs commit, then build. |

### Choices for ratification (mine, not Gary's)

1. **States, kinds and modes are `TEXT`, not Postgres enums,** with TypeScript
   unions. NOTIFY-7 (`suppressed`) and every new kind would otherwise each
   need a migration to add a value. The registry is the validation. This
   matches `AuditLog.action`.
2. **A stale `pending` delivery (over 15 minutes) is retried** (C8). This
   accepts a one-round-trip duplicate window to avoid losing a notice.
3. **Freshness is in minutes:** pace 1440, hr.ack 10080, test 15 (W3).
4. **All recipients failed → `queued`; some failed → `partial`. Freshness
   expires only `queued`; the org switch expires `queued` and `partial`.**
5. **Cap 5; backoff 1/2/4/8 h** (C5).
6. **Parallel AuditLog: one row per `NotificationMessage`,** in the NOTIFY-5
   shape plus `notificationMessageId`. The reader's legacy section is rows
   older than the org's first message (C3: rollback-faithful, no double
   listing).
7. **Recent emails shows one row per message, so one row per recipient.**
   That is what "a bounce marks one person" needs on the page. The cost: a
   pace alert to six people takes six of the 50 rows. Grouping by intent is a
   display change for later if it reads badly.
8. **The `PaceAlertLog` row gates the pace producer during the parallel
   release** (W4). It is written when an intent becomes `sent`, and P2002 is
   ignored.
9. **hr.ack with an empty list enqueues nothing** (row-less, F3). Its org
   switch is "the list is non-empty", checked again at dispatch (emptied
   between signing and send → `expired`).
10. **`processPaceAlertForStore` and `sendAckNotification` stay as wrappers**
    with their signatures, so the cron, the signing path and 24 fixture calls
    keep their entry points.
11. **The payload holds facts computed at enqueue; `render` is pure.** A
    queued pace intent re-renders today's figures because the producer
    refreshes the payload daily.
12. **The caller resolves the transport** (`{ mode, sender }`), and it is a
    required parameter of `dispatchNotifications`, for NOTIFY-5 choice 1's
    reason: no fixture can become a dry-run test by accident. The sender is
    built only when a real send happens, except in the pace cron, which keeps
    building it before the loop.
13. **No `sample()`; `batch` is `"per-intent"` only** (C7).
14. **`NotificationDelivery.userId` is plain text with no FK,** like
    `AuditLog.userId`. A deleted user must not block a ledger row.
15. **`NotificationEvent.at` is required.** It is the provider's timestamp, or
    the time Froot received the event when the provider sent none.
16. **Sweep at `15 * * * *`** (C4).

### New forks

- **R1** and **R2** above. Both need Gary's words before the build.
- **C4's cron allowance** is a fact to confirm, not a fork.

---

## Findings triage

| Finding | Disposition |
|---|---|
| Staging checklist says sandbox intent → `sent`; the design says sandbox never changes state | **RULING NOW** (R1) |
| The hourly sweep plus ratified NOTIFY-5 choice 4 would email Gary every hour | **RULING NOW** (R2) |
| "test freshness immediate" expires every test before it is sent | **FIX NOW**, in the plan (W3, choice 3) |
| Pre-pipeline `PaceAlertLog` rows would allow a second alert in the deploy month | **FIX NOW**, in the plan (W4, choice 8) |
| NOTIFY-9 must move the pace gate to intent state when it stops the `PaceAlertLog` write | **ROW**: a note on the existing NOTIFY-9 row, not a new row |
| The dry-run "one message per intent" wording vs one message per recipient | **COMMENT**, reading stated above |
| Delivery needs a third state, `pending`, for the claim (C8) | **COMMENT**; it follows from the mechanism |
| hr.ack gains retries; the file header says "no retry" | **COMMENT**; P6 is the ruling; the header is corrected in the build |
| Two simultaneous producer dispatches in sandbox could send Gary two copies | **COMMENT**, accepted (C8) |
| The Vercel plan's cron allowance is not recorded anywhere in the repo | **COMMENT**; Gary confirms in the dashboard (C4) |
| Fixtures `verify-f5-polish.ts` and `verify-notify5.ts` assert one shared message | **FIX NOW**, in the build (plan row 15), every changed check reported |

Counts: **FIX NOW 3 · RULING NOW 2 · COMMENT 5 · ROW 1** (a note on an
existing row; no new row filed).

---

**STOP. Waiting for Gary's go, and his words on R1 and R2, before any file
under `prisma/`, `src/` or `scripts/` is touched.**
