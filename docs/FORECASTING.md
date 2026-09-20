# Sales Goals & Forecasting (Phase F)

Admins set per-store annual sales goals — seeded from last year's Square sales
or an imported budget — scaled by a percentage, materialized to daily goals,
edited in a 12-month calendar at `/forecasting`, and surfaced on the Dashboard
as a monthly goal with a goal-weighted month-end projection.

## How goals are computed

- **Basis** (per day): last year's net sales, **weekday-aligned** — the basis
  for a 2026 date is the actual on `date − 364 days` (Tuesdays compare to
  Tuesdays). Dates the shift can't cover fall back to the same calendar date
  last year, then to that month's weekday average, then $0.
- **Goal**: `round2(basis × (1 + increasePct/100))`, with each month's rounding
  drift pinned to its last day so month totals match exactly.
- **Overrides**: day edits (dialog) and month-total edits (redistributed by
  basis weight) set `isOverride`; % recalcs preserve them unless "also
  recalculate manually-edited days" is checked. Mid-year raises can apply to
  **remaining days only** — past months keep the goals their actuals were
  measured against.
- **Net sales** = total collected − tax − tips, over **PAID orders** (any order
  with a tender, OPEN or COMPLETED — not CANCELED/DRAFT), **bucketed by
  `created_at`** (the day the order was opened). This mirrors Square's Sales
  Summary exactly: Square counts a sale the moment it's paid, on the day it
  opened. Two things this gets right that the earlier logic didn't:
  - `closed_at` bucketing threw delivery/online orders (opened one day, closed
    the next) into the wrong reporting day → now `created_at`.
  - COMPLETED-only lagged the live day, because auto-accepted delivery orders
    sit OPEN-but-paid until fulfilled → now any paid order counts immediately.
  Verified (Las Brisas): settled days Jul 3–8 reconcile to Square's Net Sales to
  the penny (paid == completed once a day settles; zero paid orders ever stuck
  OPEN), and the live day now tracks Square instead of lagging. Third-party
  delivery (DoorDash/Uber Eats/Grubhub, `OTHER` tender) is counted — Square
  includes it too. Unpaid open tabs/drafts are excluded, as Square does. Actuals
  come from `SalesPeriodCache`; Square is not called on a dashboard/calendar
  read (only the day-drilldown balancing report calls it live).
- **Projection** (Dashboard Monthly Goal card): goal-weighted pacing —
  `projected = MTD actual ÷ MTD goal × month goal` — falling back to run-rate
  when no plan exists. A plan beats the legacy `StoreMonthlyGoal` for its month.
  The formula lives in `src/lib/pacing.ts` (`projectMonthEnd`), shared by the
  Monthly Goal card, `/api/dashboard/summary`, and the all-locations rollup.

## All-locations rollup (F-4)

"All locations" in the Dashboard store picker switches to a company-wide view
backed by `GET /api/dashboard/rollup`: summed today/MTD/month-goal totals plus
a sortable store-ranking table (pace vs MTD goal, projected month end vs goal,
on/behind-pace pill). Scoping is the usual: admins see every active store,
managers see their `storeAssignments`. The rollup projection is the same
goal-weighted formula applied to the **summed** plan totals (DailyGoal rows
summed per store — never averaged); a store with only a manual goal joins the
pool via linear proration (mathematically identical to the card's run-rate
fallback), and a store with no goal at all contributes sales plus a run-rate
projection. Stores without a Square link show "—" for sales but keep their
goal columns.

## Data model

`GoalPlan` (one per store-year: basis type/total, increase %, goal total,
import file URL, last editor) → `DailyGoal` (materialized per-day rows:
`basisAmount`, `goalAmount`, `isOverride`, unique on `storeId+date`).

## API

All under `/api/forecasting/` — reads are ADMIN/MANAGER (managers read-only,
all locations), writes ADMIN-only, enforced server-side:

| Route | What |
|---|---|
| `GET/PUT plan` | Plan meta / create+regenerate (scope: all year or remaining days) |
| `GET basis` | LY basis total + cache coverage for the settings panel |
| `POST backfill` | Resumable LY history sync, one ~2-week chunk per call. `force:true` + `cursor` re-syncs the whole span (basis + this-year actuals) to refresh cached days after a sync-logic change |
| `GET calendar` | Daily goals joined with actuals for the year grid |
| `GET day-report` | Live Square balancing report for one day (gross/discounts/net/tax/tips/total collected, tender split, in-store vs delivery) — the calendar day-drilldown; only route that calls Square live |
| `PATCH day` / `PATCH month` | Overrides (month totals redistribute by weekday weights) |
| `POST import` | CSV/XLSX upload — `commit=0` previews, `commit=1` stores to Blob + regenerates. Daily (`date, amount`) or monthly (`month, amount`) shapes (parsing in `src/lib/forecast-import.ts`) |
| `GET export` | CSV download (`?storeId=&year=` or `&month=yyyy-mm`, `&shape=daily\|monthly`) — columns `date/month, goal, actual, variance`; first two columns round-trip through the importer |
| `GET audit` | Goal-edit history (`?storeId=&month=&limit=`), newest first — admins any store, managers assigned stores only |

After a sync-formula change, existing cached days keep their old numbers until
re-pulled. "Refresh from Square" in Goal Settings (admin) drives `backfill
force` over last year + this year to yesterday; today self-corrects on dashboard
load and the nightly cron covers the last 3 days.

## Hardening (F-5)

- **Goal-edit audit log**: every goal mutation (day override, month
  redistribute, plan regenerate, import commit, legacy manual goal) writes an
  `AuditLog` row via `src/lib/audit.ts` — who (Clerk user id), when, and
  `before → after` dollar amounts in metadata, plus a `period`
  (`yyyy-mm-dd` / `yyyy-mm` / `yyyy`) and `source`. Audit writes never block
  the mutation (failures are logged and swallowed). Read it at
  `GET /api/forecasting/audit` or the "Edit history" panel on `/forecasting`
  (below Goal Settings; refreshes after each edit).
- **CSV export**: "Export CSV" button on `/forecasting` (admins + managers)
  → `GET /api/forecasting/export`. The file's first two columns match the
  import shapes, so an exported year can be re-imported as a basis
  (verified in the fixture).
- **Behind-pace alerts**: daily cron (`vercel.json` → `GET
  /api/cron/pace-alerts` at 15:00 UTC, `CRON_SECRET`-guarded, after the 11:00
  sales-reconcile) checks every store with a current-month plan **whose org has
  pace alerts switched on**. Pace = MTD actual ÷ MTD goal **through yesterday**
  (store-local, complete days only), using the same `month-goal.ts`/`pacing.ts`
  helpers as the dashboard. Below **the org's threshold** it emails org admins +
  the store's assigned managers — **at most one alert per store per month**
  (`PaceAlertLog` unique row is the idempotency lock, migration
  `20260710220000_f5_pace_alerts_audit_index`).
  - **THE THRESHOLD IS PER ORG (NOTIFY-2a, 2026-09-20).**
    `Organization.paceAlertThresholdPct Int?`, migration
    `20260920210000_notify2a_pace_threshold`, set at
    **/settings/notifications** (ADMIN). **`NULL` means fall back** to
    `PACE_ALERT_THRESHOLD_PCT` and then to 90 — which is what every org does
    until someone types a number, so applying the migration moves no behaviour.
    The env var is **not retired** (F1, Gary 2026-09-20); it is the fallback.
    - The cron resolves it from a `Map` built alongside the enabled-orgs query,
      which **replaced** the `organization.count()` that used to compute
      `orgsEnabled` — so per-org thresholds cost no extra round trip. It is a
      Map rather than a relation on the store query because
      `processPaceAlertForStore` is typed `store: Store` and widening that
      parameter would make every caller carry a payload it does not read.
    - **The two validators do not agree, deliberately.** `paceThresholdPct()`
      accepts any finite value in `(0,100]` including fractions; the column is
      `Int` and the write route accepts **50–100** only. A fractional value is
      legal for the FALLBACK and impossible for the ORG value. Nothing sets one.
    - **The run log and the JSON response report the threshold per org**, with
      `source: "org" | "env"` marking a fallback, and orgs named by **ID**
      (CLAUDE.md § Database Evidence — five rows on staging answer to
      "Microsoft"). The old scalar `thresholdPct` in that response is gone,
      replaced by `fallbackThresholdPct` + a `thresholds` array.
    - **Changing the threshold never rewrites history, and never re-opens a
      spent month.** `PaceAlertLog.thresholdPct` records what was actually used
      per send, and the idempotency lock is keyed on store-month and knows
      nothing about the number — so a store that already alerted at 90 does not
      alert again when the org moves to 75.
  - **The alert is now sent as HTML as well as text (NOTIFY-2b, 2026-09-20).**
    `src/lib/email-template.ts` renders the branded body; the alert goes out
    multipart, and a client that wants plain text still gets it.
    - **THE TEXT PART DID NOT CHANGE — not a word, not a space.** The template
      is given the consumer's existing lines verbatim rather than regenerating
      them, because the pace alert's wording is not a two-column table (its
      `Month to date:` and `Dashboard:` lines are prose with a single space
      after the colon) and the template's own row format cannot reproduce them.
      `scripts/verify-f5-polish.ts` pins all seven lines, the line count and
      the two label prefixes, so editing that builder fails the fixture.
    - **The pace path now writes an `AuditLog` row per send** — `entityType
      "Notification"`, `action email.sent | email.failed`, `metadata {kind:
      "pace.alert", provider, recipients, subject, resendId | error}` — which
      it did not before. `PaceAlertLog` is unchanged and is still the
      idempotency lock; it is not a log, carries no provider and has no failure
      rows, so it could not feed the "Recent emails" card on
      `/settings/notifications` or give a Resend delivery event an org to
      attach to. The row is written AFTER the send, never before: the lock is
      the thing that precedes the send, and this is a record of what happened.
    - **The org name costs one extra query, on the alert path only.**
      `processPaceAlertForStore` is typed `store: Store` and stays that way
      (NOTIFY-2a's reasoning), so the template's header reads the name
      directly — at most once per store per month, by construction.
  - **The per-org switch (F-5b, 2026-09-20)**. `Organization.paceAlertsEnabled`,
    **default `false`**, migration `20260920190000_f5b_pace_alerts_toggle`.
    Toggled at **/settings/notifications → Behind-pace alerts** (ADMIN) via
    `PUT /api/pace-alerts/settings` — NOTIFY-2a moved the card off `/settings`
    and replaced `POST /api/pace-alerts/toggle`, which is deleted. The body is
    partial (`{ enabled? , thresholdPct? }`), so the switch and the threshold
    cannot clobber each other. No availability env var — F-5 shipped to
    every org and was never a staged rollout, so **the column is the only
    gate**, exactly as with `calendarEnabled`.
    - **The gate is in the cron's store query, not a per-store early return**,
      and that is load-bearing: a disabled org's store is never evaluated, so
      nothing reads its goal, nothing writes a `PaceAlertLog` row, and **its
      one-alert-per-month lock cannot be burned while the org is dark**. An
      early return placed after the lock write would do the opposite.
    - **Why the default is `false`, since it is the safety argument rather than
      a convention.** These are the only emails Froot sends to MANAGERS, and
      they share a sender with HR-16. A default of `true` would make setting
      `NOTIFY_EMAIL_PROVIDER=resend` in Production start mailing real managers
      as a side effect of a change made for a different feature.
    - **Neither edge of the toggle touches a `PaceAlertLog` row.** Disabling
      keeps this month's sent rows, so re-enabling mid-month does not re-send an
      alert the managers already got; enabling writes nothing, and the next run
      evaluates on the numbers as they are that day.
    - Each run logs **orgs enabled / stores evaluated / alerted / skipped**, and
      the skipped count is measured rather than inferred — "the gate suppressed
      12 stores" and "no store qualified this month" are otherwise
      indistinguishable.
  - **Lock → send → release on failure (DEBT-105, fixed by F-5b).** The
    `PaceAlertLog` row is still written **before** the send, so a crash or a
    concurrent run cannot double-alert. What F-5b added is the **release**: the
    send is wrapped, and on a throw the row just created is deleted and the
    error rethrown, so the cron's per-store catch still records `error:` and the
    run continues. The next day's run then re-evaluates the store from scratch.
    A double-alert stays impossible, because a send that **succeeds** leaves the
    row exactly where it always was.
    - **The delete is BY ID, never by the `{storeId, month}` unique key.** A
      delete by key would destroy whichever row is present — on a concurrent run
      that is the **winner's** row, the one whose mail is in flight. The id
      captured from the `create` can only ever name the row that call made. **Do
      not "simplify" this to a `deleteMany` on the unique key.**
    - A release that itself fails is logged and swallowed so it cannot mask the
      send error; that degrades to the pre-F-5b behaviour and no worse.
    - Before this fix, one runtime send failure burned a store's
      one-alert-per-month lock and the next day's run reported the reassuring
      "already alerted this month" for a mail that never left.
  - **Recipients are unchanged, and carry a known gap — `DEBT-106`.** Admins +
    the store's assigned managers, as before. A departed **manager** drops out
    (the Clerk webhook deletes their `StoreUserAssignment` rows, which that arm
    of the query requires); a departed **admin does not**, because the ADMIN arm
    has no assignment test and `User` has no status column. F2 (Gary,
    2026-09-20) ruled the fix belongs in the Clerk webhook handler rather than
    here, so **do not add a filter to this query** — see `DEBT-106` and
    `DEBT-47`.
  - **Email delivery — two providers since NOTIFY-1 (2026-09-19)**.
    `src/lib/notify.ts` still hands every caller an `EmailSender` from
    `getEmailSender()`; what changed is that there is now something real
    behind it. The choice is per-environment, by `NOTIFY_EMAIL_PROVIDER`:
    - unset or `"console"` → `consoleEmailSender`, exactly as before.
    - `"resend"` → Resend over plain `fetch` to `https://api.resend.com/emails`
      (no SDK — one fewer package to audit). Requires `RESEND_API_KEY` and
      `NOTIFY_FROM_EMAIL` (`USE Froot <noreply@notify.usefroot.com>` — the
      sending domain is a **subdomain**, never the root). **Either one missing
      throws, and it NEVER falls back to console**: a deployment that believes
      it is emailing and is not is the exact failure this provider exists to
      end. Both are read in `getEmailSender()` rather than at send time, so
      the pace-alert cron fails before it writes a single `PaceAlertLog` row —
      a throw after that write would burn a store's one-alert-per-month lock
      with no email delivered. Ten-second `AbortController` timeout, so a hung
      provider can't hold the cron open. A non-2xx logs the status and body
      and then **throws** — nothing is swallowed, the caller decides.
    - any other value → throws, naming the value and the two accepted ones.
    - **Proving delivery**: `POST /api/notify/test` (ADMIN, no request body).
      The recipient is the CALLER'S OWN Clerk primary email, resolved
      server-side — there is deliberately no way to aim it at anyone else.
      Returns `{ provider, to, ok: true, id? }`, or 502 with the thrown
      message. In console mode it returns `ok: true` with
      `provider: "console"`; that is correct behaviour, not a bug.
    - **`NOTIFY_EMAIL_PROVIDER` is per-environment, and Production is the
      loaded one.** Setting it to `resend` in Production is what makes this
      daily cron start emailing real managers about real numbers. That is a
      separate, deliberate decision — not a side effect of shipping the code.
    The original F-5 note, still accurate for the default, unchanged:
    `src/lib/notify.ts` is a thin, swappable sender. Current default is the
    **console sender** — alerts appear in Vercel function logs, no email
    actually leaves. To go live, implement a provider in `getEmailSender()`
    (e.g. Resend via fetch) — callers don't change.

## Ops

- **Square order webhooks** (F-4): `POST /api/webhooks/square` receives
  `order.created`, `order.updated`, `payment.created`, `payment.updated` and
  re-pulls the affected store's local day through `sales-sync.ts`, keeping the
  Dashboard's "today" fresh in near-real-time. Store resolution is
  `location_id → Store.squareLocationId`; a re-sync is skipped when the day's
  cache was already synced after the event was emitted (burst absorber). The
  handler ACKs immediately and does the work after the response; processing
  failures are only logged — the 15-min lazy dashboard sync and the nightly
  reconcile remain the fallback/source of truth, so webhooks never need to be
  perfect, just fresh. Requests are verified against Square's HMAC-SHA256
  scheme (`x-square-hmacsha256-signature` over notification URL + raw body,
  `src/lib/square-webhook.ts`); anything unverified gets a 401.
  - **Setup (per Square app — production and "Froot Staging" each have their
    own)**: Square Developer Dashboard → your app → Webhooks → Subscriptions →
    Add subscription with notification URL
    `${NEXT_PUBLIC_APP_URL}/api/webhooks/square` (must match that env's
    `NEXT_PUBLIC_APP_URL` exactly — the handler derives the signed URL from it)
    and event types `order.created`, `order.updated`, `payment.created`,
    `payment.updated`. Copy the subscription's **Signature key** into the
    `SQUARE_WEBHOOK_SIGNATURE_KEY` env var in Vercel for that environment.
    Without the env var the route returns 500 and Square will keep retrying.
  - No new OAuth scope needed — the resync reads orders via the existing
    `ORDERS_READ` grant.
- **Nightly reconciliation**: `vercel.json` cron hits
  `GET /api/cron/sales-reconcile` at 11:00 UTC — re-pulls the last 3 days per
  Square-linked store (all orgs) to absorb late refunds/edits. Public in
  `src/proxy.ts`; authenticates via `Authorization: Bearer ${CRON_SECRET}`.
- **⚠ Deploy requirement**: set `CRON_SECRET` in Vercel (Production +
  Preview) — Vercel automatically sends it on cron invocations. Without it the
  route refuses to run (500).
- **Backfill**: driven from the Goal Settings panel ("Import <year> sales from
  Square") — the client loops the chunk endpoint with a progress bar. Serial,
  idempotent, resumable.
- **Fixtures**: `npx tsx scripts/verify-goal-engine.ts` (goal math),
  `npx tsx scripts/verify-f4-rollup-webhook.ts` (rollup + webhook),
  `npx tsx scripts/verify-f5-polish.ts` (audit log, export round-trip,
  pace-alert thresholds/dedupe) — each seeds throwaway data and cleans up.

## Deferred

Real email provider for pace alerts (console sender ships first — pick
Resend/SMTP and implement `getEmailSender()`), move jobs to Inngest/QStash
before external merchants onboard.
