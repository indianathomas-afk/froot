TIER 3 session. Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/2026-10-18_NOTIFY-6_pipeline.md and execute it. Repo gate first, one command at a time. Stop where it says stop.

# NOTIFY-6 — One notification pipeline: intent ledger, dispatcher, registry, per-recipient sends, retry — TIER 3

TIER 3: a **schema change** (four additive tables, one migration), a new
cron leg, and a change to what every existing email type writes. Audit →
plan → STOP for Gary → build → generate migration → **STOP for Gary to apply
it** → fixture → commit. Commit only. Never push. Never run a migration.

Written 2026-10-18 by the TIER 1 session that filed the NOTIFY-6 row, on
Gary's instruction ("Then write the NOTIFY-6 session prompt into
docs/prompts/"). This prompt is a claim wholesale once committed. If
something in it is wrong by the time it runs, say so in the audit rather
than working around it.

## Rulings this phase is built under (Gary's words, exactly)

- **P0:** *"P0 approved: adopt the pipeline, hold MS-4b behind NOTIFY-6.
  Write the NOTIFY-5 prompt next."*
- **P2:** *"Approved. Staging sends real email only to addresses on an
  allowlist. Start the allowlist with just my address. Everything else on
  staging is sandboxed or dry-run, never delivered."*
- **P6:** *"Yes — replace MS-4b's F16: retry only the recipients who didn't
  get it, using per-recipient delivery rows."*
- **NOTIFY-5 test-send ruling** (DECISIONS 2026-10-18, NOTIFY-5): *""Send a
  test to me" may email the admin who pressed it even when the allowlist is
  empty, because it can only ever reach the person clicking. Every other
  email on staging follows the allowlist, and an empty allowlist means nobody
  is emailed."*
- **MS-4a ruling (now true for every kind):** *"a milestone email that was
  sent stays sent — if the milestone is lost and re-reached, don't send
  again."*

P1, P3, P4, P5 are ruled too, but they are **NOTIFY-8's**, not this phase's.
Do not build unsubscribe, the From display name, reply-to or retention here.
The schema must not make them hard, though: see C6.

## What NOTIFY-6 delivers (plain English)

1. **Every email goes through one path.** A producer (the pace cron, a
   signing, the test button) records "this happened and someone should hear
   about it" and never sends anything itself. One dispatcher decides who gets
   it, in which mode, and records what happened.
2. **Sent once means sent once, for every kind,** through one ledger table
   instead of `PaceAlertLog` for pace and nothing at all for
   acknowledgments.
3. **One email per recipient.** Nobody sees anybody else's address, and a
   bounce marks one person, not the whole send.
4. **A partly failed send retries only the people who didn't get it** (P6).
   An hourly sweep picks up queued and partial sends.
5. **Adding a new kind is one registry entry.** MS-4b becomes the first new
   kind after this, with no table, guard or test route of its own.

NOT in NOTIFY-6: suppression (NOTIFY-7), the From display name, reply-to,
unsubscribe, retention, the per-org cap, the generic per-org setting table
(all NOTIFY-8), stopping the legacy writes (NOTIFY-9), milestone emails
(MS-4b), kind-specific test samples beyond what the registry needs to exist
(see C7), any change to `deliveryMode()`'s table.

## Read first, in order

1. `docs/prompts/2026-10-18_NOTIFY-3_AUDIT.md` — § 1a, § 2, § 3 findings 1–3,
   **§ 4.1–4.5 and § 4.7 (the design this phase builds)**, § 6 (go-live:
   nothing here may break a step of it), § 7.
2. `docs/prompts/2026-10-18_NOTIFY-5_AUDIT.md` and the NOTIFY-5 row: what
   `deliveryMode()` already does, and the dry-run/sandbox behaviour each
   type has today. NOTIFY-6 keeps every one of those behaviours.
3. `docs/prompts/2026-10-17_MS-4b_AUDIT.md` — F3, F4, F6, F14, F15, F16 (F16
   is superseded by P6; read it to know what not to build).
4. The code, as it is now:
   - `src/lib/notify.ts` — `deliveryMode()`, `sandboxAllows()`,
     `getEmailSender()` (fail-closed: keep it).
   - `src/lib/pace-alerts.ts` — `processPaceAlertForStore` and its
     LOCK → SEND → RELEASE block; the dry-run once-per-store-per-month rule.
   - `src/app/api/cron/pace-alerts/route.ts`.
   - `src/lib/hr-ack-notification.ts` — `scheduleAckNotification` runs in
     `after()` and **never throws into the signing path**. That contract
     survives: the enqueue is the only thing the signing path touches.
   - `src/app/api/notify/test/route.ts` — the recipient is the caller's
     Clerk primary email, never a body field. Unchanged.
   - `src/lib/notification-log.ts` — `recordEmailAttempt`,
     `listRecentEmails` (the "unknown" and "Logged only" derivations are
     rulings), `findAttemptByResendId`, `deliveryEventExists`,
     `recordDeliveryEvent`.
   - `src/app/api/webhooks/resend/route.ts` — Svix raw-body verification,
     200 on no match, idempotent on (message, type), append-never-update.
   - `src/app/(app)/settings/notifications/*`, especially `recent-emails.tsx`.
   - `src/lib/permissions.ts` — `notify.pace.receive`.
   - `src/app/api/cron/checklist-day-close/route.ts` (hourly) and
     `vercel.json`.
   - `prisma/schema.prisma` — `PaceAlertLog`, `AuditLog` and its indexes,
     `Organization.paceAlertsEnabled`, `hrAckRecipients`.
   - `scripts/verify-notify5.ts`, `scripts/verify-f5-polish.ts`,
     `scripts/verify-notify-template.ts`.
5. `docs/ROADMAP.yaml` — NOTIFY-5, NOTIFY-6, NOTIFY-7, NOTIFY-8, NOTIFY-9,
   NOTIFY-10, MS-4b rows. `docs/MIGRATIONS.md`. CLAUDE.md § Database and
   § A migration STOPS the session.

## The design (approved shape from the audit; the details are for this audit to confirm)

### Tables (additive; names are the audit's lean)

| Table | One row per | Key fields |
|---|---|---|
| `NotificationIntent` | event | `organizationId, kind, dedupeKey` **@@unique**; `entityId`, `eventAt`, `payload Json`, `state` (`queued \| sent \| partial \| failed \| expired \| known`), `attempts`, `lastError`, `nextAttemptAt?`, `sentAt?`, timestamps |
| `NotificationDelivery` | intent × recipient | `intentId, recipient` **@@unique** (recipient lower-cased); `userId?`, `messageId?`, `state` (`sent \| failed`; `suppressed` arrives with NOTIFY-7), timestamps |
| `NotificationMessage` | provider call | `organizationId, kind, mode, provider`, `providerMessageId` **@unique nullable**, `to`, `subject`, `status`, `error?`, `intentId?`, `createdAt`; index on `(organizationId, createdAt)` |
| `NotificationEvent` | webhook event | `messageId, type` **@@unique**; `reason?`, `at`, `createdAt` |

Every table carries `organizationId` (directly or through its parent) so a
two-org run can never cross. No column on any existing table is dropped or
renamed. `PaceAlertLog` stays and is written in parallel; NOTIFY-9 stops it.

### Enqueue — `enqueueNotification({ organizationId, kind, dedupeKey, entityId, eventAt, payload })`

Upsert on `(organizationId, kind, dedupeKey)`:
- no row → create `queued`;
- `sent` / `partial` / `known` → **no-op** (sent stays sent);
- `queued` / `expired` → refresh `payload` and `eventAt`.

Dedupe keys: pace `"{storeId}:{YYYY-MM}"`; hr.ack `signedRecordId`; test a
fresh id. Enqueue **never throws** to its caller (log and swallow), because
the signing path calls it.

### Dispatch — `dispatchNotifications({ organizationId?, kinds?, intentIds? })`

Run inline after an event enqueue (hr.ack, test), by the daily cron after the
pace producer, and by an hourly sweep. Per intent, in order:

1. **Freshness**: past the kind's window → `expired` (pace 1 day, hr.ack 7
   days, test immediate).
2. **Org switch** off → `expired`.
3. **Recipients**, resolved now, never cached: the kind's resolver → the
   kind's capability through `can()` for users → the kind's `exclude` →
   de-dup by lower-cased address → drop anyone with a `sent` delivery row for
   this intent (**P6**).
4. **Mode** from `deliveryMode()`, per recipient: `live`; `sandbox` sends
   only to `sandboxAllows()` addresses (the test kind always reaches its
   caller); everyone else, and every recipient in `dry-run`, is dry-run.
5. **Render** through `renderEmail()`.
6. **One message per recipient**, never a shared `to:`.
7. **Record**: one `NotificationMessage` per send attempt (dry-run included,
   `mode: "dry-run"`); one `NotificationDelivery` per live recipient result;
   intent → `sent` when every live recipient has a `sent` delivery, `partial`
   when some failed (with `nextAttemptAt` backoff), `failed` at the retry cap.

**Dry-run and sandbox never change an intent's state and never write a
`sent` delivery** (NOTIFY-5's guarantee, now structural). Dry-run writes at
most one `NotificationMessage` per intent, not one per daily run (the
NOTIFY-5 once-per-store-per-month rule, generalised).

### Registry — `src/lib/notifications/registry.ts`

`defineNotification({ kind, label, capability?, enabled(org), freshnessDays,
batch: "per-intent", dedupeKey, resolveRecipients, exclude?, render })`.
Register `pace.alert`, `hr.ack`, `test`. `batch: "per-recipient-daily"` is
MS-4b's and need not be built here unless it is free; say which in the audit.

### Migrating the three kinds

- **pace.alert**: the cron evaluates as today and **enqueues** while the
  store is behind; dispatch sends. In `live`, `PaceAlertLog` is still written
  (parallel write) when the intent becomes `sent`. The burn stays fixed: a
  store enqueued in dry-run on day 3 still alerts on day 20 once live.
- **hr.ack**: `scheduleAckNotification` enqueues and dispatches inline in
  `after()`. Still never throws into signing. The empty-list skip stays
  row-less (F3, 2026-09-20).
- **test**: enqueue a fresh intent and dispatch inline; the response shape
  the button reads keeps working (`ok`, `mode`, `provider`, `to`, `id`).
- **AuditLog**: `recordEmailAttempt` keeps writing in parallel for one
  release, so nothing reading the old rows breaks.

### Reader and webhook

- "Recent emails" reads `NotificationMessage` (+ its events), and shows
  pre-pipeline AuditLog rows beneath as history with their existing status
  derivations untouched.
- The Resend webhook looks up `NotificationMessage.providerMessageId`
  (indexed — this fixes NOTIFY-3 audit finding 2) and appends
  `NotificationEvent`; it falls back to the AuditLog lookup for
  pre-pipeline sends, and keeps appending the AuditLog event row in
  parallel. Svix verification, 200-on-no-match and idempotency unchanged.
  The org comes from the message row, never the event body.

### The hourly sweep

Retries `queued` and `partial` intents whose `nextAttemptAt` has passed, up
to a cap. Placement is a fork for the audit (C4).

## Repo gate (one command at a time, paste each result)

```
pwd                → must end in Froot/froot
git fetch origin
git status         → on staging, tree clean
git log --oneline -5
```

If any check fails: STOP and report. "Ahead of origin" by docs commits Gary
has not pushed yet is expected — name them and continue.

## Phase 1 — AUDIT (read-only), written to `docs/prompts/<date>_NOTIFY-6_AUDIT.md`

C1. Re-read every file in "Read first" item 4. Anything changed since this
    prompt's commit? Name it.
C2. Enumerate EVERY caller of `getEmailSender()`, `recordEmailAttempt`,
    `processPaceAlertForStore`, `sendAckNotification`,
    `scheduleAckNotification`, `findAttemptByResendId`, `listRecentEmails`
    and the `PaceAlertLog` model — search by those names, include
    `scripts/`, include other route groups (CLAUDE.md § Verifying a guard
    covers every path). State the count. Every one is either migrated or
    named as deliberately left.
C3. Every reader of `PaceAlertLog` and of Notification AuditLog rows. The
    parallel-write release must leave each one correct.
C4. **Sweep placement.** A new `/api/cron/notify-dispatch` (hourly) vs a leg
    in `checklist-day-close`. Check the Vercel plan's cron limits against
    the current `vercel.json` count before leaning. Lean, with the reason.
C5. **Retry cap and backoff.** Lean numbers. State what `failed` looks like
    on /settings/notifications.
C6. **NOTIFY-8 headroom.** Confirm the tables leave room for P1 (an
    unsubscribe link must resolve a delivery to a user or an address), P4
    (reply-to on the message), P5 (pruning messages/events/deliveries by age
    while intents are kept forever — so no FK from intent *to* delivery that
    a prune would break). No columns for them now; say if one is needed.
C7. **Test samples.** Whether the registry needs a `sample()` now or only
    when MS-4b lands; lean.
C8. **Concurrency.** Two dispatches of the same intent (inline + sweep) must
    not double-send. Name the mechanism (row lock, state-guarded update,
    unique delivery row written before the send) and how the fixture proves
    it.
C9. **Migration SQL preview.** What `migrate diff` is expected to produce:
    four `CREATE TABLE`s, their indexes and FKs, and nothing else. Anything
    else in the diff is drift and is a STOP.
Then the plan: files to touch and why, the migration name
(`YYYYMMDDHHMMSS_notify6_pipeline`), any NEW fork with your lean. **STOP for
Gary's go.**

## Phase 2 — BUILD (only after Gary's go)

1. `prisma/schema.prisma`: the four tables. `npx prisma format`,
   `npx prisma validate`.
2. Generate the migration with `npx prisma migrate diff` (CLAUDE.md
   § Database, step 2). Read the SQL. **STOP**: report the SQL, say step 3 is
   owed, commit nothing. Gary applies it to dev himself.
3. After Gary says it is applied: `npx prisma generate`, then the code:
   enqueue, dispatch, registry, the three kinds, the reader, the webhook,
   the sweep, `vercel.json` if C4 says so.
4. Fixture `scripts/verify-notify6.ts`, against the DEV database, shaped as
   a template every future kind reuses:
   - enqueue upsert: create, no-op on `sent`/`partial`/`known`, refresh on
     `queued`/`expired`;
   - every row of the mode table, env set in-process: dry-run and sandbox
     never move an intent's state and never write a `sent` delivery;
     sandbox mails only allow-listed addresses; test reaches its caller in
     sandbox with an empty allowlist;
   - **the burn stays gone**: pace intent in dry-run on one day, live later
     the same month → it sends and `PaceAlertLog` is written;
   - one message per recipient, no shared `to:`;
   - **P6**: a capture sender that fails one recipient of three → intent
     `partial`, two `sent` deliveries; the sweep retries → exactly one more
     message, to the failed recipient only; nobody gets it twice;
   - retry cap → `failed`;
   - freshness → `expired`; org switch off → `expired`;
   - concurrency (C8): two dispatches of one intent → one message per
     recipient;
   - hr.ack: enqueue never throws when the sender throws;
   - webhook lookup by `providerMessageId` finds the message; a
     pre-pipeline `resendId` still resolves through the fallback; a
     duplicate event is not appended twice;
   - tenant isolation: a two-org run never crosses;
   - reader: new rows and pre-pipeline rows both render, legacy derivations
     ("Logged only", "unknown") unchanged;
   - negative control: break the P6 filter (retry everyone), confirm a check
     fails, restore.
   Re-run `verify-notify5.ts`, `verify-f5-polish.ts`,
   `verify-notify-template.ts`; all green, and say what changed in each if
   anything did. Name every fixture org and user `NOTIFY-6 …` and clean them
   up at the end.
5. Gate chain, no pipes:
   `npx eslint <touched files> && npm run build > <log> 2>&1 && git commit -F - <<'EOF' … EOF`
   The work commit waits for the fixture to be green against the applied
   schema (CLAUDE.md § A migration STOPS the session).

## Commits (scope `git add` — never `git add -A`)

- Work commit: schema, migration folder, code, fixture.
- Docs commit: NOTIFY-6 row status and notes from what was actually done;
  `docs/MIGRATIONS.md` entry; `docs/DECISIONS.md` draft (Gary's words exact;
  your choices separate and marked for ratification); the audit file. Build
  after the docs commit (ROADMAP.yaml is typechecked at prebuild).

## Final report

Commits, every `prisma` command run verbatim, fixture counts, build, choices
for ratification, findings triage (FIX NOW / RULING NOW / COMMENT / ROW, with
counts), and a staging checklist:

- staging-SHA precondition first (CLAUDE.md, two commands);
- the migration applies in the staging build (`migrate deploy` in Vercel);
- "Send a test to me" still arrives (check Junk), and Recent emails shows it
  from `NotificationMessage`;
- signing a test document with only Gary's address in `hrAckRecipients`
  sends one email and writes one intent `sent` on `preview/staging`
  (`br-square-feather-a63z92vz`), branch id selected in the query;
- a non-allow-listed `hrAckRecipients` address reads "Dry run — not sent"
  and its intent stays `queued`;
- as a MANAGER: /settings/notifications still redirects.

End with the unpushed-commits line and: "Done and committed. Next:
PRE-PUSH-CHECK for NOTIFY-6." Do not push.
