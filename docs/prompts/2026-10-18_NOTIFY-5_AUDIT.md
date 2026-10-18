# NOTIFY-5 AUDIT — one delivery mode (live / sandbox / dry-run) + "Send a test to me"

TIER 3. Phase 1 (read-only audit) of
`docs/prompts/2026-10-18_NOTIFY-5_delivery_mode.md`. Written 2026-10-18.
Nothing under `src/`, `scripts/` or `prisma/` was touched by this phase. No
prisma command was run. No database was queried.

---

## Repo gate

Run one command at a time, each result read before the next:

| Command | Result |
|---|---|
| `pwd` | `/Users/garythomas/Claude_Projects/Froot/froot` ✓ |
| `git fetch origin` | (no output) ✓ |
| `git status` | On branch `staging`, working tree clean, **ahead of `origin/staging` by 3 commits** |
| `git log --oneline -5` | `634eab3` NOTIFY-5 session prompt · `93bd378` NOTIFY-3 AUDIT · `7673b14` MS-4b audit · `2bfe14b` · `2ca8b64` |

**A deviation from the prompt's gate, and why I continued.** The prompt allows
"ahead of origin" by exactly `7673b14` and `93bd378`. The branch is ahead by
three. The third is `634eab3`, which adds one file:
`docs/prompts/2026-10-18_NOTIFY-5_delivery_mode.md` (275 insertions, checked
with `git log --stat @{u}..`). That is the prompt this session is running. A
prompt cannot name the commit that adds it. All three unpushed commits are
docs-only, and each touches one file in `docs/prompts/`. I treated the gate as
passed and am recording the deviation here rather than working around it.

---

## C1. Has anything changed since `93bd378` in the files to read?

**No.** `git diff --stat 93bd378 HEAD -- src scripts` prints nothing. The only
commit since then is `634eab3`, which is docs-only.

The prompt's line references all still hold:

- `notify.ts:160-169`: the fail-closed comment inside the `resend` branch of
  `getEmailSender()`.
- `pace-alerts.ts:153-305`: the LOCK → SEND → RELEASE block. The lock create
  is at `:165-182`, the send at `:263`, and the release at `:299-303`.
- `cron/pace-alerts/route.ts:30`: `const sender = getEmailSender()`, before the
  store loop.

One correction to the prompt, which stays a COMMENT and is not a defect:
"`src/app/(app)/settings/notifications/*` — page and the three client
islands". There are **two** client islands, `hr-ack-recipients.tsx` and
`pace-alerts-actions.tsx`. `recent-emails.tsx` is a **server** component with
no `"use client"` (its header comment says so). This matters for the build in
one way: `recent-emails.tsx` has a `STATUS_STYLE: Record<EmailLogStatus, …>`.
Adding the `"dry run"` status makes that file fail to typecheck until it gets
a style. So it is a file this phase touches.

---

## C2. Every caller, by name (`src/` and `scripts/`, every route group)

I searched for every one of these names: `getEmailSender`,
`consoleEmailSender`, `createResendEmailSender`, `EmailSender`,
`recordEmailAttempt`, `AckNotificationOutcome`, `sendAckNotification`,
`scheduleAckNotification`, `emailProviderName`, `processPaceAlertForStore`,
`ATTEMPT_ACTIONS`, `findAttemptByResendId`, `listRecentEmails`, and imports
of `lib/notify`. Eleven files match. One is `src/generated/roadmap.ts`, which
is generated from ROADMAP.yaml prose and contains no code, so it is excluded.
That leaves **ten files**:

| Name | Call sites outside its own definition | Handled by |
|---|---|---|
| `getEmailSender()` | **3**: `api/cron/pace-alerts/route.ts:30`, `lib/hr-ack-notification.ts:205`, `api/notify/test/route.ts:102` | all three get `deliveryMode()` next to them (build steps 2–4) |
| `consoleEmailSender` | **0** outside `notify.ts` (returned by `getEmailSender()` only) | unchanged |
| `createResendEmailSender` | **0** outside `notify.ts` | unchanged |
| `EmailSender` (type) | `lib/pace-alerts.ts:7` (type import for `opts.sender`); `scripts/verify-f5-polish.ts:45, 222, 430, 483, 523, 631` (capture and throwing senders) | pace gains `opts.mode`. The fixture's 9 calls gain `mode: "live"` (see Plan) |
| `processPaceAlertForStore` | cron `route.ts:90`; `verify-f5-polish.ts` **9 calls**: `:224, 378, 381, 437, 451, 485, 525, 548, 633` | same as above |
| `recordEmailAttempt` | `pace-alerts.ts:272, 285`; `hr-ack-notification.ts:265` (via `recordOutcome`); `notify/test/route.ts:104, 117`; `verify-f5-polish.ts:327` | `action` widens to include `email.dryrun`, and `mode` is stamped inside the function. No caller has to change unless it writes a dry-run row |
| `AckNotificationOutcome` | returned only by `sendAckNotification` | new `dry-run` member |
| `sendAckNotification` | **1**: `scheduleAckNotification` (`hr-ack-notification.ts:67`), which **discards** the outcome. No script calls it | nothing reads the outcome, so the new member breaks no consumer |
| `scheduleAckNotification` | **1**: `lib/hr-signed-pdf.ts:803` inside `ensureSignedRecord` | unchanged. `ensureSignedRecord`'s three route callers (`api/hr/documents/[id]/acknowledgments`, `…/signed-record`, `…/checkpoints/[checkpointId]/unretire`) are untouched because the notification is fire-and-forget. The two page hits (`(app)/hr/acknowledge/…`, `(my)/my/documents/…`) and `components/hr/signing-unavailable.tsx` mention it in comments only |
| `emailProviderName()` | `notify/test/route.ts:56`; `notification-log.ts:90` | unchanged (stays unvalidated, per the prompt) |
| `ATTEMPT_ACTIONS` | `notification-log.ts:159` (`listRecentEmails`), `:256` (`findAttemptByResendId`) | the first gains `email.dryrun`; the second is pinned explicitly to sent + failed (C2 note below) |
| `findAttemptByResendId` | `api/webhooks/resend/route.ts:127`; `verify-f5-polish.ts:336` | must never return a dry-run row |
| `listRecentEmails` | `settings/notifications/page.tsx:79`; `verify-f5-polish.ts:360` | new status |

**Total: 3 sender call sites, 1 cron caller plus 9 fixture callers of the pace
function, 5 production calls of `recordEmailAttempt` plus 1 fixture call, and
1 consumer of `AckNotificationOutcome` (which discards it). The build must
handle every one.**

`scripts/verify-notify-template.ts` imports only `renderEmail` and `node:fs`.
It touches no sender, so it stays green as long as `email-template.ts` is not
edited, and this phase does not edit it.

**`findAttemptByResendId` and dry-run rows.** Today it filters
`action: { in: ATTEMPT_ACTIONS }` plus a `metadata.resendId` JSON-path
equality. A dry-run row never carries a `resendId`, so even after
`email.dryrun` joins `ATTEMPT_ACTIONS` the JSON-path filter cannot match one.
That is true but implicit. The prompt asks for it to be explicit, so the build
gives this function its own list, `PROVIDER_ATTEMPT_ACTIONS = [sent, failed]`,
and the fixture checks it.

---

## C3. Consumers of the cron JSON and of `AckNotificationOutcome`

- **Cron JSON: no consumer. Confirmed.** `cron/pace-alerts` appears in
  `vercel.json:8` (the schedule), in a comment in
  `cron/checklist-day-close/route.ts:23`, and in comments in
  `verify-f5-polish.ts:391, 498`. Nothing fetches it or parses it. The route's
  own comment says it is read in the Vercel function log. Adding `mode` is
  additive.
- **`AckNotificationOutcome`: one consumer, which discards it** (C2). Adding
  `{ status: "dry-run"; recipients }` breaks nothing.
- **`/api/notify/test`: no caller in `src/` today.** The button this phase
  builds is its first consumer. Adding `mode` to every response is additive.

---

## C4. Can "one dry-run row per store per month" use the AuditLog index?

**Yes.** `AuditLog` has exactly one index: `@@index([organizationId,
entityType, createdAt])`. The query is:

```ts
prisma.auditLog.findFirst({
  where: {
    organizationId: store.organizationId,   // equality, leading column
    entityType: "Notification",             // equality, second column
    createdAt: { gte: monthStartUtc },      // range, third column
    action: "email.dryrun",                 // residual filter
    entityId: store.id,                     // residual filter
  },
  select: { id: true },
})
```

This uses all three index columns: two equalities, then a range on the last.
`action` and `entityId` are filtered on the few rows that remain, which is at
most one org's notifications for part of a month. `monthStartUtc` is the
**store-local** first of the month at 00:00 in `store.timezone`, converted to
a UTC instant. (`createdAt` is `TIMESTAMP(3)` with no zone, so Prisma writes
it in UTC. CLAUDE.md § Database Evidence.) The pace function already computes
the store-local month (`mStart`), so this is the same boundary the lock uses.

---

## C5. Fork P2: Gary's ruling, quoted

From the session prompt that launched this file, Gary, 2026-10-18:

> *"Approved. Staging sends real email only to addresses on an allowlist.
> Start the allowlist with just my address. Everything else on staging is
> sandboxed or dry-run, never delivered."*

**The PRECONDITION's "P2 approved" branch applies: all three modes are built,
including `NOTIFY_SANDBOX_ALLOWLIST` and `sandboxAllows()`.**

"Start the allowlist with just my address" is a Vercel **Preview** env value.
It is Gary's to set, and it is on the staging checklist. It is not in code:
the code default for unset or empty is "nobody", per the prompt's design.

---

## The plan: files to touch and why

No schema, no migration, no new table.

| # | File | Change |
|---|---|---|
| 1 | `src/lib/notify.ts` | `DeliveryMode`, `deliveryMode()`, `sandboxAllowlist()`, `sandboxAllows()`. `deliveryMode()` **throws** on an unknown provider (same message as `getEmailSender()`). It does not check Resend config. That stays in `getEmailSender()`, which every live/sandbox path still calls, so `resend` without a key still throws in both resend modes. `getEmailSender()` and `emailProviderName()` are unchanged |
| 2 | `src/lib/pace-alerts.ts` | `opts.mode: DeliveryMode` (required, next to `sender`). After recipients resolve and **before the lock**, branch on mode: `live` runs today's code byte for byte; `dry-run` renders, applies the once-per-store-month check (C4), writes `email.dryrun`, writes **no** `PaceAlertLog`, and returns `alerted:false, reason:"dry-run"`; `sandbox` filters through `sandboxAllows`, behaves as dry-run when empty, and otherwise sends to the allowed addresses only, with **no lock**, `email.sent` naming only them, and `alerted:true, reason:"sandbox"` |
| 3 | `src/app/api/cron/pace-alerts/route.ts` | resolve `mode = deliveryMode()` next to `getEmailSender()` (before the loop, so a bad provider still fails the run with zero rows); pass it in; `mode` in the JSON and the log line |
| 4 | `src/lib/hr-ack-notification.ts` | new outcome member; `deliveryMode()` resolved **inside** the existing try, so it still never throws into signing; dry-run and sandbox paths; the "no recipients configured" skip stays first and writes no row |
| 5 | `src/app/api/notify/test/route.ts` | `mode` resolved inside the try (a bad provider still gives a 502 that names it); dry-run writes `email.dryrun` (and still logs through the console sender); sandbox sends to the caller unfiltered; `mode` in every response, including 502 (`mode: null` when the provider value is invalid) |
| 6 | `src/lib/notification-log.ts` | `ACTION_DRY_RUN`, joins `ATTEMPT_ACTIONS`; `PROVIDER_ATTEMPT_ACTIONS` for `findAttemptByResendId`; status `"dry run"`; `mode` stamped in metadata by `recordEmailAttempt` through a non-throwing read (the function must never throw, and it runs on the bad-provider failure path); legacy derivations unchanged |
| 7 | `src/app/(app)/settings/notifications/recent-emails.tsx` | style for `"dry run"`, label **"Dry run — not sent"** (required to typecheck, see C1) |
| 8 | `src/app/(app)/settings/notifications/test-send-button.tsx` (new) | client island: POST, "Sending…" disabled state, one-line result, `router.refresh()` |
| 9 | `src/app/(app)/settings/notifications/page.tsx` | place the button under the h1; one clause added to the Recent emails intro explaining "Dry run" |
| 10 | `scripts/verify-notify5.ts` (new) | the fixture in the prompt's build step 7 |
| 11 | `scripts/verify-f5-polish.ts` | **`mode: "live"` added to its 9 `processPaceAlertForStore` calls, and nothing else.** Required: `mode` is a required option, and the fixture asserts lock behaviour that only `live` has. If `mode` defaulted to the environment instead, this fixture would silently become a dry-run test locally, because local `.env` does not set `NOTIFY_EMAIL_PROVIDER`. That is why it is required rather than defaulted |
| docs | `CLAUDE.md` § Environment Variables; `docs/ROADMAP.yaml` (NOTIFY-5 row, MS-4b blocker for P0); `docs/DECISIONS.md` draft; this file | docs commit, then build |

### Choices for ratification (mine, not Gary's)

1. **`mode` is passed into `processPaceAlertForStore` by the cron and is
   required, not read inside the function.** The cron already resolves the
   sender once before the loop. Mode sits next to it, so one run cannot mix
   modes, and the fixture can set it without touching `process.env`.
   `deliveryMode()` is still the only function that decides it.
2. **`deliveryMode()` throws on an unknown provider.** This matches
   `getEmailSender()`, so no new way to be misconfigured appears.
3. **Sandbox `email.sent` rows carry `withheld: <count>`** (a count, not the
   addresses). The prompt says the row names only the addresses sent to, and
   it still does. The count makes the filter visible on staging, where Gary's
   checklist asks him to confirm nobody else was emailed. The withheld
   addresses go to the function log line only.
4. **A sandbox pace send is not deduplicated.** With no lock, every hand-fire
   on staging re-sends to the allow-listed addresses. Vercel crons run only on
   production deployments, so on staging this happens only when someone fires
   it by hand, and resending is what a hand-fire is for. Production is `live`
   and keeps its lock.
5. **The acknowledgment fixture stubs `globalThis.fetch` for
   `api.resend.com`** instead of adding a sender-injection parameter to
   `sendAckNotification`. That path builds its sender internally, and this
   way the real `getEmailSender()` → Resend sender → fetch chain is
   exercised, with no test-only seam in production code.
6. **A dry-run test send still prints through `consoleEmailSender`**, so the
   function log keeps today's `[notify:console]` line. Pace and ack in dry-run
   print the same line. "Render, log it, record it" is the prompt's own
   wording.
7. **The race between two concurrent dry-run evaluations of the same store
   can write two `email.dryrun` rows.** No lock protects a dry-run (it must
   not write one), and a duplicate log row is cosmetic. I'm accepting it
   rather than adding a lock-shaped mechanism to a path whose job is to write
   no lock.

### New forks

**None that need a ruling before the build.** Every choice above stays inside
the approved design and is listed for ratification, not decision.

---

## Findings triage

| Finding | Disposition |
|---|---|
| Gate ahead by 3, not 2; the third commit is this prompt's own file | **COMMENT**, recorded above |
| The prompt says "three client islands"; `recent-emails.tsx` is a server component, and its `Record<EmailLogStatus>` must gain a style | **FIX NOW**, in the build (plan row 7) |
| `findAttemptByResendId` excludes dry-run rows only implicitly | **FIX NOW**, in the build (plan row 6) |
| `verify-f5-polish.ts` would silently turn into a dry-run test if mode defaulted to env | **FIX NOW**: `mode` is required (plan row 11) |
| Sandbox pace sends are not deduplicated | **COMMENT**, choice 4 for ratification |
| Concurrent dry-run evaluations can write two rows | **COMMENT**, choice 7 |

Counts: FIX NOW 3 · RULING NOW 0 · COMMENT 3 · ROW 0.

---

**STOP. Waiting for Gary's go before any file under `src/` or `scripts/` is
touched.**
