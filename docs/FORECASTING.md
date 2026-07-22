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
  sales-reconcile) checks every store with a current-month plan. Pace =
  MTD actual ÷ MTD goal **through yesterday** (store-local, complete days
  only), using the same `month-goal.ts`/`pacing.ts` helpers as the dashboard.
  Below the threshold (`PACE_ALERT_THRESHOLD_PCT`, default 90) it emails org
  admins + the store's assigned managers — **at most one alert per store per
  month** (`PaceAlertLog` unique row is the idempotency lock, migration
  `20260710220000_f5_pace_alerts_audit_index`).
  - **Email delivery**: `src/lib/notify.ts` is a thin, swappable sender.
    Current default is the **console sender** — alerts appear in Vercel
    function logs, no email actually leaves. To go live, implement a provider
    in `getEmailSender()` (e.g. Resend via fetch) — callers don't change.

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
