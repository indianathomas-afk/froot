# NOTIFY-3 AUDIT — one notification pipeline for every email Froot sends

Written 2026-10-18 by a TIER 1 read-only session, at `7673b14` on `staging`
(one commit ahead of `origin/staging`: the MS-4b audit, unpushed). No code was
changed and no database was touched: no `prisma` command of any kind was run.
The only write is this file.

Gary's goal, his words exactly (2026-10-18):

> *"We have built an email notifications system before. We never really
> completed it and I never received an email. Looking at this long term with
> future businesses signing up to Froot, shouldn't we tie all this together?"*

Read first, as asked: `docs/prompts/2026-10-17_MS-4b_AUDIT.md`. Everything it
says about production still holds; this audit builds on it and does not repeat
its SQL.

**Short answer: yes.** Today there are three email types, each with its own
idea of "sent once", "who gets it", "what happens when the provider is off"
and "how do we log it". They agree on the transport (`getEmailSender()`), the
template (`renderEmail()`) and the log row shape (`recordEmailAttempt()`), and
on nothing else. The fourth type (milestones, MS-4b) was about to invent a
fourth answer — its own table, its own production guard, its own partial-
failure rule (forks F14–F16). That is the moment to stop and build the shared
pipeline once.

---

## NAMING COLLISION — read before anything else

**`NOTIFY-3` is already a ROADMAP id.** `docs/ROADMAP.yaml:20205` —
*"Employee-facing notifications — assignment emails and 'you have something
to sign'"*, `status: planned`, deferred by Gary's ruling of 2026-09-20. This
file is named `NOTIFY-3_AUDIT` because the session prompt names it so; it is
**not** that row's audit. The phases proposed below are numbered
**NOTIFY-5 to NOTIFY-9** so they do not collide with NOTIFY-3 or NOTIFY-4
(operational digest). Gary decides whether this audit should be renamed in a
later docs commit or simply cross-referenced (RULING NOW, triage below).

---

## Why Gary has never received an email (four reasons, all true at once)

1. **Production sends nothing.** `NOTIFY_EMAIL_PROVIDER` is unset in the
   Production scope (Gary checked Vercel 2026-10-18, quoted in the MS-4b
   audit). Unset means the console sender: one log line, nothing leaves
   Vercel, and every caller is told it succeeded (`src/lib/notify.ts:50-69`).
2. **Every email type is OFF by default per org.** `paceAlertsEnabled
   @default(false)` (`prisma/schema.prisma:83`); `hrAckRecipients
   @default([])` (`:125`). Even with a live provider, nothing goes out until
   an admin turns a type on.
3. **There is no "send a test" button anywhere.** `POST /api/notify/test`
   exists but no UI calls it — `grep -rn "notify/test" src` finds only the
   route itself and the generated roadmap. The only way to fire it is a hand-
   made POST from an ADMIN session.
4. **Delivery has never been observable.** No Resend webhook endpoint has
   been recorded as created in any environment, so `RESEND_WEBHOOK_SECRET` is
   unset, `/api/webhooks/resend` 500s by design, and "Recent emails" can never
   advance past **Sent** (or **Logged only** on production).

**The one recorded delivery:** NOTIFY-1's test send on staging, 2026-09-20
09:34 PT (16:34 UTC), Resend id `01a0bfab-3a0c-70f7-8c95-6c336460b07e`, from
deployment `13bccff` (`docs/DEPLOY_LOG.md:1834-1836`). It went to the Clerk
primary address of whoever was signed in as ADMIN. If that was Gary and he
does not remember it, check Junk — DEBT-109 records that first sends from
`notify.usefroot.com` land in Outlook Junk.

**What this means: real email is a Gary-side settings change, not a code
change.** The go-live checklist (§ 6) can run today with the code as it is,
and the first email Gary receives can be a production test send. The pipeline
(§ 4–5) is about making every type behave the same way and making a fifth
type cheap. It does not stand in the way of switching email on.

---

## 1. Inventory — every email Froot can send

### 1a. Emails Froot sends itself (through `getEmailSender()`)

There are exactly three call sites of `getEmailSender()` in `src/`:
`src/app/api/cron/pace-alerts/route.ts:30`, `src/lib/hr-ack-notification.ts:205`,
`src/app/api/notify/test/route.ts:102`. (Searched by the sender's NAME and by
the `EmailSender` type, per CLAUDE.md § Verifying a guard covers every path;
`scripts/verify-f5-polish.ts` holds a capture sender for its fixture and sends
nothing.)

| | **Behind-pace alert** (`pace.alert`) | **Signed acknowledgment** (`hr.ack`) | **Test** (`test`) |
|---|---|---|---|
| **Trigger** | Daily cron `/api/cron/pace-alerts`, `0 15 * * *` (`vercel.json`), Bearer `CRON_SECRET`. One evaluation per active store with DailyGoal rows this month whose org has the switch on (`route.ts:42-47`). Fires when MTD actual ÷ MTD goal (through yesterday, store-local) < threshold (`pace-alerts.ts:29-39`). | An event: an `HrSignedRecord` is minted (`hr-signed-pdf.ts:803`) → `scheduleAckNotification()` runs `sendAckNotification()` inside `after()`, once, never retried (`hr-ack-notification.ts:63-77`). | `POST /api/notify/test` by an ADMIN. **No UI calls it.** |
| **Recipients chosen** | Every `ADMIN` in the org + every `MANAGER` with a `StoreUserAssignment` to the store, one query (`pace-alerts.ts:116-122`), then each filtered through `can(…, "notify.pace.receive")` (`:123-139`). Resolved at send time. | The free-typed address list `Organization.hrAckRecipients` (max 10, validated at `src/app/api/hr/settings/route.ts`). **Not users**: an address there need not belong to anyone in Froot. No role, no capability check. | The calling ADMIN's own Clerk primary email (`getClerkPrimaryEmail`), resolved server-side; no request body (`route.ts:46-52`). |
| **Scope** | Store-scoped for managers, org-wide for admins. | Org-wide: every signing in every store goes to the same list. | The caller only. |
| **Per-user grid** | Yes — `notify.pace.receive` (`permissions.ts:160, 501, 995`): baseline ADMIN+MANAGER, deniable, not grantable; "Email notifications" area of the Edit User grid. | **None.** Removing someone means editing the address list on /settings/notifications. | n/a |
| **Org switch** | `Organization.paceAlertsEnabled`, default false, enforced in the cron's store query (`route.ts:46`). Plus per-org threshold `paceAlertThresholdPct`. | Implicit: an empty list = off (`hr-ack-notification.ts:112-115`). Hidden unless the HR module is available; disabled unless HR is on (`settings/notifications/page.tsx:94-121`). | n/a |
| **Sent-once / lock** | `PaceAlertLog @@unique([storeId, month])` — one alert per store per month. Lock written BEFORE the send; released (by id) and rethrown if the send throws (`pace-alerts.ts:164-182, 262-305`). | **None.** No idempotency record. A second mint of the same record cannot happen (minting is itself idempotent), but nothing stops a re-send if `sendAckNotification` is called twice (e.g. from a verification script). No retry: a failed send is recorded and lost. | None (by design). |
| **Under the console sender** | **Consumes the lock.** Lock written, console "send" succeeds, lock **stays**, `email.sent` row with `provider: "console"`, result `alerted: true`. That store cannot alert again this month even after Resend is switched on. | **Writes "sent" and loses the email.** `email.sent` row, `provider: "console"`, outcome `status: "sent"`. No ledger to replay from; that signing is never emailed. | Harmless: `ok: true, provider: "console"`, `email.sent` row. The response names the provider so the caller can tell. |
| **Message shape** | ONE message, all recipients in `to:` — they see each other's addresses. | ONE message, all list addresses in `to:`. | One recipient. |
| **Logging** | `recordEmailAttempt()` → AuditLog `entityType "Notification"`, action `email.sent`/`email.failed`, `metadata.{kind, provider, recipients, subject, resendId, error}`; `entityId` = storeId. Plus `PaceAlertLog` row. | Same AuditLog shape; `entityId` = signedRecordId. "No recipients" is a log line with no row (F3, 2026-09-20). | Same AuditLog shape; `entityId` null. |
| **Webhook status** | Correlated by `metadata.resendId` → `email.delivered/bounced/complained/delayed` rows appended (`webhooks/resend/route.ts`). **Unprovisioned in every environment** — the route 500s without `RESEND_WEBHOOK_SECRET`. | Same. | Same. |
| **Reply-to** | none (no-reply). | none — HR-16 ruled no per-merchant reply address. | none. |
| **From** | `NOTIFY_FROM_EMAIL` = `USE Froot <noreply@notify.usefroot.com>` for every org. | same | same |

### 1b. Emails Froot causes but Clerk sends (outside the pipeline)

These are the only emails that **do** leave production today:

| Email | Trigger | Sender |
|---|---|---|
| Organization invitation | `createOrganizationInvitation` in `api/users/route.ts:106` (invite a user), `api/staff/[id]/invite/route.ts:57` (give a staff member a login), and the device-login flow (`stores/create-device-login-button.tsx`) which goes through the same route | Clerk, from Clerk's email settings for the instance |
| Sign-in / sign-up codes, password reset, email verification | Clerk's hosted auth | Clerk |

They are mentioned so the onboarding plan accounts for them: their sender
name, logo and domain are set in the **Clerk dashboard per instance**, not in
Froot, and they are the first email every new business ever receives from
"Froot". They should not be routed through Froot's pipeline — Clerk owns the
token in the link — but their branding belongs on the same go-live checklist.

### 1c. Planned, not built

- **MS-4b milestone emails** — designed, not built; held on forks F14–F16
  (MS-4b audit). Would add `MilestoneNotice` (its own sent-once table),
  `Organization.milestoneAlertsEnabled`, `notify.milestone.receive`, a cron
  leg, a production-only guard and a second test-send button.
- **NOTIFY-3 (the existing row)** — employee-facing email; deferred by ruling.
- **NOTIFY-4** — operational report digest; no design.
- **HR-8 reminders**, **CAL overdue emails** — named as "known and not built"
  in `docs/DEPLOY_LOG.md:1845-1846`.

---

## 2. What the three existing types disagree about

| Question | pace.alert | hr.ack | test | MS-4b as designed |
|---|---|---|---|---|
| Sent-once record | own table, per store-month | none | none | own table, per (staff, milestone) |
| Written before send? | yes | — | — | yes |
| Failure | release lock, retry tomorrow | lost | 502 | F16 (unruled) |
| Partial failure (some recipients) | impossible today — one message for all | same | — | F16 (unruled) |
| Provider off (console) | **burns the lock** | **writes "sent", loses the email** | fine | F14: would burn, unless guarded |
| Production-only guard | none (relies on Vercel crons running only on production) | none | none | `VERCEL_ENV === "production"` (F5) |
| Staging behaviour | **real mail** if an admin turns it on | **real mail** to the list | real mail to caller | dry-run log |
| Who | role + capability | address list | caller | role + capability + scope |
| Per-user off switch | grid | edit the list | — | grid |
| Org switch | column | empty list | — | column |
| Test send | the generic one | the generic one | — | its own button |
| Freshness | daily re-evaluation | none | — | 7 days (F3) |
| Delivery status | AuditLog JSON path | same | same | same |

Every row is a decision someone made correctly for one type. None of them was
made for "every type", which is why the fourth type needed three new forks.

---

## 3. Smaller findings from the inventory

1. **Group sends leak addresses and blur status.** Pace and ack send ONE
   message with every recipient in `to:`. Every recipient sees every other
   address, and Resend reports a bounce per message, so one dead address
   marks the whole send "bounced" on the log while the others were delivered.
   For a single business this is tolerable; with several businesses and
   external addresses in `hrAckRecipients` it is not.
2. **Webhook correlation has no index.** `findAttemptByResendId` and
   `deliveryEventExists` filter AuditLog by `metadata.path(["resendId"])`
   with no `organizationId`, so the only AuditLog index
   (`[organizationId, entityType, createdAt]`) cannot serve them. Every
   delivery event scans every Notification row in every org. Fine at today's
   volume (≈ zero); linear in all tenants' mail later.
3. **Console mode is not a mode, it is a provider.** "Do not really send" is
   decided by which sender object you got, so each caller has to know what
   "success" from the console sender means — and two of three do not.
4. **There is no allowlist for non-production.** Staging runs `resend` and
   would email real Keva managers if the pace switch were turned on there;
   the protection is policy (MS-4 audit A3).
5. **`hrAckRecipients` bypasses the capability model.** It is the right call
   for "who at corporate hears about signatures" (HR-16), but it means a
   person removed from the org keeps receiving signing notices until someone
   edits the list, and the Edit User grid cannot show it.
6. **No suppression.** A hard-bounced or complaining address is mailed again
   at the next trigger. Resend suppresses at the account level, so the send
   would be refused or silently dropped, and Froot would record it as "sent".
7. **Org name in the From header is not used, and must be sanitised when it
   is.** Today From is fixed. The moment it becomes `"{org} via Froot"`, an
   org name with `"`, `<`, `>` or a newline becomes header input.
8. **No retention.** Notification AuditLog rows (with recipient addresses)
   are kept forever.

---

## 4. The proposed pipeline

One path, four stages. Every type, existing and future, goes through all four.

```
 producer ──► INTENT ──► DISPATCH ──► PROVIDER ──► EVENTS
 (cron leg,   (ledger:    (mode, recipients,  (Resend or   (webhook →
  event hook,  sent-once   suppression,        dry-run)     status)
  test)        per key)    render, batch)
```

### 4.1 The send intent — "this thing happened and someone should hear about it"

A producer never sends. It calls one function:

```ts
enqueueNotification({
  organizationId,
  kind: "pace.alert" | "hr.ack" | "milestone.reached" | …,
  dedupeKey,        // the sent-once identity, chosen by the kind
  entityId,         // what it is about (store, signed record, staff member)
  eventAt,          // when it happened — the freshness clock starts here
  payload,          // everything the template needs, nothing else (no pay)
})
```

- **pace.alert**: `dedupeKey = "{storeId}:{YYYY-MM}"`, enqueued by the daily
  evaluation while the store is behind.
- **hr.ack**: `dedupeKey = signedRecordId`, enqueued at mint (in `after()`,
  never throws — the HR-16 rule stays).
- **milestone.reached**: `dedupeKey = "{staffMemberId}:{tenure|checklist}:{milestoneId}"`,
  enqueued by the daily leg; `eventAt` = the store-local reach date.
- **test**: `dedupeKey` = a fresh id, never deduplicated.

Enqueue is an upsert on `(organizationId, kind, dedupeKey)`:
- no row → create, state `queued`;
- a row in `sent` / `partial` / `known` → **no-op** (sent stays sent — Gary's
  MS-4a ruling, now true for every kind);
- a row in `queued` / `expired` → refresh `payload` and `eventAt` (for pace,
  this is what lets a store that was behind on day 3 in dry-run still alert on
  day 20 once mail is live — the lock is no longer "the row exists", it is
  "the row says sent").

### 4.2 The ledger — what was sent to whom, once

Additive schema, four tables. Names are a lean, not a ruling.

| Table | One row per | Key fields | Job |
|---|---|---|---|
| `NotificationIntent` | event | `organizationId, kind, dedupeKey` **@@unique**, `entityId`, `eventAt`, `payload Json`, `state` (`queued \| sent \| partial \| failed \| expired \| known`), `attempts`, `lastError`, `sentAt` | The sent-once lock for every kind. Replaces `PaceAlertLog`'s role and MS-4b's planned `MilestoneNotice`. |
| `NotificationDelivery` | intent × recipient | `intentId, recipient` **@@unique**, `userId?`, `messageId`, `state` (`sent \| failed \| suppressed`) | Who got it. Makes partial failure answerable: retry only the recipients with no `sent` row, so nobody gets it twice (supersedes F16). |
| `NotificationMessage` | provider call | `organizationId, kind, mode` (`live \| sandbox \| dry-run`), `provider`, `providerMessageId` **@unique** (nullable), `to`, `subject`, `status`, `error`, `createdAt` | The send log. "Recent emails" reads this. Real column for the provider id → the webhook lookup is an index hit (finding 2). |
| `NotificationEvent` | webhook event | `messageId, type` **@@unique**, `reason`, `at` | Append-only delivery verdicts, exactly the 2026-09-20 ruling ("append, never update"), moved off AuditLog JSON. |

**Additive only.** `PaceAlertLog` stays; it is written in parallel for one
release so the old reader keeps working, then simply stops being written
(no drop, ever). AuditLog `Notification` rows keep being written in parallel
for the same release; the settings reader switches to `NotificationMessage`.
Pre-pipeline AuditLog rows keep their meaning ("unknown" for rows with no
provider, per the NOTIFY-2a ruling) and can be shown under the new list as
history.

### 4.3 Dispatch — the only code that decides whether mail really goes out

One function, `dispatchNotifications({ organizationId?, kinds? })`, run:
- **inline**, right after an event producer enqueues (hr.ack, test) — so a
  signing notice still arrives in seconds;
- **by the daily cron**, after the pace and milestone producers run;
- **by an hourly sweep** (a new `/api/cron/notify-dispatch`, or a leg in the
  existing hourly `checklist-day-close`) that retries `queued` and `partial`
  intents with backoff, up to a cap.

For each `queued` intent, in order:

1. **Freshness.** Older than the kind's window → state `expired` (or `known`
   for milestones, F3's word), never sent. Windows: pace 1 day (the producer
   re-enqueues daily while the store stays behind), milestones 7 days (F3),
   hr.ack 7 days, test immediate. **This is F3 generalised: one rule covers
   first run, switch-on, cron outage and provider outage for every kind.**
2. **Org switch.** The kind's switch for this org is off → `expired`, no mail.
3. **Recipients**, resolved now, never cached (F6). Each kind supplies a
   resolver; the pipeline then applies, in this order, to every resolved
   address: the kind's capability through `can()` (users), the kind's
   exclusions (F15: never the subject employee, by `userId` AND by email),
   de-dup by lower-cased address, **suppression list** (§ 4.6), and the
   already-`sent` deliveries for this intent.
4. **Mode** (§ 4.4) — decides, per recipient, `live`, `sandbox-blocked` or
   `dry-run`.
5. **Batching.** Per kind: `per-intent` (pace, ack, test) or
   `per-recipient-daily` (milestones: one email per recipient per day listing
   every new milestone in their stores, F4).
6. **Render** through `renderEmail()` — still the one template.
7. **Send one message per recipient.** Never a shared `to:` (finding 1). Use
   Resend's batch endpoint when a dispatch has many messages.
8. **Record**: `NotificationMessage` per send; `NotificationDelivery` per
   (intent, recipient); intent → `sent` when every live recipient has a
   delivery, `partial` when some failed (hourly sweep retries only the
   failures), `failed` after the retry cap.

**What the pipeline removes from every caller:** the lock-then-release dance,
the "is the provider real" question, recipient de-dup, the log write, and
the "never throw into the signing path" wrapper (the enqueue call is the only
thing the signing path touches, and it never throws).

### 4.4 Delivery mode — the common dry-run

One function decides, from the environment, and nothing else is allowed to:

| Environment | `NOTIFY_EMAIL_PROVIDER` | Mode | Behaviour |
|---|---|---|---|
| any | unset / `console` | **dry-run** | Render, write a `NotificationMessage` with `mode: dry-run` (shows as "Dry run — not sent"), **never** change an intent's state, **never** write a `sent` delivery, **never** write a lock. Logged once per intent, not once per daily run. |
| non-production (`VERCEL_ENV !== "production"`) | `resend` | **sandbox** | Real mail ONLY to addresses on `NOTIFY_SANDBOX_ALLOWLIST` (comma-separated, Preview scope) and to the caller of a test send. Every other recipient is dry-run for that recipient. Intents are not marked `sent` by a sandbox send, so staging can never consume anything. |
| production | `resend` | **live** | Real mail to everyone the pipeline resolved. |

Consequences, each of which is currently a separate fork or finding:

- **F14 is answered for every kind**, not just milestones: console mode no
  longer burns pace locks, no longer writes "sent" for acknowledgments.
- **Staging stops emailing real managers** by construction instead of by
  policy (finding 4). This **changes today's staging behaviour** — hr.ack on
  staging would only reach allow-listed addresses. RULING NOW (fork P2).
- Local dev (`VERCEL_ENV` unset) is sandbox or dry-run, never live.

### 4.5 One test send

`POST /api/notify/test` gains an optional `{ kind }` body. With no kind it is
today's delivery test. With a kind, it renders that kind's registered
`sample()` payload — fixed, fake content, no real employee — and sends it.

- Recipient is **always** the caller's Clerk primary email, never a body
  field (today's security model, unchanged).
- Bypasses the org switch and dedupe (it is a test), obeys the mode table
  (so production-console says "Dry run — not sent", which is the honest
  answer).
- Subject prefixed `Test — `; logged as kind `test` with `sampleOf: kind`.
- **One button per card** on /settings/notifications ("Send a test to me"),
  plus one at the top of the page for the plain delivery test. MS-4b no longer
  builds its own.

### 4.6 Delivery status and bounce handling

- `POST /api/webhooks/resend` stays, re-pointed at `NotificationMessage` by
  `providerMessageId` (indexed). Keeps the Svix raw-body verification, the
  200-on-no-match, the idempotency on `(message, type)`.
- **Hard bounce or complaint → `EmailSuppression`** (`email` unique,
  `reason`, `sourceMessageId`, `createdAt`, `clearedAt?`, `clearedBy?`).
  Dispatch skips a suppressed address and records the delivery as
  `suppressed`, so the log says why. Soft bounces and delays never suppress.
- **Suppression is per sending domain, not per org**, because Resend's own
  suppression is per account: an address that bounced for one business will
  also be refused for the next. Org admins see suppressed addresses that
  belong to *their* recipients (on /settings/notifications and on the user's
  row in /users) and can clear one after fixing the address; clearing is
  audited.
- Status words on the page stay as today (`Delivered`, `Sent`, `Bounced`,
  `Complained`, `Delayed`, `Failed`) plus `Dry run — not sent`,
  `Suppressed` and `Blocked (staging)`.

### 4.7 How a new type plugs in — milestones as the worked example

One registry entry in a new `src/lib/notifications/registry.ts`:

```ts
defineNotification({
  kind: "milestone.reached",
  label: "Milestone reached",                     // log + grid label
  capability: "notify.milestone.receive",         // grid row; baseline ADMIN+MANAGER
  enabled: (org) => org.milestoneAlertsEnabled,   // the org switch (F10)
  freshnessDays: 7,                               // F3
  batch: "per-recipient-daily",                   // F4
  dedupeKey: (p) => `${p.staffMemberId}:${p.milestoneKind}:${p.milestoneId}`,
  resolveRecipients: (intent, ctx) => …,          // F6: ADMINs + MANAGERs of any of the
                                                  // member's stores; corporate → ADMINs only
  exclude: (intent, r) => …,                      // F15: subject employee by userId AND email
  render: (intents, recipient, org) => …,         // F7: no pay, rates, raise dates
  sample: () => ({ … }),                          // for "Send a test to me"
})
```

Then: one capability line + grid row in `permissions.ts` (the NOTIFY-2c
"one entry here" property, kept), one org switch, and the producer calls
`enqueueNotification`. **No new table, no new guard, no new test route, no
new log code.** The fixture template (§ 7) is shared: every kind gets the same
dry-run, sent-once, freshness, suppression and exclusion checks for free, and
adds only its own resolver checks.

MS-4b shrinks to: the producer (detect reached milestones, enqueue), the
registry entry, the capability, the org switch column, the card, the
`?tab=milestones` link, and its fixture.

---

## 5. Multi-tenant onboarding — what a new business needs

| Need | Proposal | Ruling needed? |
|---|---|---|
| **Sender name** | From: `"{Org name} via Froot" <noreply@notify.usefroot.com>`. One shared, verified sending subdomain for every tenant. Org name sanitised (strip `" < > \r \n`, collapse whitespace, cap ~60 chars) before it touches a header. Per-tenant custom domains (each with its own DKIM) are a much later, paid-tier feature, not onboarding. | P3 — the display name today is "USE Froot" for everyone. |
| **Reply-to** | Optional per-org `notifyReplyTo` (one validated address, set on /settings/notifications). Unset = no-reply, as today. | P4 — HR-16 ruled "no per-merchant reply address". That ruling was made for one tenant; with many, "who do I reply to" is the first question a manager asks. Gary's to reopen or keep. |
| **Per-org enablement** | Every kind is OFF for a new org (today's defaults, kept). A single accessor `kindEnabled(org, kind)` reads the existing columns (`paceAlertsEnabled`, `hrAckRecipients` non-empty) and, for kinds added from now on, a generic `OrganizationNotificationSetting(organizationId, kind, enabled, settings Json)` table — so kind #5 needs no `Organization` column. Existing columns are never dropped. | No — implementation choice. |
| **First-run** | An "Email notifications" step on the onboarding/setup path: shows each kind off, one-click test send, and a Junk-folder note (DEBT-109). | No. |
| **Bounce handling** | § 4.6 suppression. A tenant whose recipients bounce shows it on their page; Froot sees it across tenants. | No. |
| **Unsubscribe / opt-out** | **The biggest multi-tenant change.** Today: no self-service opt-out, no unsubscribe anywhere (NOTIFY-2c, Gary 2026-09-20). With many businesses sharing one sending domain, a recipient who cannot opt out reaches for "Report spam", and **complaints against the shared domain hurt delivery for every tenant**. Lean: a `List-Unsubscribe` + `List-Unsubscribe-Post` (one-click) header on every operational email, pointing at a signed link that denies that kind's `notify.*.receive` for that user (the same switch an admin flips in the grid, so the model does not fork) and shows the admin who opted out. For `hrAckRecipients` addresses (not users), the link removes the address from the list. | **P1 — reverses a standing ruling; Gary's alone.** |
| **Tenant isolation** | Every intent, delivery and message carries `organizationId`; resolvers are org-scoped like today; the webhook resolves the org from the message row, never from the event body. Fixture asserts a two-org run never crosses. | No. |
| **Volume and reputation** | Per-org daily send cap (kill switch if a tenant suddenly sends hundreds); complaint-rate check before raising caps; DMARC tightened only after weeks of clean mail (DEBT-109 order, unchanged). Confirm the Resend plan's daily/monthly limits and API rate limit before the second tenant goes live. | No — operational. |
| **Retention** | Prune `NotificationMessage` / `NotificationEvent` / `NotificationDelivery` older than a set age (lean 180 days) in the existing `engagement-prune` cron. Intents keep only `state` forever (the sent-once lock must outlive the log). | P5 — the age. |
| **Clerk-sent email** | Production Clerk instance: set the application name, logo and (if wanted) a custom email domain in the Clerk dashboard so invitations do not arrive from a generic sender. | Gary-side, no code. |

---

## 6. Go-live checklist — real production email

**Everything here is Gary's to do; nothing needs a code change.** It is the
MS-4b audit's B2 list, ordered, with the steps that audit did not cover.
Can run before any pipeline phase: today's defaults mean the flip itself
emails nobody.

**Before anything**
1. Run the MS-4b audit's **Q1, Q2, Q3** in the Neon console on `production`
   (`br-sparkling-block-a620qvg4`). Q1 tells you which orgs would start
   mailing at the next 15:00 UTC; Q3 tells you which stores already have a
   burned lock this month.
2. In Resend: confirm `notify.usefroot.com` still shows **Verified** (SPF,
   DKIM, DMARC `p=none`), and note the plan's daily and monthly limits.
3. In Resend: create an API key **for production only**, sending access,
   restricted to that domain. Put it in the password manager **in the same
   minute** (Sensitive values can never be read back).

**Vercel, Production scope only** (Preview values are separate)
4. `NOTIFY_EMAIL_PROVIDER` = `resend`
5. `NOTIFY_FROM_EMAIL` = `USE Froot <noreply@notify.usefroot.com>`
6. `RESEND_API_KEY` = the new key — **Sensitive**
7. Confirm `NEXT_PUBLIC_APP_URL` = `https://www.usefroot.com` (links in every
   email are built from it; hr.ack refuses to send without it).
8. In Resend: add a webhook endpoint `https://www.usefroot.com/api/webhooks/resend`
   for `email.delivered`, `email.bounced`, `email.complained`,
   `email.delivery_delayed`. Copy **its** signing secret into
   `RESEND_WEBHOOK_SECRET` (Production). **Never Preview's** — one secret per
   endpoint.

**Deploy**
9. Redeploy **production** (read the branch column). A deployment keeps the
   env it was built with; saving a variable alone changes nothing.
10. Confirm the new deployment's created time is **after** the saves.

**Prove it**
11. Signed in to production as an ADMIN, on any page, open the browser
    console and run:
    `await fetch("/api/notify/test", { method: "POST" }).then(r => r.json())`
    Expect `provider: "resend"`, `ok: true` and an `id`. (Until the test
    button exists, this is the only way.)
12. Find the email — **check Junk** — and mark it Not Junk (DEBT-109).
    **This is the first email Gary receives.**
13. Within a few minutes, /settings/notifications → Recent emails shows that
    test as **Delivered**. That proves the webhook end to end, which no
    environment has done yet. If it stays **Sent**, the webhook secret or
    endpoint is wrong — not the send.

**Turn types on, one at a time**
14. Signed acknowledgments: put **one** address (Gary's) in the list, sign a
    test document, expect one email whose link opens the record.
15. Behind-pace alerts: turn on for Keva only, after reading Q3 — any store
    with a lock for the current month stays quiet until next month (the
    console-mode burn). Watch the first 15:00 UTC run in the function log:
    `N orgs enabled, M stores evaluated, K alerted`.
16. Milestones: only after MS-4b is built and promoted.

**Rollback** (fastest first)
- Turn an org's switch off on /settings/notifications — instant, no deploy.
- Set `NOTIFY_EMAIL_PROVIDER=console` and redeploy production — stops all
  mail. (Note: until NOTIFY-5 lands, console mode burns pace locks again.)

---

## 7. Phases

Numbered NOTIFY-5 onward because NOTIFY-3 and NOTIFY-4 are taken. Tiers are
leans under CLAUDE.md § Session Tiers; Gary declares the real one.

| Phase | Tier | Size | What | Depends on |
|---|---|---|---|---|
| **GO-LIVE** | Gary-side (no session needed; a TIER 1 docs session can record it) | S | § 6. Real production email for the existing types. | nothing |
| **NOTIFY-5 — test button + delivery mode** | **TIER 3** | S | (a) "Send a test to me" button on /settings/notifications calling the existing route. (b) `deliveryMode()` with live / sandbox / dry-run (§ 4.4) and `NOTIFY_SANDBOX_ALLOWLIST`, applied to the three existing types **without new tables**: dry-run writes no `PaceAlertLog`, writes an `email.dryrun` AuditLog row instead of `email.sent`, and returns `alerted: false, reason: "dry-run"`. Fixes the console lock burn and F14 for everyone. No schema. TIER 3 because it changes what the cron writes and what staging sends. | nothing; best before or with GO-LIVE |
| **NOTIFY-6 — the ledger and dispatcher** | **TIER 3** | M-L | § 4.1–4.3: four tables (migration, STOP for Gary), `enqueueNotification`, `dispatchNotifications`, the registry, freshness, per-recipient sends, partial-failure retry, hourly sweep. Migrate pace, hr.ack and test onto it. Parallel writes to `PaceAlertLog` and AuditLog for one release; reader switches to `NotificationMessage`. Webhook re-pointed at the indexed column. Shared fixture template. | NOTIFY-5 |
| **MS-4b — milestone emails, re-scoped** | **TIER 3** | M (was L) | The first new kind on the pipeline (§ 4.7). Drops its own `MilestoneNotice` table, its own guard and its own test button; F14 and F16 are answered by the pipeline; F15 becomes the kind's `exclude`. Keeps `milestoneAlertsEnabled` (or the generic setting), the capability, the producer, the card, `?tab=milestones`. | NOTIFY-6, MS-1…MS-4a on staging |
| **NOTIFY-7 — suppression and bounce handling** | **TIER 3** | S-M | § 4.6: `EmailSuppression`, dispatch skip, admin view and clear, user-row badge. | NOTIFY-6 + webhook provisioned |
| **NOTIFY-8 — tenant onboarding** | **TIER 3** | M | § 5: sanitised org display name in From, optional reply-to (if P4), generic per-org setting table, onboarding step, per-org daily cap, retention prune, and one-click unsubscribe (if P1). | NOTIFY-6; rulings P1, P3, P4, P5 |
| **NOTIFY-9 — legacy retirement** | **TIER 2** | S | After one release with parallel writes: stop writing `PaceAlertLog` and Notification AuditLog rows (tables and columns stay — additive-only), mark the legacy reader as history-only. | NOTIFY-6 in production one release |

Later consumers, unchanged in scope, now each a registry entry: **NOTIFY-3**
(employee-facing; its recipient-model ruling still comes first), **NOTIFY-4**
(digest — a `per-recipient-daily` or weekly batch kind), **HR-8 reminders**,
**CAL overdue**.

**Order recommended:** GO-LIVE and NOTIFY-5 now (small, independent, and the
pair gets Gary his first email with no new way to lose one) → NOTIFY-6 →
MS-4b → NOTIFY-7 → NOTIFY-8 → NOTIFY-9.

**What this means for MS-4b, which is blocked on F14–F16 today:** if Gary
takes this plan, MS-4b should **not** build its own `MilestoneNotice`
migration. Building it now and migrating it onto the ledger later is the
exact duplication this audit exists to stop.

---

## Forks for Gary

- **P0 — Adopt the pipeline, and hold MS-4b behind NOTIFY-6?** Lean: yes.
  The alternative is MS-4b as specified (its own table and guard), and
  folding it in later.
- **P1 — One-click unsubscribe for operational email.** Reverses NOTIFY-2c's
  "no unsubscribe anywhere". Lean: yes, before the second tenant, wired to the
  existing per-user capability so there is still one switch.
- **P2 — Staging sends real mail only to an allowlist.** Changes today's
  staging behaviour (hr.ack and pace would no longer reach real addresses
  there). Lean: yes.
- **P3 — From display name `"{Org} via Froot"`.** Lean: yes; the address
  stays Froot's.
- **P4 — Optional per-org reply-to.** Reopens HR-16's "no per-merchant reply
  address". Lean: optional field, unset by default.
- **P5 — Log retention.** Lean: 180 days for messages/events/deliveries;
  intent state kept forever.
- **P6 — F16 replaced.** MS-4b's F16 lean (mark `failed`, never retry a
  partial) is superseded by per-recipient delivery rows: retry only the
  recipients who did not get it. Lean: take the new rule.

---

## Findings triage

| Finding | Disposition |
|---|---|
| Production sends no email; four reasons Gary never received one | **RULING NOW** — GO-LIVE checklist (§ 6) is Gary's to run; no code needed. |
| No UI calls the test-send route | **RULING NOW** — part of NOTIFY-5 (P0). |
| Console mode burns pace locks and writes "sent" for acks (all types, not just MS-4b's F14) | **RULING NOW** — NOTIFY-5's delivery mode. Already recorded as a RULING NOW in the MS-4b audit; this widens it. |
| `NOTIFY-3` id already belongs to the employee-facing row | **RULING NOW** — keep this file's name as prompted and cross-reference, or rename in a later docs commit; phases proposed as NOTIFY-5…9. |
| MS-4b forks F14/F15/F16 change shape under the pipeline | **RULING NOW** — P0, P6. |
| Staging can email real people; protection is policy only | **RULING NOW** — P2. |
| No unsubscribe; shared-domain complaint risk for multi-tenant | **RULING NOW** — P1. |
| Group sends expose recipients to each other and blur bounce status | **ROW** — inside NOTIFY-6 (per-recipient sends); not a separate row. |
| Webhook correlation scans AuditLog JSON with no usable index | **ROW** — inside NOTIFY-6; harmless at today's volume. |
| No suppression list | **ROW** — NOTIFY-7. |
| `hrAckRecipients` bypasses the capability model; removed people keep getting notices | **COMMENT** — by HR-16 design; P1's unsubscribe covers the external-address half. |
| Org name in From would need header sanitising | **COMMENT** — designed into NOTIFY-8. |
| Notification log has no retention | **RULING NOW** — P5. |
| Clerk-sent emails (invitations, codes) carry Clerk-dashboard branding, outside Froot | **COMMENT** — on the go-live checklist as a Gary-side dashboard step. |

Counts: **RULING NOW 8 · ROW 3 (all folded into proposed phases, none filed
as a new row by this session) · COMMENT 3 · FIX NOW 0.**

No ROADMAP row was written: this is a TIER 1 read-only session and the
phases above are proposals until Gary rules on P0.
