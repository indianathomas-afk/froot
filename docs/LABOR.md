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

## L-4 · Assignment layer (scoped 2026-10-30 by L-4-0 — no code yet)

### L-4-1 pivot — Square is the schedule (2026-10-30)

**This block is prepended, and it supersedes the L-4-0 design below where they
conflict.** Rulings: `docs/DECISIONS.md` "2026-10-30 — L-4-1: Square is the
schedule (Gary)", ten items, ratified as written. Prompt:
`docs/prompts/L-4-1_square_schedule_rescope.md`. Row title is now "Manager band
follows the Square schedule — Square is the schedule source (Froot-native
scheduler deferred)".

**Why.** Every Keva store's managers already schedule everyone in Square,
salaried managers included. A Froot scheduler would mean entering every shift
twice. For an org that schedules in Square, Square is the source of truth, and
Froot never keeps a competing schedule for that org. A Froot-native scheduler
waits for a real customer that doesn't schedule in Square, and will be a per-org
setting, never both. `LaborAssignment` stays in place, empty and unread, as its
storage. **L-4b (scheduler UI) and L-4c (breaks) are paused**, not cancelled.

**Cost vs presence.** A salaried allocation decides **cost** only: which store's
budget carries the salary. **Presence** — which store a person is at on a day —
comes from the schedule. Today one number does both, which is why Kristie is
set 10% Las Brisas / 10% UNR / 80% "Cafe De Cafe": the 80% exists so she stops
counting as floor coverage at the real stores.

**What a 10% allocation does today (A1, read in code at `45fcf5f`).**

| Question | Answer | Cite |
|---|---|---|
| Does the band draw? | Yes, every open day, full window (open → 14:00) | `hasGm = salaried.hasSalariedPerson`, `labor-plan.ts:262`; true at any share > 0, `labor-salaried.ts:80,91` |
| Is `gmHoursByDay` scaled by 10%? | No — the full window | `labor-plan.ts:295-301` |
| Is the credited floor time scaled? | Yes — the ceiling is her allocated hours (4 at 10% of 40), and the week is scaled to it: ~0.6 h/day, on days she may not work | `labor-plan.ts:320`, `labor-position-hours.ts:69-71`, `labor-daily.ts:51-57`, `floorByDay` `labor-plan.ts:322` |
| Does the "40-hour cap" see her? | As 4 hours, not 40 | same |
| Does the coverage floor count her? | No (R7-D) | `labor-coverage.ts:88-97` |
| What reaches cost? | 10% of `weeklyCost`, taken off the budget before hourly dollars | `labor-salaried.ts:79`, `labor-budget.ts:84-94` |

So Froot does **not** plan materially fewer crew hours because of her. The
over-statement is the band, which is visual, plus ~4 credited hours a week
spread evenly. Not material; L-5 fixes the credit.

**Latent, found here and owned by L-5:** in a week with no forecast the budget is
null (`labor-budget.ts:65`), so the ceiling falls back to 40 while `hasGm` is
still true (`labor-plan.ts:320`) — the case the comment at `:309-319` calls
"load-bearing and wrong". Not confirmed to render.

**L-4d, redefined.** At a store on a day, the manager band draws only when the
Square schedule has that salaried person there that day:

- **Match:** `LaborSalariedPerson.squareTeamMemberId` =
  `SquareScheduledShift.effectiveTeamMemberId`, same org, effective shift
  (published if present, else draft), not deleted, on that store's local date.
  No `StaffMember` step (`attendance.ts:168-186` already matches this way).
- **Hours:** her Square shift times, clipped to the open window.
- **Fallback — as today:** she has no Square shift anywhere that week; the
  org's Square labor integration is off; or that store's schedule sync is not
  healthy.
- **Display-only.** `gmHoursByDay`, the floor credit and the GM cap do not move.
  Presence is computed on the schedule side of the import wall
  (`labor-schedule.ts` / the route); `labor-plan.ts` and `labor-coverage.ts`
  never import it. Seam (b)'s boundary test passes by construction: no Square
  data means "as today". Owned trade-off until L-5: on a day the band is hidden,
  her ~0.6 credited hours still count.
- **TIER 3 · S.** No migration, no new scope — scheduled-shift reads ride
  `TIMECARDS_READ`. Its Phase A confirms via the Neon console that Kristie's
  staging shifts carry her team member id.

**L-4d, as built (2026-10-30, work commit `4dad553`, committed NOT pushed).**
Rulings: DECISIONS "2026-10-30 — L-4d: the manager band reads the Square
schedule (Gary)", R1-R5, on top of L-4-1 ruling 5/5a/5b/5c. How the band
decides:

- **Where it runs.** `src/lib/labor-schedule.ts:1346` onward, on the schedule
  side of the wall. Nothing in `labor-plan.ts` / `labor-coverage.ts` changed;
  `gmWindow` is still decided by `hasGm` (`labor-plan.ts:262,295-303`) and the
  routes REPLACE the band after the engine has returned.
- **Read** — `getManagerBandDecisions` (`labor-schedule.ts:1531`). Gates first,
  no query when off: `laborOverlayOn(org)` and the viewer's
  `labor.schedule.view` (R1). Then three reads: the store's sync summary + its
  `lastWindowEnd`; the allocated people (the same set `hasGm` counts —
  `allocationBps > 0`, `weeklyHours > 0`, exempt null OR false) → their
  `squareTeamMemberId`s; and, only if the sync is healthy, their live shifts
  org-wide that store-local week, selecting `storeId`, team member, start, end,
  deleted only — no notes, job or wage.
- **Decide** — pure `decideManagerBands` (`labor-schedule.ts:1404`), per date:
  - `as-today` for every day if: overlay off; viewer denied (R1); sync health
    not `fresh` / `synced-empty` (5c); nobody allocated; or ANY allocated person
    has no live shift at any store that week (R2, `:1444`).
  - `as-today` for one day if it's after `lastWindowEnd` (inclusive; R3), the
    window end is unknown, or the store is closed.
  - otherwise the union of the allocated people's shifts AT THIS STORE that
    overlap the day, first start to last end, start floored and end ceiled to
    whole hours (R4, `:1469`), clipped to the open window (5b) → `present`;
    nothing left → `absent`.
- **Apply.** `/api/labor/coverage` (`route.ts:68-77`) runs `applyManagerBand`
  (`labor-schedule.ts:1506`) on the engine's coverage: it replaces `gmWindow`
  and `points[].gm` only, and `as-today` returns the same object. Both charts
  (`labor-coverage-card.tsx:193-200,450`, `weekly-plan-client.tsx:635-636,717`)
  read that payload, so neither client file changed. `/api/labor/weekly-plan`
  (`route.ts:92,129`) writes the same decision into `days[].gmWindow` via
  `bandWindowFor` (`labor-schedule.ts:1494`). Its `covByDay` (status,
  comparison) is the engine's own and is untouched.
- **Display only, proven.** `scripts/verify-l4d-band.ts` (pure, no DB): PASS,
  73 checks. That covers scheduled-days-only, no-data / toggle-off / viewer-denied
  / never-stale-error → as-today, every B3 edge case and R2-R4, and the boundary
  test: floor credit, `gmHoursByDay`, budget, coverage minus the band, headcount
  and Suggested are byte-identical with and without Square rows. No Square data
  gives coverage byte-identical including the band. A static check confirms none
  of the six engines imports `labor-schedule`.
- **Known, not fixed** (L-4d B6): the overlay (`coverage/route.ts`) and the
  comparison (`weekly-plan/route.ts`) themselves still never check
  `laborOverlayOn`. The band does. The "(incl. manager)" heading
  (`labor-coverage-card.tsx:286`) is stale copy: headcount has excluded her since
  2026-08-23. `lastWindowEnd` is written when a sync STARTS, so for the seconds a
  sync is in flight, days newly inside the window can read `absent` before their
  rows land. Staging syncs only on dashboard load (the cron is production-only).

**Feeding core is `L-5`, rescoped** to "Square schedule presence feeds the floor
credit and GM cap". It needs its own L-2 seam (b) amendment first, because a
`SquareScheduledShift` value would then reach `labor-plan.ts`.

**What Square data already exists** (A3): `SquareScheduledShift`
(`prisma/schema.prisma:3666`) holds draft, published and effective location,
job, start/end (UTC), timezone, deleted flag and team member; `storeId` is
resolved via `Store.squareLocationId` at sync (`labor-schedule.ts:208-212`).
Window 3 days back / 28 forward (`:66-67`); cron daily 11:45 UTC, production
only. Read today by the coverage overlay, attendance and the inspector.
**Time off (A4): unclear** — Froot has no Square SDK installed to check, and no
probe has looked. L-4d does not depend on it.

**Remaining L-4 work:** L-4d only. L-4 is not shipped until L-4d ships.

---

*Below: the L-4-0 and L-4a design, kept as written. Superseded where marked.*

L-4 puts names on the plan: "Maria, Monday 7–2 at Las Brisas", not only "Las
Brisas needs 3 people Monday 7–2". Scope: named-person assignments, GM days off,
per-person planned breaks. **Froot-only** — the Square push half is struck
(`docs/DECISIONS.md`, "Froot is read-only toward Square; the name write-back
dies — 2026-08-18"). Rulings: `docs/DECISIONS.md` "2026-10-30 — L-4-0: labor
assignment layer scoping (Gary)", eight items, all ratified as written. Row:
`L-4` in `docs/ROADMAP.yaml`; feeding core is the separate row `L-5`.

### Rulings in force (summary — DECISIONS.md is the text of record)

> **SUPERSEDED IN PART 2026-10-30 by L-4-1:** rulings 4, 5, 6a, 6b and 6c no
> longer apply (see the pivot block above). 1 stands; 2 holds for the dormant
> `LaborAssignment` table only; 3's rule carries forward with Square presence
> in place of assignments.

1. No Square push. A future schedule write needs a new ruling, consent event and row.
2. An assignment keys on `StaffMember` (people with no login and no Square id included).
3. Assignments sit **beside** the core engines, like labor-actuals. They decide
   only whether the manager band draws — never `gmHoursByDay`, the floor credit
   or the GM cap. Feeding core is `L-5`.
4. Breaks are planned annotations only; no labor-law check in L-4.
5. Named schedules: ADMIN and MANAGER (store-scoped) under a new deniable
   capability. STORE sees counts only via `labor.schedule.view`; no STORE-role
   user sees named shifts in L-4.
6. (a) A salaried person resolves to a StaffMember by
   (organizationId, squareTeamMemberId); no active match → band as today.
   (b) Band hours stay the store's `gmOnFloor` setting; an assignment decides
   only whether it draws that day. (c) A salaried person with any assignment in
   a week is off on their unassigned days that week; none that week → band as
   today. No separate days-off table.

### Phase A findings (measured at `c416ee3`)

- **Who is a person.** `User` (`prisma/schema.prisma:243`) is Clerk accounts
  only. `StaffMember` (`:452`) is per-org, `userId` nullable ("most staff never
  get one"), `squareTeamMemberId` nullable (manual members exist), status
  ACTIVE | TERMINATED, stores via `StoreStaffAssignment` (`:549`). The manager
  band is driven by `LaborSalariedPerson` (`:3166`), keyed on a REQUIRED
  `squareTeamMemberId`, allocated to stores by `LaborSalariedAllocation`. The
  Square mirrors (`SquareScheduledShift` `:3619`, `SquareTimecard`,
  `SquareTeamMemberWage`) key on Square team-member id strings.
- **"Shift" is spent.** `SquareScheduledShift` is a built model; the word also
  appears in `ShiftNote` (`dashboard-client.tsx:62`), `ShiftDetails` /
  `ScheduledShiftPayload` / `EffectiveShift` (`labor-schedule.ts:79/90/151`),
  `InspectorShiftRow` (`labor-inspector.ts:234`), `AttendanceShift`
  (`attendance.ts:112`), `TeamMessage.shiftPhase` (schema `:2026`), and the
  "Shift blocks" UI. The new model is never a bare `Shift`.
- **The band is not display-only.** `hasGm = salaried.hasSalariedPerson`
  (`labor-plan.ts:262`). One loop (`:294-301`) builds both `gmWindowByDay` (the
  band) and `gmHoursByDay`, which feeds `capGmFloorCredits` (`:320-321`,
  `WEEKLY_GM_CAP_HOURS = 40` at `:43`) and `floorByDay` (`:322`). The window
  is the per-store setting with the hardcoded `14` default (`:296-297`,
  DEBT-83). Drawn at `labor-coverage-card.tsx:450` and
  `weekly-plan-client.tsx:717`. R7-E keeps the manager out of headcount
  (`labor-coverage.ts:105-111`). So L-4d must change the band's draw WITHOUT
  touching `gmHoursByDay` (ruling 3).
- **Comments that name L-4** — `labor-daily.ts:48-50`, `labor-plan.ts:431`,
  `labor-coverage.ts:108` — describe feeding core, which is now `L-5`.
- **Boundary.** Seam (b) as amended (`DECISIONS.md`, R7 seam amendment) admits
  admin-entered Froot facts to core. Under ruling 3, dropping the assignment
  tables leaves every number byte-identical; only the band can differ.
- **Permissions.** `labor.view` ALL (nav only), `labor.access` MANAGE (front
  door, `labor-access.ts:90`), `labor.schedule.view` OPERATIONAL and promises
  "COUNTS ONLY… no per-person field" (`permissions.ts:428-444`),
  `labor.costs.view` / `labor.manage` MANAGE. STORE accounts are shared iPad
  logins. AL-3 rule (`labor-dashboard.ts:86-91`): the capability decides
  whether to RUN THE QUERY, never whether to render the cell — named
  assignments follow it.

### Proposed split (sub-rows not filed by L-4-0 — not approved as rows)

> **SUPERSEDED 2026-10-30 by L-4-1:** L-4a is built; L-4b and L-4c are paused;
> L-4d is redefined to read the Square schedule (pivot block above). The table
> is kept as the L-4-0 plan of record.

| Phase | Tier · size | Touches | Does NOT |
|---|---|---|---|
| **L-4a — data model** | 3 · S, migration (session stops) | Additive `LaborAssignment`: org, store, `staffMemberId`, `date @db.Date`, `startMinutes`/`endMinutes` store-local, `createdByUserId`, index (org, store, date). Fixture. | UI, engines, Square. No days-off table (ruling 6c). |
| **L-4b — scheduler UI + write routes** | 3 · L | Week grid on `/labor` against the plan's daily headcount; `/api/labor/assignments` via `requireLaborContext` + `requireLaborStore`; picker from `StoreStaffAssignment`, ACTIVE only; new deniable capability (ruling 5). | Engines, Square, staff notifications, STORE names. |
| **L-4d — band reads assignments** | 3 · S | Whether the band draws per day (rulings 6a–6c); fallback = today. Closes the R7-C residue. | The label (never widened), window hours (DEBT-83), `gmHoursByDay` / cap (L-5). |
| **L-4c — per-person breaks** | 3 · S | Additive break windows on an assignment; display. | Compliance checks (ruling 4), engine math. |

Order: a → b → d → c (d is the visible payoff; c is least valuable).

### L-4a · data model — BUILT 2026-10-30 (work commit `9fc21d6`)

The heading's "no code yet" was true when L-4-0 wrote it; L-4a is the first
code. Rulings: `docs/DECISIONS.md` "2026-10-30 — L-4a: labor assignment data
model (Gary)". The final model (`prisma/schema.prisma`, `model LaborAssignment`):

| Field | Type | Note |
|---|---|---|
| `organizationId` | String → `Organization` | implied RESTRICT, like every labor neighbour |
| `storeId` | String → `Store` | `onDelete: Cascade` — a store delete takes its assignments (ruling 3) |
| `staffMemberId` | String → `StaffMember` | `onDelete: Restrict` — terminate, never delete (ruling 3) |
| `date` | `DateTime @db.Date` | store-local calendar date |
| `startMinutes`, `endMinutes` | Int | from store-local midnight; `0 ≤ start < end ≤ 1440`, enforced by CHECK `LaborAssignment_minutes_check` (ruling 2) |
| `createdByUserId` | String | plain id, no FK — a user delete never blocks (ruling 3) |
| `createdAt`, `updatedAt` | DateTime | |

Indexes `(organizationId, storeId, date)` and `(staffMemberId, date)` (ruling 5).
**No unique key**: several rows per person per day, at one store or several
(ruling 1).

**What the database does NOT refuse, and L-4b must:** overlapping times
(ruling 1); a store or person from another org, a TERMINATED person, or one not
assigned to the store (ruling 4); and the staff DELETE route's record count
must gain a `laborAssignment` line, or a person with assignments 500s instead of
the 409 (ruling 3).

Fixture: `scripts/verify-l4a-labor-assignment.ts` (dev only, refuses any other
branch, leaves no rows) — 24/24 on `br-broad-wave-a6vpjdw0`. Migration:
`20261030200242_l4a_labor_assignment` (`docs/MIGRATIONS.md`). Nothing in the core
engines reads the table (ruling 3 of L-4-0).
