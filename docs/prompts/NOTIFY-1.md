Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/NOTIFY-1.md and execute it.

# NOTIFY-1 — Real email delivery via Resend

**TIER 2 — contained code change.** No schema, no migration, no permission
changes, no new nav. Brief audit of the one file and its callers, then build.
No stop gate unless the audit contradicts this prompt.

**Save to:** `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/NOTIFY-1.md`
**Branch:** `staging`. Commit only — never push.
**Today:** 2026-09-19.

Read `/Users/garythomas/Claude_Projects/Froot/froot/CLAUDE.md` first. Run every
command one at a time. No `&&` chains. Never `git add -A`. `npm run build`
gates every commit. Report every `prisma` command verbatim, or "No prisma
commands run." (This session should print the second.)

---

## Why this session exists

`src/lib/notify.ts` is a swappable email sender with exactly one
implementation: a console logger. Nothing has ever left the building. That
single gap is the live blocker on **F-5** (pace alerts email into the void
every day in production), **HR-16** (signed-acknowledgment confirmations —
cannot start), and **HR-8** (reminders), and the CAL track's overdue
reminders will want it next. This session wires Resend behind the existing
interface. Callers do not change.

Ruled in chat 2026-09-19: Resend, not SMTP. Env-var configuration only — no
org-level settings table yet; HR-16 adds that when it needs it. Sending
domain is a subdomain (`notify.usefroot.com`), never the root.

## Step 1 — Audit (brief; report before building)

Read `/Users/garythomas/Claude_Projects/Froot/froot/src/lib/notify.ts` in
full. Then:

```
grep -rn "notify" /Users/garythomas/Claude_Projects/Froot/froot/src --include=*.ts --include=*.tsx -l
```

Report:

1. The exact sender interface (function name, argument shape: to / subject /
   text / html / replyTo — whichever exist).
2. Every caller, file:line, and whether each one catches a thrown send error
   or lets it propagate. The pace-alert cron is the known one; there may be
   others.
3. The documented env var name and the current default.

If the file is materially different from "one console sender, one
`getEmailSender()` returning it unconditionally," STOP and report before
writing code. Otherwise continue.

## Step 2 — Build

All in `/Users/garythomas/Claude_Projects/Froot/froot/src/lib/notify.ts`
unless noted.

**Provider selection.** `getEmailSender()` reads `NOTIFY_EMAIL_PROVIDER`:

- unset or `"console"` → the existing console sender, unchanged.
- `"resend"` → the new Resend sender.
- anything else → throw at first call with a message naming the value and the
  two accepted ones.

**Resend sender.** Plain `fetch` to `https://api.resend.com/emails`, no SDK
dependency (one fewer package to audit). Reads:

- `RESEND_API_KEY` — required when provider is `resend`. **If missing, throw
  a descriptive error. Never fall back to console.** A production deploy
  that thinks it is emailing and isn't is the exact failure this row exists
  to end.
- `NOTIFY_FROM_EMAIL` — required when provider is `resend`. Expected form:
  `USE Froot <noreply@notify.usefroot.com>`. Same rule: missing → throw.

Request body: `from`, `to` (accept string or string[]), `subject`, `text`,
`html` if the interface carries it, `reply_to` if a replyTo is supplied. If
the current interface has no `replyTo`, add it as an optional field —
additive, callers unaffected. HR-16 will use it so a manager who hits Reply
reaches their own office, not us.

Response handling: on 2xx, log one line with the Resend message `id`. On
non-2xx, log the status and the response body, then **throw**. Do not
swallow — the caller decides. Check Step 1's finding: if the pace-alert cron
does not already catch per-store send errors, wrap its send call so one
bad address cannot abort the loop for every other store. That is the only
caller change permitted, and only if the audit shows it is needed.

**Timeout.** 10-second `AbortController` on the fetch. A hung email
provider must not hold a cron open.

**Test route.** New file
`/Users/garythomas/Claude_Projects/Froot/froot/src/app/api/notify/test/route.ts`:

- `POST`, `requireAdmin()`. No body — the recipient is **the caller's own
  Clerk primary email**, never a user-supplied address. This exists so Gary
  can prove delivery on staging without a way to email arbitrary people.
- Sends a short plain-text message: subject `USE Froot test — <ISO
  timestamp>`, body naming the provider in use and the deployment
  (`VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA` short).
- Returns `{ provider, to, ok: true, id? }` on success; on failure returns
  502 with the thrown message. Console mode still returns `ok: true` with
  `provider: "console"` — that is correct behaviour, not a bug.

**`.env.example`** — add the three variables with one-line comments. Note
that `NOTIFY_EMAIL_PROVIDER` is per-environment and that setting it to
`resend` in Production makes the daily pace-alert cron start emailing real
managers.

**Docs** — in
`/Users/garythomas/Claude_Projects/Froot/froot/docs/FORECASTING.md`, the
"Email delivery" bullet under Hardening (F-5) now describes both providers
and the env vars. Prepend, don't rewrite.

## Step 3 — Commit (two-commit pattern)

Commit 1 — work. Stage only `src/lib/notify.ts`, the test route, and the
cron file if Step 2 touched it, plus `.env.example`:

```
feat(NOTIFY-1): Resend email sender behind getEmailSender(); admin test route
```

Commit 2 — docs, citing commit 1's SHA. Stage only `docs/FORECASTING.md`,
`docs/ROADMAP.yaml`, `docs/prompts/NOTIFY-1.md`:

In `docs/ROADMAP.yaml`, add a phase row:

```
- id: NOTIFY-1
  track: platform
  size: S
  status: in_progress
  commits: [<WORK_SHA>]
  title: "Real email delivery — Resend behind src/lib/notify.ts, admin test route"
  notes: >
    Built 2026-09-19. Env-var configuration only (NOTIFY_EMAIL_PROVIDER,
    RESEND_API_KEY, NOTIFY_FROM_EMAIL); org-level recipient settings are
    HR-16's job. Fail-closed: provider=resend with a missing key or from
    address throws, never falls back to console. Clears the shared blocker on
    F-5, HR-16 and HR-8 ONCE STAGING DELIVERY IS PROVEN — those blocker
    entries are flagged resolved in the PRE-PUSH-CHECK/docs pass that
    records the evidence, not here.
```

Do **not** touch the F-5 or HR-16 blocker entries in this session. They
close on evidence, not on a build. PRE-PUSH-CHECK flips this row to
`staging` when Gary pushes.

```
docs(NOTIFY-1): roadmap row, FORECASTING email-delivery note (work <WORK_SHA>)
```

## Report format

1. Audit findings (interface, callers with error handling, env var).
2. Whether the cron needed the per-store wrap, with file:line.
3. Both commit SHAs.
4. `npm run build` result.
5. **Prisma commands run:** verbatim list or "No prisma commands run."

## Out of scope

- Any org-level settings UI or schema (HR-16).
- Delivery webhooks from Resend into AuditLog (worth a follow-on row; note it
  as ROW in the report, do not build).
- Per-merchant sending domains.
- Touching HR-16, HR-8, F-5 code.

---

## Before the staging test — Gary's side (not for Claude Code)

Do these once, in this order, before pushing staging.

1. **Resend account** at resend.com. Add domain `notify.usefroot.com`.
2. **GoDaddy DNS** for usefroot.com: add the SPF (TXT), DKIM (TXT) and
   DMARC (TXT) records Resend shows for that subdomain, exactly as given.
   Wait for Resend to show the domain **Verified** (minutes to an hour).
3. **API key** in Resend, name it `froot-preview`. Store it in the password
   manager next to CRON_SECRET.
4. **Vercel → Environment Variables, Preview scope only** (leave Production
   alone for now):
   - `NOTIFY_EMAIL_PROVIDER` = `resend`
   - `RESEND_API_KEY` = the key
   - `NOTIFY_FROM_EMAIL` = `USE Froot <noreply@notify.usefroot.com>`
5. Push staging. From a signed-in ADMIN session (Karson), `POST
   /api/notify/test` from the browser console or a REST client. Expect an
   email in that account's inbox within a minute and the message visible in
   the Resend dashboard with status Delivered. Screenshot both — that is the
   evidence that clears the F-5/HR-16 blocker.
6. **Do not** run the pace-alerts curl on staging as part of this test.
   Staging carries real manager addresses and would email real people about
   fake numbers. The test route is the proof; the cron is proven in
   production later.
7. Production stays on `console` until you decide to turn on real pace
   alerts. That is a separate, deliberate step: a second key named
   `froot-production`, the three vars on Production scope, and a look at the
   next day's cron log.
