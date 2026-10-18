TIER 3 session. Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/2026-10-18_NOTIFY-5_delivery_mode.md and execute it. Repo gate first, one command at a time. Stop where it says stop.

# NOTIFY-5 — One delivery mode (live / sandbox / dry-run) + "Send a test to me" — TIER 3

TIER 3: it changes what the pace-alert cron writes, what the acknowledgment
email records, and what staging sends. **No schema.** Audit → plan → STOP for
Gary → build → commit. Commit only. Never push. Never run a migration.

Written 2026-10-18 by the NOTIFY-3 audit session, on Gary's ruling in that
session. His words, exactly:

> *"P0 approved: adopt the pipeline, hold MS-4b behind NOTIFY-6. Write the
> NOTIFY-5 prompt next."*

This prompt is a claim wholesale once committed; if something in it is wrong
by the time it runs, say so in the audit rather than working around it.

## PRECONDITION — fork P2 must be ruled

The sandbox half of this phase changes today's STAGING behaviour (fork P2 in
`docs/prompts/2026-10-18_NOTIFY-3_AUDIT.md`): on a non-production deployment
with `NOTIFY_EMAIL_PROVIDER=resend`, real mail would reach ONLY addresses on
an allowlist, instead of every resolved recipient as today.

The session prompt that launches this file must quote Gary's ruling on P2.

- **P2 approved** → build all three modes as specified below.
- **P2 declined** → build `live` and `dry-run` only. Non-production with
  `resend` behaves exactly as today (that row of the mode table reads
  `live`), `NOTIFY_SANDBOX_ALLOWLIST` is not built, and every sandbox check in
  the fixture is dropped. Say so in the audit.
- **No quote** → STOP after the repo gate and ask for it.

## What NOTIFY-5 delivers (plain English)

1. **One function decides whether an email really leaves**, for every email
   type, from the environment alone. When the provider is off ("console"),
   every type does a DRY RUN: it renders the email, logs it, records
   "Dry run — not sent", and **never** writes a lock or a "sent" row. That
   ends the two silent losses found by the MS-4b and NOTIFY-3 audits: pace
   alerts burning their one-per-month lock while production is on console,
   and acknowledgment emails being recorded as "sent" and never delivered.
2. **On staging, real mail reaches only an allowlist** (if P2 is approved),
   so a hand-fired cron or a test signing can never email a real Keva
   manager.
3. **A "Send a test to me" button** on /settings/notifications, which no UI
   offers today, so an ADMIN can prove delivery in any environment without
   opening the browser console.

NOT in NOTIFY-5: any new table (that is NOTIFY-6), per-recipient sends,
retries, the registry, kind-specific test samples, suppression, milestone
emails (MS-4b, held behind NOTIFY-6 by P0), any change to the Resend webhook.

## Read first, in order

1. `docs/prompts/2026-10-18_NOTIFY-3_AUDIT.md` — § 1a (the inventory table),
   § 2, § 4.4 (the mode table this phase builds), § 6 (go-live; this phase
   must not break any step of it), § 7 (phase boundaries).
2. `docs/prompts/2026-10-17_MS-4b_AUDIT.md` — B2 (what console mode does to
   each type today) and F14.
3. The code, as it is now:
   - `src/lib/notify.ts` — `emailProviderName()`, `consoleEmailSender`,
     `getEmailSender()` (the fail-closed comment at `:160-169` is load-bearing).
   - `src/lib/pace-alerts.ts` — `processPaceAlertForStore`, especially the
     LOCK → SEND → RELEASE block (`:153-305`).
   - `src/app/api/cron/pace-alerts/route.ts` — the sender is resolved once
     before the store loop (`:30`); the org-switch gate is in the store query.
   - `src/lib/hr-ack-notification.ts` — the "never throws into the signing
     path" contract; `AckNotificationOutcome`.
   - `src/app/api/notify/test/route.ts` — recipient is the caller's Clerk
     primary email, never a body field. That rule does not change.
   - `src/lib/notification-log.ts` — `recordEmailAttempt`, `ATTEMPT_ACTIONS`,
     `listRecentEmails` status derivation (the "unknown" rule for rows with no
     provider is a ruling — keep it).
   - `src/app/(app)/settings/notifications/*` — page and the three client
     islands.
   - `scripts/verify-f5-polish.ts`, `scripts/verify-notify-template.ts` —
     the existing fixtures this phase must keep green.
4. `docs/ROADMAP.yaml` — NOTIFY-1, NOTIFY-2a/2b/2c, MS-4b rows; DEBT-105,
   DEBT-109.

## The design (approved shape; details for the audit to confirm)

### The mode function — `src/lib/notify.ts`

```ts
export type DeliveryMode = "live" | "sandbox" | "dry-run"
export function deliveryMode(): DeliveryMode
export function sandboxAllows(email: string): boolean   // P2 only
```

| `VERCEL_ENV` | `NOTIFY_EMAIL_PROVIDER` | Mode |
|---|---|---|
| any | unset / `console` | `dry-run` |
| `production` | `resend` | `live` |
| anything else, including unset (local) | `resend` | `sandbox` (P2) — or `live` if P2 declined |

- `NOTIFY_SANDBOX_ALLOWLIST`: comma-separated addresses, trimmed,
  lower-cased; unset or empty = nobody. Compared case-insensitively.
- An unknown provider value still THROWS, exactly as today. `resend` with a
  missing key or from-address still THROWS, in every mode — fail closed is
  not relaxed by this phase. Dry-run never needs Resend config.
- `emailProviderName()` stays and stays unvalidated (the test route names a
  bad value with it).

### What each type does in each mode

**Behind-pace alert** (`pace-alerts.ts`). The mode is decided BEFORE the lock.

- `live`: unchanged — lock, send, release on failure, `email.sent`.
- `dry-run`: evaluate as today; if it would alert, render the email, write
  NO `PaceAlertLog` row, write one `email.dryrun` AuditLog row (kind
  `pace.alert`, would-be recipients, subject), return `alerted: false,
  reason: "dry-run"`. **At most one `email.dryrun` row per store per month**
  — check for an existing one before writing (lean: AuditLog query on
  `organizationId`, `entityType "Notification"`, `entityId = storeId`,
  `action "email.dryrun"`, `createdAt` within the store's month). Without
  this, a store that stays behind writes a row every day.
- `sandbox`: filter the resolved recipients through `sandboxAllows`. None
  left → behave as `dry-run`. Some left → send to those only, write NO lock
  (staging must never consume a month), write `email.sent` naming only the
  addresses that were sent to, return `alerted: true, reason: "sandbox"`.
- The cron route reports a `mode` field in its JSON and its log line.

**Signed acknowledgment** (`hr-ack-notification.ts`).

- `live`: unchanged.
- `dry-run`: render, write `email.dryrun`, return a new outcome
  `{ status: "dry-run"; recipients: string[] }`. Still never throws.
- `sandbox`: filter `hrAckRecipients` through `sandboxAllows`; none left →
  `dry-run`; some → send to those only, `email.sent` names only them.
- The "no recipients configured" skip stays first and stays row-less (F3,
  2026-09-20).

**Test** (`/api/notify/test`).

- `live`: unchanged.
- `sandbox`: sends to the caller **whether or not they are on the
  allowlist** — the caller is always the only recipient, which is the
  route's whole security model.
- `dry-run`: writes `email.dryrun` instead of today's `email.sent` with
  `provider: "console"`; returns `{ ok: true, mode: "dry-run", provider, to }`.
- Every response gains `mode`.

### The log — `notification-log.ts`

- New action `ACTION_DRY_RUN = "email.dryrun"`, included in
  `ATTEMPT_ACTIONS` so "Recent emails" lists it.
- New status `"dry run"`, label **"Dry run — not sent"**.
- Rows written before this phase keep deriving as they do today: a legacy
  `email.sent` with `provider: "console"` still reads **"Logged only"**, and
  a row with no provider still reads **"unknown"**. Do not rewrite history.
- `recordEmailAttempt` gains `mode` in metadata (stamped there, like
  `provider`, so no caller can forget it).
- `findAttemptByResendId` must NOT match `email.dryrun` rows (they have no
  `resendId`; confirm, and make it explicit).

### The button — /settings/notifications

- A "Send a test to me" button near the top of the page, in a small client
  island (`test-send-button.tsx`), calling `POST /api/notify/test` with no
  body.
- Shows the result inline in one line: where it went, the mode, and the
  provider id or the error. In dry-run it says plainly that nothing left
  this environment. In sandbox it says it was sent from a non-production
  deployment.
- Pending state is the button's own disabled text ("Sending…"), not a
  spinner. Phone width: the button and result wrap, no horizontal scroll.
- After a send, refresh the page data so the new row appears in Recent
  emails (`router.refresh()`).
- The page is already ADMIN_ONLY; the route re-checks `requireAdmin()`.
  Unchanged.

### Docs the build session updates

- `CLAUDE.md` § Environment Variables: add `NOTIFY_SANDBOX_ALLOWLIST` (P2
  only) and amend the `NOTIFY_EMAIL_PROVIDER` line to say unset/console is a
  dry run that consumes nothing.
- `docs/DEPLOY_LOG.md`: none — PRE-PUSH-CHECK writes it.

## Repo gate (one command at a time, paste each result)

```
pwd                → must end in Froot/froot
git fetch origin
git status         → on staging, tree clean, up to date with origin
git log --oneline -5
```

If any check fails: STOP and report. (If Gary has not pushed `7673b14` and
`93bd378` yet, "ahead of origin" by exactly those docs commits is expected —
name them and continue.)

## Phase 1 — SHORT AUDIT (read-only), written to `docs/prompts/2026-10-18_NOTIFY-5_AUDIT.md`

C1. Re-read every file in "Read first" item 3. Anything changed since
    `93bd378` in them? Name it.
C2. Enumerate EVERY caller of `getEmailSender()`, `consoleEmailSender`,
    `createResendEmailSender`, the `EmailSender` type, `recordEmailAttempt`
    and `AckNotificationOutcome` — search by those names, include
    `scripts/`, include other route groups (CLAUDE.md § Verifying a guard
    covers every path). State the count. Every one must be handled.
C3. Every consumer of the pace cron's JSON and of `AckNotificationOutcome`
    (nothing parses the cron JSON today — confirm).
C4. Confirm the AuditLog query for "one dry-run row per store per month" can
    use `@@index([organizationId, entityType, createdAt])`.
C5. P2's ruling, quoted; which branch of the PRECONDITION applies.
Then the plan: files to touch and why, any NEW fork with your lean. STOP for
Gary's go.

## Phase 2 — BUILD (only after Gary's go)

1. `deliveryMode()` / `sandboxAllows()` in `notify.ts`.
2. Pace alerts: mode before lock; dry-run and sandbox paths; cron `mode`.
3. Acknowledgment: dry-run and sandbox paths; new outcome.
4. Test route: mode in the response; dry-run row; sandbox to caller.
5. Notification log: `email.dryrun`, status, `mode` in metadata.
6. The button.
7. Fixture `scripts/verify-notify5.ts`, against the DEV database:
   - the mode table, every row, by setting env in-process;
   - unknown provider throws; `resend` without key throws in every mode;
   - pace in dry-run: no `PaceAlertLog` row, one `email.dryrun` row; a
     second run the same month writes no second dry-run row; then switch to
     live (capture sender) in the same month → the store alerts and the lock
     is written (**the burn is gone** — this is the check that matters);
   - pace in sandbox: only allow-listed recipients are sent to; no lock;
     empty allowlist → dry-run;
   - ack in dry-run: outcome `dry-run`, no `email.sent` row; sandbox filters
     the list; still never throws when the sender throws;
   - log: `email.dryrun` reads "Dry run — not sent"; a legacy console
     `email.sent` still reads "Logged only"; a provider-less row still reads
     "unknown"; `findAttemptByResendId` never returns a dry-run row;
   - negative control: break one rule (e.g. write the lock before the mode
     check), confirm a check fails, restore.
   Re-run `verify-f5-polish.ts` and `verify-notify-template.ts`; both green
   (update their capture-sender setup only if the mode function requires it,
   and say so).
   Name every fixture org and user `NOTIFY-5 …` (CLAUDE.md § Name every test
   principal) and clean them up at the end.
8. Gate chain, no pipes:
   `npx eslint <touched files> && npm run build > <log> 2>&1 && git commit -F - <<'EOF' … EOF`

## Commits (scope `git add` — never `git add -A`)

- Work commit: code + fixture, after the fixture is green.
- Docs commit: a new **NOTIFY-5** row in `docs/ROADMAP.yaml` (track
  platform, status in_progress → the build's own end state per WORKFLOW),
  an MS-4b **blocker** recording P0 in Gary's words above, a
  `docs/DECISIONS.md` draft (Gary's words exact; your choices separate and
  marked for ratification), CLAUDE.md env lines, the NOTIFY-5 audit file.
  Build after the docs commit (ROADMAP.yaml is typechecked at prebuild).

## Final report

Commits, prisma commands run (expected: none), fixture counts, build,
choices for ratification, findings triage (FIX NOW / RULING NOW / COMMENT /
ROW with counts), and a staging checklist:

- staging-SHA precondition first (CLAUDE.md, two commands);
- Gary sets `NOTIFY_SANDBOX_ALLOWLIST` in Preview to his own address (P2
  only), redeploys staging, confirms the deployment postdates the save;
- the button sends to Gary; the result line says `sandbox`; Recent emails
  shows the row; it arrives (check Junk);
- with a non-allow-listed address in `hrAckRecipients`, signing a test
  document writes "Dry run — not sent" and emails nobody;
- hand-fire the pace cron on staging, with the pace switch on for one test
  org and the allowlist holding only Gary's address — read the JSON `mode`,
  confirm no manager other than Gary was emailed, and confirm no
  `PaceAlertLog` row for the current month on `preview/staging`
  (`br-square-feather-a63z92vz`), branch id selected in the query; turn the
  switch back off;
- as a MANAGER: /settings/notifications still redirects (ADMIN_ONLY).

End with the unpushed-commits line and: "Done and committed. Next:
PRE-PUSH-CHECK for NOTIFY-5." Do not push.
