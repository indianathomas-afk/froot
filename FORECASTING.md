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
- **Net sales** = total collected − tax − tips (matches Square's "Net Sales").
  **Third-party delivery orders (DoorDash, Uber Eats, Grubhub, Orda, …) ARE
  counted** — delivery revenue is intentionally in the goal metric, so Froot's
  number is higher than Square's Sales Summary "Net Sales" (which excludes
  marketplace orders Square doesn't collect). Compare Froot against a Square
  report that includes all orders, not the Sales Summary. Actuals come from
  `SalesPeriodCache`; Square is never called on a dashboard/calendar read.
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
| `POST backfill` | Resumable LY history sync, one ~2-week chunk per call |
| `GET calendar` | Daily goals joined with actuals for the year grid |
| `PATCH day` / `PATCH month` | Overrides (month totals redistribute by weekday weights) |
| `POST import` | CSV/XLSX upload — `commit=0` previews, `commit=1` stores to Blob + regenerates. Daily (`date, amount`) or monthly (`month, amount`) shapes |

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
