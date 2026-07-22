# Weekly Labor Model

> **Numbering:** the sections headed "Foundation ·" below are the pre-reset
> build (the retired 0–4 numbering; the code is shipped and on staging). The
> live roadmap uses the reset **L- numbering** (see `froot_docs` Reset Brief and
> `ROADMAP.md`): L-1 staging pass (done) · L-2 actuals from Square · L-3 Weekly
> Plan report (below) · L-4 assignment layer.

Operators set a labor-percentage target and a position rate legend; a weekly
sales forecast (store + delivery, entered manually) is turned into a
**schedulable-hours budget** and surfaced on the Dashboard. Phase 0 ships the
config foundations (feature flag, models, settings, positions). Phase 1 adds
the budget service and the dashboard cards.

Companion decision brief: `../../froot_docs/UseFroot_Labor_Model_Brief.pdf`.
Build spec: `prompts/Labor_Phase_0-1_Session_Prompt.md`.

## Feature flag (two gates)

Nothing labor-related renders unless **both** are true — the exact HR pattern:

- **Gate 1 (env availability):** `LABOR_MODULE_AVAILABLE=true` in this
  environment. `laborModuleAvailable(clerkOrgId)` in `src/lib/auth.ts` also
  honors `LABOR_INTERNAL_ORG_IDS` (comma-separated Clerk org IDs) so we can
  dogfood in production before global launch. Server-side only — never
  `NEXT_PUBLIC_`.
- **Gate 2 (per-org toggle):** `"labor"` in `Organization.activeModules`,
  flipped by an ADMIN in **Settings → Integrations** (`/api/labor/toggle`,
  Instagram/HR-toggle pattern).

Both gates guard the sidebar "Labor" item, the settings card, the
`/settings/labor` page, every `/api/labor/*` route (404 when a gate is off,
exactly like `/api/hr/toggle`), and the Phase-1 dashboard cards.

## Money convention — DOLLARS as `Decimal(10,2)`

**All Labor money is stored in dollars as `Decimal(10,2)`** (not `Int` cents,
and not `Float`). Rationale:

- **Dollars, to match the codebase.** Every existing money field
  (`SalesPeriodCache.netSales`, `GoalPlan.goalTotal`, `DailyGoal.goalAmount`,
  `StoreMonthlyGoal.goalAmount`, …) is dollars. Labor stays consistent.
- **`Decimal(10,2)`, not `Float`, for exact precision.** The rest of the
  codebase uses `Float`; Labor deliberately upgrades to `Decimal` so the
  labor-budget arithmetic (target %, rounding tiers, blended rates) is exact
  and never drifts by a rounding penny. This is the one place in the schema
  that uses `Decimal` — intentional.
- **Cents↔dollars conversion stays at the Square import boundary.** Square
  returns integer cents; any Labor code that reads Square (Phase 3
  `LAST_YEAR`/`TREND` forecast sources) converts to dollars once, at the
  boundary. Everything downstream is dollars.
- **The budget service (Phase 1) computes internally in integer cents** — it
  multiplies the `Decimal` dollar inputs by 100, does exact integer math for
  the tiered rounding and hour splits, then returns dollars — so the
  acceptance case reproduces to the penny without float error.

Fields: `LaborPosition.defaultHourlyRate`, `LaborSettings.roundingIncrement`
(default `1000.00`), `LaborSettings.plannedBlendedRate`,
`SalesForecast.projectedStoreSales`, `SalesForecast.projectedDelivery`.
`LaborSettings.laborTargetPct` is a percentage `Decimal(5,2)` (default
`20.00`); `impliedWeeklyHours` is an integer hour count.

## Data model (additive · migration `20260720000000_labor0_positions_settings_forecast`)

- **`LaborPosition`** — org-scoped rate legend (Store Manager, ASM, Lead
  Supervisor, Supervisor, Team Member, …). `payType HOURLY|SALARIED`,
  `defaultHourlyRate`, `impliedWeeklyHours?` (40 for salaried, null hourly),
  `isSupervisory` (for the Phase-2 coverage rule), `sortOrder`, `active`.
- **`LaborSettings`** — org default row (`storeId = null`) with optional
  per-store override rows later. `laborTargetPct`, `roundingIncrement`,
  `denominator IN_STORE|TOTAL_WITH_DELIVERY`, `plannedBlendedRate?`. Unique on
  `(organizationId, storeId)`.
  - **Single org-default guarantee:** because Postgres treats NULLs as
    distinct, the composite unique can't stop two `storeId = NULL` rows. A
    **partial unique index** `LaborSettings_org_default_key ON (organizationId)
    WHERE "storeId" IS NULL` enforces it at the DB. This index is **not
    expressible in the Prisma datamodel** (no `WHERE` on `@@unique`), so it
    lives only in the migration SQL — **future `migrate diff` output must
    preserve it; never let a generated diff drop it.**
- **`SalesForecast`** — weekly manual projection. `weekStart DATE`
  (**normalized to Monday on write** so week keys are stable),
  `projectedStoreSales`, `projectedDelivery`, `source
  MANUAL|LAST_YEAR|TREND`, `createdById`. Unique on `(storeId, weekStart)`.

No `WeeklyLaborBudget` table — the weekly budget is **derived on read** by the
Phase-1 service, so there's nothing to keep in sync.

### Why `SalesForecast` is new (not a reuse of Forecasting)

Froot's existing forecasting is annual **goal** planning (`GoalPlan` →
`DailyGoal`, keyed per store-year, no store/delivery split) and Square
**actuals** (`SalesPeriodCache`/`SalesHourlyCache`). Neither is a weekly labor
sales input, so `SalesForecast` is its own model. The `source` enum is the
seam: Phase 1 writes `MANUAL` only; `LAST_YEAR` (from `SalesPeriodCache`) and
`TREND` (from `DailyGoal`) are Phase 3.

## RBAC

- **ADMIN + MANAGER** — read and write settings, positions, and (Phase 1)
  forecasts, via `requireLaborContext` in `src/lib/labor-access.ts`. This
  differs from Forecasting (writes ADMIN-only) — a deliberate Labor v1
  decision.
- **Module on/off toggle is ADMIN-only** (`/api/labor/toggle`), matching the
  HR add-on precedent (enabling a paid add-on is a billing-adjacent action).
  *Note: the spec listed the toggle under an ADMIN/MANAGER heading; we scoped
  it to ADMIN to match HR — flag for Gary if managers should self-enable.*
- **STORE / STAFF** — read-only dashboard cards only (Phase 1); no settings,
  positions, or `/api/labor/*` access.

## API (`/api/labor/`)

| Route | Method | Who | What |
|---|---|---|---|
| `toggle` | POST | ADMIN | Flip `"labor"` in `activeModules`; seeds default positions on first enable |
| `settings` | GET / PUT | ADMIN+MANAGER | Read / upsert the org-default `LaborSettings` (find-then-update; the partial index guarantees one default) |
| `positions` | GET / POST | ADMIN+MANAGER | List / create positions |
| `positions/[id]` | PATCH / DELETE | ADMIN+MANAGER | Edit / hard-delete a position (UI suggests "mark inactive" to keep history) |

## Seeding

A new org gets the default rate legend the moment an admin enables the module
(`seedDefaultLaborPositions`, idempotent — only seeds when the org has zero
positions). The defaults mirror the brief's acceptance seed (SM $20 salaried
40h, ASM $18 salaried 40h, Lead $15, Supervisor $13, Team $12) so a fresh org
is immediately usable. Backfill existing orgs with
`npx tsx scripts/seed-labor-positions.ts [orgDbId]`.

## Config surfaces

- **Settings → Integrations** (`/settings`, ADMIN): Labor card with the on/off
  toggle + a link to the config page (both gated on availability).
- **`/settings/labor`** (ADMIN + MANAGER): the config hub — budget settings
  form (target %, rounding, denominator, optional blended rate) + positions
  CRUD (add/edit dialog, delete behind an `AlertDialog`). Reachable from the
  sidebar "Labor" item and the settings card.

## Budget calculation

`computeWeeklyLaborBudget({ settings, positions, forecast })` in
`src/lib/labor-budget.ts` is a **pure function** (no DB) so it's unit-testable.
Inputs are dollars; it converts to integer cents internally, does exact integer
math for the tiered rounding / hour splits, then returns dollars — so the
acceptance case reproduces to the penny. Returns `null` when `forecast` is null
(the caller renders the empty state).

**Conservative-rounding rule (locked 7-20):** round the sales basis **down to
the nearest tier** — `floor(basis / roundingIncrement) * roundingIncrement`.
A basis already on a tier boundary stays there; there is **no full-step-down**.

**Acceptance case** (`scripts/verify-labor-budget.ts`,
`npx tsx scripts/verify-labor-budget.ts`): store $14,900 / delivery $0, target
20%, rounding $1,000, blended $12.50, SM+ASM salaried $20/$18 @40h, Lead/Sup/
Team hourly $15/$13/$12 → conservative $14,000, budget $2,800, salaried
$1,520/80h, hourly $1,280/102.0h, **total 182.0h, projected 18.8%**
(`2,800 / 14,900`). The script also asserts the null-forecast (empty) state and
the `floorExceedsBudget` flag (salaried floor > budget → hourly clamps to 0).

## Foundation · budget + dashboard surfaces

- **Forecast entry** (ADMIN/MANAGER): `/api/labor/forecast` upserts on
  `(storeId, weekStart)` with `weekStart` normalized to Monday; store and
  delivery entered separately, `source = MANUAL`.
- **Labor Budget hero card** (Dashboard, both gates): total schedulable hours,
  projected-labor-% gauge vs target (green ≤ target / amber near / red over),
  conservative tier + buffer, and a `floorExceedsBudget` warning state. Empty
  state ("Set projected sales") when no forecast exists for the week.
- **Labor Coverage card** (Dashboard, "Recommended · guidance"): a headcount
  step line beneath Sales Performance, demand shape reused from the Sales
  Performance hourly source, single headcount y-axis.

## Out of scope (later phases)

Daily shift templates + min-staffing coverage engine (Phase 2) · Square-driven
forecasting (Phase 3) · actual labor from Square Timecards, per-employee wages,
push-to-Square scheduling, OT modeling (Phase 4). Per-employee rate overrides
and per-store `LaborSettings` overrides are also later. Clean seams left; not
implemented.

## Foundation · daily split, daypart, adjustment, coverage engine (built 2026-07-20)

Migration `20260720230000_labor2_daysplit_daypart_adjustment` — additive:
`LaborDaySplit`, `LaborDaypart`, `LaborDayAdjustment`.

- **Total sales only.** The in-store/delivery split is gone — the budget basis
  is one total number (delivery is already in Square net sales). `LaborSettings.
  denominator` and `SalesForecast.projectedDelivery` are **deprecated**: the
  columns remain (no drops) but are never read/written and are removed from the
  UI. `computeWeeklyLaborBudget` now takes `forecast: { total }`.
- **Auto-forecast.** `getWeeklyForecast(storeId, weekStart)` returns the week's
  total: a `MANUAL` `SalesForecast` override if present, else the sum of the
  Forecasting module's `DailyGoal` for Mon–Sun (`TREND`) — so the Budget card
  shows a number with no data entry. The empty state appears only when there's
  neither a manual row nor any `DailyGoal`. The manual dialog is now an override
  ("Revert to auto" clears it).
- **Weekly→daily split.** `splitWeeklyHoursToDays` (pure) distributes the weekly
  **hourly** hours across days by `LaborDaySplit.weightBps` (auto-seeded from
  trailing sales, editable per store on `/settings/labor`, "reset to
  sales-derived"). **Salaried hours are a weekly constant — never split.**
- **Per-day adjustment.** `applyDayAdjustment` (pure) + `LaborDayAdjustment`
  (unique `storeId+date`, `adjustmentPct` ±%, `reason`) scales a day's **hourly**
  hours only; salaried untouched. Set from the Coverage card ("Adjust for
  weather"); the Budget hero shows the adjusted weekly total + a chip per
  adjusted day.
- **Min-staffing coverage engine.** `computeDailyCoverage` (pure) turns the
  adjusted day hours + demand shape into an integer step line satisfying: floor
  of 1 while open, per-`LaborDaypart` `minHeadcount`, and a supervisor rule
  (`requiresSupervisor` + `LaborPosition.isSupervisory`). Operating window from
  `StoreHours` (dayOfWeek 0=Sun; falls back to demand-shape inference). Flags
  `exceedsDayHours` and `supervisorShortfall` (never throws). Org-default
  dayparts (Opening/Midday/Closing) seed on module enable; CRUD on
  `/settings/labor`. The Coverage card shows per-daypart min badges + a
  supervisor indicator, still "Recommended · guidance", single headcount axis.

Fixtures: `npx tsx scripts/verify-labor-budget.ts` (total-only budget,
182h/18.8%), `npx tsx scripts/verify-labor-coverage.ts` (split, adjustment,
coverage invariants). Existing orgs backfill dayparts via
`scripts/seed-labor-positions.ts` (or by re-toggling the module).

## Foundation · per-store settings, demand-shaped coverage, GM on floor (built 2026-07-20)

Migration `20260721010000_labor3_gm_onfloor_window` — additive: two nullable
`Int` columns on `LaborSettings` (`gmOnFloorStartMinutes`/`gmOnFloorEndMinutes`).

- **Per-store settings.** `resolveLaborSettings(org, store)` — the store's
  `LaborSettings` row wins field-by-field over the org default (storeId null) →
  schema defaults. Budget + coverage read the resolved row. Editor on
  `/settings/labor` has a scope picker (Organization default / each store) with
  "revert to org default"; stores roll up to the org as before.
- **Only the GM is salaried.** Default positions re-seeded to one salaried
  **General Manager** + hourly ASM/Lead/Supervisor/Team.
- **Coverage is demand-shaped + budget-capped** (`computeDailyCoverage`
  rewritten). Headcount follows the hourly sales shape (largest-remainder so the
  integer heads sum to the budget — no over-allocation), floored at 1 while open
  (opener/closer). **No fixed daypart minimums.** The **salaried GM counts on
  the floor** in their window (`gmOnFloor*`, default open→14:00) as a body +
  the supervisor; `hasHourlySupervisor` covers the rest. Flags
  `understaffedBudget` (floor-1 exceeds budget) and `supervisorGap`.
- **Future / 4-week forward scheduling.** Coverage renders future days; the
  demand shape for a future day is the **average of the same weekday over the
  last 4 weeks** of `SalesHourlyCache` (falls back to inference). Budget +
  Coverage cards share a **day/week navigator** (`use-labor-date.ts`, this week
  … +4).
- **`LaborDaypart` slimmed** — used only for named supervisor windows; the
  `minHeadcount` column is retained but dropped from the UI and ignored by the
  engine.
- The **"adjusted from N"** hero label now shows only when a real
  `LaborDayAdjustment` exists (not on daily-split rounding drift).

Fixture: `npx tsx scripts/verify-labor-coverage.ts` covers demand-shape,
opener/closer floor, GM on floor, budget cap, and the supervisor gap. Decisions
in `DECISIONS.md`.

## L-3 · Weekly Plan report (built 2026-07-21)

First phase under the **reset L- numbering** (Reset Brief in `froot_docs`; the
pre-reset sections above are the retired 0–4 foundation). Migration
`20260721163612_labor3_daily_split_policy_weekly_day_hours` — additive:
`LaborDailySplitPolicy` enum + `LaborSettings.dailySplitPolicy` (default
`FLOOR_FIRST`) + `WeeklyDayHours` per-date override table. The partial index
`LaborSettings_org_default_key` is preserved (SQL-only; never let a diff drop it).

- **Floor-first daily split — new default.** `splitWeeklyHoursToDaysFloorFirst`
  (pure) guarantees each open day enough hourly hours to cover its minimum floor
  (one body every open hour, minus the GM's capped on-floor credit) BEFORE
  distributing the remainder by sales weight. Per-store `dailySplitPolicy`
  (`FLOOR_FIRST | SALES_WEIGHTED`, default floor-first) selects it;
  `SALES_WEIGHTED` restores the pre-L-3 pure sales-weight split. Toggle +
  shared info explainer (`SplitPolicyInfo`) on `/settings/labor` AND next to the
  Coverage-card floor warning (one component, identical copy). **Defaulting
  existing orgs to `FLOOR_FIRST` changes their day allocations — intended.**
- **GM 40-hr weekly cap.** `capGmFloorCredits` scales the salaried GM's counted
  floor coverage so the weekly total never exceeds 40h (can't lean on hours the
  GM doesn't work). Floor-math only — the GM band still renders in full; which
  days the GM is off is the L-4 assignment layer.
- **Shared engine `getWeeklyDayPlan` (`labor-plan.ts`).** One place that turns
  the weekly budget into a per-day plan (floor-first split + GM cap +
  `WeeklyDayHours` overrides + adjustments). Budget/coverage routes are thin
  wrappers over it, so all surfaces agree. Day weights fall back to the SAME
  `deriveDayWeightsFromSales` the settings split editor shows (never an even
  split). **Open windows are inferred from trailing sales** (`inferOpenWindowsBy
  Weekday`, outlier-trimmed) when `StoreHours` is empty — which it always is
  today; nothing in Froot populates `StoreHours` (flagged for a follow-up: a
  store operating-hours source would make coverage exact).
- **L-3B cross-day rebalancing.** `WeeklyDayHours` per-date override lets
  ADMIN/MANAGER pin a day's hours; unpinned days re-split floor-first from the
  remaining pool, constrained to the weekly hourly total. `PUT/DELETE
  /api/labor/day-hours`; live recompute.
- **Weekly Plan page** (`/labor`, both gates, `requireLaborView`): week strip
  (forecast, last-year same-weekday actual +delta, hours, projected labor %,
  weather chip, coverage status **from the coverage engine** so it agrees with
  the detail) + selected-day detail (reuses `/api/labor/coverage`: hourly demand
  + recommended step line, single headcount axis, GM band, peak + break-window
  guidance). Empty states for no-forecast / no-history / closed. `GET
  /api/labor/weekly-plan`; nav item + links from both dashboard cards.

Fixtures: `verify-labor-coverage.ts` extended (floor-first split, GM cap);
`verify-labor-budget.ts` unchanged at 182h/18.8%.
