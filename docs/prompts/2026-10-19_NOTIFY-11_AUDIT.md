# NOTIFY-11 audit: R2 enforced on the sweep; dry-run rows name the real provider

> **RULED 2026-10-19, added after the audit below; nothing below is edited.**
> Gary, his words exactly: *"Approved (Gary, 2026-10-19, my words): build
> NOTIFY-11 with lean (a) as written, and lean (b) with your change — the
> dry-run label comes from the mode the email was actually dispatched under
> (configured provider only in sandbox, otherwise "console"), plus the extra
> fixture check for a hand-passed mode. Go."* Built in `9f54bd8`; results on
> the NOTIFY-11 row.

Written 2026-10-19 by the NOTIFY-11 session, TIER 3 (declared by Gary in the
session's first line). Prompt:
`docs/prompts/2026-10-19_NOTIFY-11_r2_sweep_and_label.md`.

Repo gate: branch `staging`, clean tree, level with `origin/staging`, HEAD
`754ad1c`. Nothing in this audit touched a database. No query was run, and
nothing was built. **No schema change is needed.** Both fixes are code-only:
(a) changes one condition, and (b) changes one value the existing
`NotificationMessage.provider` column already holds.

The prompt's line references are correct at `754ad1c`: the header comment is
`dispatch.ts:14–29`, the sandbox guard is `dispatch.ts:428`, and the forced
`"console"` is `dispatch.ts:616`. Nothing in the prompt is wrong.

---

## 1. (a) The R2 gap: confirmed, and the fix is one condition

**Code today** (`src/lib/notifications/dispatch.ts:427–436`):

```ts
if (mode === "sandbox") {
  if (trigger === "sweep" && priorKey.has(`sandbox:${r.email}`)) { …skipped… }
  const sent = await sendOne(transport, r.email, rendered)
```

`priorKey` is built from the intent's existing `dry-run`/`sandbox` messages
(`:386–392`). So a sweep skips a recipient **only if a sandbox message already
exists for that recipient**. If none exists, the sweep sends. That is a first
send, and Gary's R2 forbids it ("R2 — the hourly retry never sends in
sandbox", ratified in `a7fed5f`).

A sweep makes a first sandbox send whenever the producer's own dispatch did
not. Three ways that happens:

1. The address was added to `NOTIFY_SANDBOX_ALLOWLIST` after the producer ran.
   This is today's staging case: intent `cmvfd7emg000j08jnr89ef48w`.
2. The producer's inline dispatch threw before reaching that recipient. The
   dispatcher catches the error and records `lastError` (`:236–240`), and the
   intent stays `queued`.
3. The provider was `console` when the producer ran and `resend` at the sweep.

**Fix.** On `trigger === "sweep"`, sandbox never sends. The guard drops its
`priorKey` term, and the reason names R2. A producer dispatch (signing, test
button, the pace cron, a hand-fired pace cron) is untouched, so NOTIFY-5
choice 4 still holds.

**Who calls with which trigger** (all four call sites):

| Caller | Trigger | Affected? |
|---|---|---|
| `src/app/api/cron/notify-dispatch/route.ts:37` (the hourly sweep) | `sweep` | yes: this is the fix |
| `src/lib/hr-ack-notification.ts:171` (signing) | `producer` | no |
| `src/lib/pace-alerts.ts:160` (pace cron, inline) | `producer` | no |
| `src/app/api/notify/test/route.ts:103` (test button) | `producer` | no |

**Production is unaffected.** The sandbox branch is reachable only when
`transport.mode === "sandbox"` (`modeFor`, `:376–381`). `deliveryMode()`
returns sandbox only when `VERCEL_ENV !== "production"` (`src/lib/notify.ts:185–191`).

**Lean 1, withheld recipients on a sweep: I agree, unchanged.** A dry-run row
is a log line, not a send. Skipping it on the sweep would hide a never-logged
withheld recipient until the next producer run. The once-per-(intent,
recipient) rule (`:410`) already stops the sweep repeating it.

**Lean 2, the intent's state: I agree, unchanged.** `:454–457` returns before
`finalize` for every non-live transport (R1).

**One consequence, and I accept it.** A `test` intent (kind has
`sandboxBypass`) whose inline dispatch failed is no longer retried by the
sweep in sandbox. Its freshness window is 15 minutes, and the person retries
by pressing the button again. In live mode the sweep still retries it.

### The cron route's comment is false today, and stays partly false after the fix

`route.ts:16–18` says: "On staging this run therefore only expires stale
intents and writes nothing else." On staging, a sweep also writes:

1. **A first sandbox send and its message row.** This is the R2 gap. The fix
   removes it.
2. **A first dry-run row** for any withheld or console-mode recipient of an
   intent that has never been dispatched. The prompt names this case. It is
   still true after the fix, by design (lean 1).
3. **A `failed` message row with mode `dry-run`** when rendering fails for a
   recipient that has no dry-run row yet (`:414–417`).
4. **`lastError` on the intent** when its dispatch throws (`:239–240`).

The corrected comment says what the sweep now does: it never sends in
sandbox; it expires intents; it writes at most one dry-run log line per
(intent, recipient); it records an error. The `dispatch.ts` header (`:24–29`)
says "never makes a sandbox send", which is true after the fix. It will say
plainly that this covers the first send as well as re-sends, and that it is
enforced by `trigger`, not by prior messages.

---

## 2. (b) The label: lean confirmed, with one amendment

### The invariant, checked at source

The prompt's claim: in the current mode table, a dry-run row with provider
`resend` arises only when the sandbox allowlist held the address back. That is
**true for every production caller**:

- `notify.ts:185–191`: `deliveryMode()` returns `console` → `dry-run`;
  `resend` → `live` or `sandbox`, never `dry-run`; anything else throws.
- `dispatch.ts:376–381`: `modeFor` gives `dry-run` only when the transport is
  `dry-run`, or the transport is `sandbox` and the address is not allowed
  (and the kind has no `sandboxBypass`). Live never dry-runs.
- `dispatch.ts:665`: `recordUndispatchable` (unknown provider) writes mode
  `"unknown"`, status `failed`, never `dry-run`.
- All four transports in production come from the environment:
  `resolveTransport()` (`:103–107`) in the sweep, signing and test routes, and
  `deliveryMode()` in the pace cron (`src/app/api/cron/pace-alerts/route.ts:37`).

**But it is not true by construction.** `dispatchOne` reads the provider from
the environment (`:394`, `emailProviderName()`) independently of the mode it
was handed (`transport.mode`). `Transport` is injectable, and the fixtures
inject it. `verify-notify6.ts` runs section B with `NOTIFY_EMAIL_PROVIDER=console`
while passing `transport("sandbox")` (`:232`, `:309`). A caller that passed a
`dry-run` transport while the environment said `resend` would write a dry-run
row with provider `resend`. The reader would then wrongly say "held back by
the allowlist".

**Amendment (my recommendation).** Write the provider from the mode the row was
dispatched under, not from the environment alone:

> dry-run row provider = `transport.mode === "sandbox" ? emailProviderName() : "console"`

Then "dry-run row with a non-console provider" means "sandbox withheld it" for
every caller, fixtures included. In real environments it writes the same
value as the prompt's lean (`resend` in sandbox, `console` in console mode).
It is one expression in `record()`/`writeMessage`, with no new parameter.

### Reader

`listRecentEmails` (`src/lib/notification-log.ts:241–242`) today sets
`status = "dry run"` and no detail. Change: when `m.mode === "dry-run"`,
`m.status === "dry-run"` and `m.provider !== "console"`, detail = "Held back by
the staging allowlist (NOTIFY_SANDBOX_ALLOWLIST)". Status stays "Dry run —
not sent". A console-mode dry run keeps provider `console` and no detail. The
render-failure row (status `failed`, mode `dry-run`) keeps its error as the
detail, because the `failed` branch is checked first.

I key it on `!== "console"` rather than `=== "resend"` so a future second
provider is still labelled correctly. `recent-emails.tsx:145–152` already
renders `detail` and `provider`. **No UI change.**

**No backfill: I agree.** Rows written before this phase stay `console`.

**Rejected alternative (reading the AuditLog row's `metadata.mode`): I agree
it is rejected.** NOTIFY-9 retires those parallel writes. It would also mean
a second query per row.

### Every reader of `NotificationMessage.provider`

I searched for the model (`notificationMessage`, `NotificationMessage`), for
`.provider`, and for `"console"`/`CONSOLE_PROVIDER` across `src/` and
`scripts/`, excluding `src/generated/`.

| Where | What it does with `provider` | Affected? |
|---|---|---|
| `src/lib/notification-log.ts:215, 257` (`listRecentEmails`, pipeline half) | Selects it and passes it through unchanged as `EmailLogEntry.provider` | Yes: the new detail rule goes here |
| `src/app/(app)/settings/notifications/recent-emails.tsx:152` | Renders `e.provider ?? "—"` | Shows `resend` on new sandbox-withheld rows (intended) |
| `src/lib/notifications/dispatch.ts:388–391` (`prior` query) | Selects `to`, `mode` only, not provider | No |
| `src/lib/notification-log.ts:459–461` (`findMessageByProviderId`, webhook) | Uses `providerMessageId`, not provider | No |
| `src/lib/notification-log.ts:335–362` (legacy half) | Reads the **AuditLog** `metadata.provider`, not the message row | No: legacy rows untouched |
| `src/app/api/notify/test/route.ts:108`, `test-send-button.tsx:35–46` | The response's `provider` is `emailProviderName()`, not the row | No |
| `src/lib/notifications/kinds/test.ts:46, 64` | The payload's provider string, in the email body | No |
| `scripts/verify-notify6.ts:291` | Asserts `provider === "console"` on **console-mode** dry-run rows | No: still `console` |

No other code compares a message row's provider to `"console"`.

---

## 3. Fixtures

**Existing checks that need an expectation change: none found by search.** The
only assertion on a message row's provider is `verify-notify6.ts:291`. It is
console mode, so it still holds. No check in `verify-notify5`,
`verify-f5-polish` or `verify-notify6` asserts provider or `detail` on a
sandbox-withheld row. If the run shows otherwise, I will adapt the check and
name it.

**New checks** in `verify-notify6.ts` section B, on dev `br-broad-wave-a6vpjdw0`:

1. **R2 first send.** A fresh hr.ack intent; allowlist = A; first dispatch is
   `"sweep"` → zero sends, no `sandbox` message row, intent `queued`.
2. **Choice 4 kept.** The same intent, then `"producer"` → exactly one send.
3. The existing "B sandbox (R2): the SWEEP never re-sends in sandbox" check
   still passes.
4. **Label, sandbox.** With `NOTIFY_EMAIL_PROVIDER=resend` (VERCEL_ENV unset,
   so the table says sandbox), a withheld recipient's row has provider
   `resend`, and `listRecentEmails` gives status "dry run", provider `resend`,
   and a detail naming `NOTIFY_SANDBOX_ALLOWLIST`.
5. **Label, console.** A console-mode dry run → provider `console`, detail null.
6. **(added, for the amendment)** A `dry-run` transport while the environment
   says `resend` → provider `console`, no detail.

**Negative controls, run and reported, not committed:** restore
`trigger === "sweep" && priorKey.has(…)` (check 1 must fail); force `"console"`
on every dry-run row (check 4 must fail); and, if the amendment is approved,
write `emailProviderName()` without the mode test (check 6 must fail).

Final run: `verify-notify5`, `verify-notify6`, `verify-f5-polish`,
`verify-notify-template`, each reported as passed or failed.

---

## 4. Files to touch

- `src/lib/notifications/dispatch.ts`: the guard at `:428`, the provider at
  `:616` (or `:402`), the header comment at `:24–29`.
- `src/app/api/cron/notify-dispatch/route.ts`: the comment at `:16–18`.
- `src/lib/notification-log.ts`: the detail rule at `:241–242`.
- `scripts/verify-notify6.ts`: new checks, and the header list at `:15`.

No schema, no migration, no UI file, no permission change.

---

## 5. For Gary

1. **Lean (a): build as written?** Sweep never sends in sandbox. Withheld
   dry-run rows and the intent's state stay unchanged. I agree with both.
2. **Lean (b): build with the amendment?** The provider on a dry-run row comes
   from the dispatch's mode (sandbox → the configured provider, otherwise
   `console`), not from the environment alone. The reader's detail names
   `NOTIFY_SANDBOX_ALLOWLIST`. No backfill. The AuditLog alternative stays
   rejected.
3. **Noted, no ruling needed:** the cron route's comment lists three more
   writes than the prompt names. After the fix, the sweep in sandbox no longer
   retries a failed `test` send. Neither changes production.
