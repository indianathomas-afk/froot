TIER 3 session (lean; Gary declares it). Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/2026-10-19_NOTIFY-11_r2_sweep_and_label.md and execute it. Repo gate first, one command at a time. Stop where it says stop.

# NOTIFY-11 — R2 enforced: the sweep never sends in sandbox; dry-run rows name the real provider

Lean TIER 3: this changes what the notification dispatcher sends and writes,
on the hourly cron path. **No schema expected.** Audit → plan → STOP for Gary →
build → commit. Commit only. Never push. Never run a migration. If the work
turns out to need a column, STOP and say so. That makes it a schema phase.

Written 2026-10-19 by the NOTIFY-5/NOTIFY-6 acknowledgment investigation, on
Gary's instruction in that session. His words, exactly:

> *"File the R2 gap as FIX NOW for a small follow-up phase: the sweep must
> never make a first send in sandbox, matching my R2 ruling ("the hourly retry
> never sends in sandbox"), with a fixture check and a negative control.
> Include the Recent emails label fix (dry-run rows shouldn't show provider
> "console" when resend is configured)."*

Once committed, this prompt is a claim of record and is not edited. If
something in it is wrong by the time it runs, say so in the audit. Don't work
around it.

## Why this phase exists (plain English)

On 2026-10-19 Gary signed a test document on staging. The acknowledgment
email to gary@kevajuice.com showed in Recent emails as "Dry run — not sent",
provider **console**. The cause was configuration: `NOTIFY_SANDBOX_ALLOWLIST`
had never been created in Vercel, so the sandbox held his address back. Two
things in the code made that harder to see, or would make it worse next time:

1. **The label was misleading.** Every dry-run message row is written with
   provider `"console"` (`src/lib/notifications/dispatch.ts:616`). Resend
   *was* configured: the matching AuditLog row recorded `provider: resend`,
   `mode: sandbox`. But the card said "console", which reads as "email is
   switched off in this environment", the wrong diagnosis.
2. **R2 is not enforced as ruled.** Gary's R2, ratified in `a7fed5f`: "R2 —
   the hourly retry never sends in sandbox". The dispatcher's sandbox branch
   skips a recipient on `trigger === "sweep"` **only when a sandbox message
   already exists** for that recipient (`dispatch.ts:428`). A first send
   still goes out. Concretely: today's intent `cmvfd7emg000j08jnr89ef48w`
   stays `queued` until 2026-10-26 14:43 UTC. Once the allowlist exists, a
   hand-fired `/api/cron/notify-dispatch` on staging would email it to Gary,
   through the sweep, which R2 forbids. (Vercel runs crons on production
   deployments only, so on staging the sweep runs only when fired by hand.
   Sandbox mode exists only off production. So today the gap fires only on a
   hand-fire, but it is still a deviation from a ratified ruling.)

Evidence: the NOTIFY-6 row in `docs/ROADMAP.yaml`, the 2026-10-19 STAGING
EVIDENCE block (queries 1–6, branch `br-square-feather-a63z92vz`).

## Read first, in order

1. `docs/ROADMAP.yaml`: the NOTIFY-11 row, then NOTIFY-6 (blockers and the
   2026-10-19 evidence block), then NOTIFY-5's blockers.
2. `docs/DECISIONS.md`: the 2026-10-18 NOTIFY-6 entry (R1, R2, the 18
   choices) and the NOTIFY-5 entry (choice 4: "Every hand-fire on staging
   re-sends to the allow-listed addresses").
3. `src/lib/notifications/dispatch.ts`: the header comment (lines 14–29),
   `dispatchOne` (mode per recipient, the dry-run and sandbox branches) and
   `writeMessage`.
4. `src/app/api/cron/notify-dispatch/route.ts`: its header comment claims the
   staging run "only expires stale intents and writes nothing else". Check
   whether that is true (it is not for a never-dispatched intent's first
   dry-run row) and correct it.
5. `src/lib/notification-log.ts`: `listRecentEmails` (the pipeline half) and
   `recordEmailAttempt`, which already stamps the configured provider and
   mode on the parallel AuditLog row.
6. `src/app/(app)/settings/notifications/recent-emails.tsx`: how status,
   detail and provider render.
7. `scripts/verify-notify6.ts` section B (the sandbox checks, including
   "B sandbox (R2)"), plus every check in `verify-notify5.ts`,
   `verify-notify6.ts` and `verify-f5-polish.ts` that asserts a dry-run row's
   provider.

## What to build

### (a) R2: the sweep never sends in sandbox

In `dispatchOne`'s sandbox branch: when `trigger === "sweep"`, **never send**,
whether or not a sandbox message already exists. Record the recipient as
`skipped` with a reason naming R2. A producer dispatch (signing, test button,
hand-fired pace cron) still sends: NOTIFY-5 choice 4 is unchanged.

Lean, for the audit to confirm or reject:
- **Withheld (non-allow-listed) recipients on a sweep:** unchanged. A dry-run
  row is a log line, not a send, and is still written at most once per
  (intent, recipient). Say in the audit whether you agree.
- **The intent's state:** unchanged. Sandbox never moves it (R1).
- Correct the header comments in `dispatch.ts` and the cron route so they
  state what the code now does.

### (b) The label: a dry-run row stops claiming "console" when resend is configured

Lean, for the audit to confirm or reject:
- `writeMessage` writes the **configured** provider (`emailProviderName()`)
  on dry-run rows instead of forcing `"console"`. The row's `mode` and
  `status` (`dry-run`) already say nothing reached a provider, and the reader
  checks those first.
- The reader tells a sandbox-withheld recipient apart from a console-mode dry
  run. In the current mode table a dry-run row with provider `resend` arises
  **only** when the sandbox allowlist held the address back: live never
  dry-runs, and an unknown provider records mode `"unknown"`. **Verify that
  invariant in the code before relying on it**, and name the lines. Then set
  `detail` on such a row to say it was held back by the staging allowlist,
  naming `NOTIFY_SANDBOX_ALLOWLIST`. Status stays "Dry run — not sent". A
  console-mode dry run keeps provider `console` and no detail.
- Rows written before this phase still say `console`. They are records of
  what was written; leave them alone. No backfill.
- Rejected alternative, say if you disagree: deriving the label from the
  parallel AuditLog row's `metadata.mode`. NOTIFY-9 retires those parallel
  writes, so the label would break at that point.
- Grep every reader of `NotificationMessage.provider` (and anything comparing
  it to `"console"`) and list each one in the audit with what it does. Per
  CLAUDE.md § Verifying a guard covers every path, search the field and the
  model, not the helper.

### Fixtures (in `scripts/verify-notify6.ts`, against dev `br-broad-wave-a6vpjdw0`)

New checks, at minimum:
1. **R2 first send.** A fresh `hr.ack` intent in sandbox, one allow-listed
   recipient, no prior message, dispatched with `trigger: "sweep"` → **zero**
   sends, no `sandbox` message row, intent still `queued`.
2. **Choice 4 kept.** The same intent dispatched with `trigger: "producer"`
   → exactly one send.
3. The existing "B sandbox (R2): the SWEEP never re-sends in sandbox" check
   still passes.
4. **Label, sandbox.** A recipient held back in sandbox (provider resend) →
   its message row has provider `resend`, and `listRecentEmails` returns status
   "dry run", provider `resend` and a detail naming the allowlist.
5. **Label, console.** A console-mode dry run → provider `console`, no detail.

**Negative controls, run and reported, not committed:**
- Put the sandbox guard back to its current form
  (`trigger === "sweep" && priorKey.has(...)`) → check 1 must fail. Report how
  many checks fail, then restore.
- Force `"console"` back on dry-run rows → checks 4 must fail. Report the
  count, then restore.

Existing checks that assert `provider === "console"` on a sandbox-withheld
dry-run row are **expectation changes**: adapt them, and list each adapted
check by name in the report. Run `verify-notify5`, `verify-notify6`,
`verify-f5-polish` and `verify-notify-template` at the end and report each
result as passed / failed.

## STOP for Gary

After the audit (written to `docs/prompts/2026-10-19_NOTIFY-11_AUDIT.md`
before you report) and the plan: STOP. Put the two leans above and anything
the audit turned up to Gary. Build only after he answers. Quote his words
exactly; a reply button whose text you wrote is a recommendation he accepted,
not his words (memory: never record planning chat's wording as Gary's ruling).

## Commit

One work commit, gate per CLAUDE.md § Commit Gates (scoped eslint over the
touched files, `npm run build` to a log file, no pipes). Then the docs commit:
the NOTIFY-11 row moves `planned` → `in_progress` with the work SHA, evidence
prepended, preserve-and-mark. PRE-PUSH-CHECK owns the flip to `staging`. Never
push. End with the unpushed-commits line.

## Staging verification (owed after Gary's push; list it, don't run it)

Precondition: `NOTIFY_SANDBOX_ALLOWLIST` exists in Vercel Preview, and staging
was redeployed after the save (the deployment's created time postdates it).
Then the staging-SHA precondition.

1. **R2 on real data.** While intent `cmvfd7emg000j08jnr89ef48w` is still
   `queued` (before 2026-10-26 14:43 UTC), Gary hand-fires
   `/api/cron/notify-dispatch` with `CRON_SECRET` → the response reports 0
   sent for it, no new `sandbox` message row, and no email arrives. **Only
   after NOTIFY-11 is deployed**: on NOTIFY-6 code this hand-fire would send.
2. Sign a NEW test document with `gary@kevajuice.com` allow-listed → one
   email, one message row with mode `sandbox`, status `sent`, provider
   `resend`, zero delivery rows, intent `queued`. This also discharges
   NOTIFY-6 checklist item (3) and the re-opened NOTIFY-5 allowlist blocker.
3. A non-allow-listed hrAckRecipients address → "Dry run — not sent",
   provider `resend`, detail naming the allowlist.

Every query result names branch `br-square-feather-a63z92vz` on the same line
(select `current_setting('neon.branch_id', true)`), and every browser
observation names org `cmr54z65v000105jxczpt72w1`. Note that the Neon console
was on production once during the investigation: check the branch id before
reading any row.

## Not in NOTIFY-11

Not ruled; don't build them: the allowlist parser (comma-only today, while
`hrAckRecipients` accepts commas or newlines), an allowlist status banner on
/settings/notifications, and allowlist fields on the test-send response.
Also out: suppression (NOTIFY-7), tenant onboarding (NOTIFY-8), retiring the
legacy writes (NOTIFY-9).
