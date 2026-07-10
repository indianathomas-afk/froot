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
| `POST import` | CSV/XLSX upload — `commit=0` previews, `commit=1` stores to Blob + regenerates. Daily (`date, amount`) or monthly (`month, amount`) shapes |

After a sync-formula change, existing cached days keep their old numbers until
re-pulled. "Refresh from Square" in Goal Settings (admin) drives `backfill
force` over last year + this year to yesterday; today self-corrects on dashboard
load and the nightly cron covers the last 3 days.

## Ops

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
- **Fixture**: `npx tsx scripts/verify-goal-engine.ts` — seeds a throwaway
  store, asserts alignment/rounding/overrides/redistribution, cleans up.

## Deferred (F-4/F-5 backlog)

Square webhooks for sub-15-minute freshness (today's lazy dashboard sync +
nightly reconcile cover v1), all-locations rollup + store ranking table,
behind-pace alerts, CSV export, goal-edit audit log, move jobs to
Inngest/QStash before external merchants onboard.
