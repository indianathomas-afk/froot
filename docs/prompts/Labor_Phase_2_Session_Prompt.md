# Labor Model — Phase 2 Session Prompt

**Module:** Weekly Labor Model
**Phase:** 2 (auto-forecast + total-sales simplification + daily split + labor adjustment + min-staffing coverage engine)
**Builds on:** Phase 0–1 (shipped — see `LABOR.md`, on staging)
**Companion doc:** `froot_docs/UseFroot_Labor_Model_Brief` (feasibility & decision brief)
**Session type:** Single Claude Code session. Audit-first. No edits until the plan is approved.

---

## 0 · How to run this session

Follow the standard Froot workflow (`../../CLAUDE.md`, `../../AGENTS.md`, `../WORKFLOW.md`, `../MIGRATIONS.md`):

1. **Audit first.** Read the Phase-0/1 code + the Forecasting module in the Audit Checklist below and present a written plan — files to add, files to touch, the Prisma migration, and any forks — **before changing anything**. Wait for explicit approval.
2. **Additive-only migrations.** New models and new columns only. **No column drops, ever** — including the columns this phase *deprecates* (§1.2). Show any SQL and get approval before running it against the dev branch.
3. **Match the shipped conventions.** Money is **dollars as `Decimal(10,2)`**; the budget service computes in **integer cents internally** (see `../LABOR.md`). Hours round **down to the nearest 0.5**. Reuse the existing two-gate feature flag verbatim — do **not** add a new flag.
4. **`next build` must pass** before a step is done and before any commit. **Commit `package-lock.json`** with any dependency change (none expected — reuse `recharts`, no new libs).
5. **Recommendation-only.** Phase 2 outputs *recommended coverage*, not an assigned schedule. **No named-employee assignment, no push-to-Square, no OT math** — Phase 4. Leave clean seams.
6. **Scope containment.** Note unrelated bugs/drift as text at the end. Don't fix inline.
7. **Surface forks.** Hit a fork not resolved here → stop, list it with a recommendation. Don't guess.

---

## 1 · Locked decisions

### 1.1 Carried from Phase 0–1
| # | Decision | Value |
|---|---|---|
| a | Money | Dollars, `Decimal(10,2)`, integer-cents internally. |
| b | Rounding | Sales floor-to-tier; hours floor to 0.5. |
| c | Feature flag | The existing two gates — no change. |
| d | RBAC | Read = any role (`requireLaborView`); write = ADMIN+MANAGER (`requireLaborContext`). |

### 1.2 New for Phase 2
| # | Decision | Value for this build |
|---|---|---|
| 1 | **Total sales only** | Drop the in-store/delivery split. The labor-% basis is a single **total** sales number (delivery is already in Square net sales — it has been for 2+ years). **Deprecate** `LaborSettings.denominator` and `SalesForecast.projectedDelivery`: keep the columns (no drops), stop reading/writing them, remove them from the UI. The budget basis becomes just the total forecast. |
| 2 | **Auto-forecast from Forecasting** | The Budget card **derives the week's projected sales** by summing the store's `DailyGoal` rows (Mon–Sun) from the Forecasting module — `SalesForecastSource.TREND`, computed on read, **not stored**. No data entry required. A **`MANUAL` `SalesForecast` row overrides** it when the operator wants to. Empty state only when there's neither a manual row nor any `DailyGoal` for the week. |
| 3 | **Labor adjustment knob** | A **per-day ±% adjustment** with a reason label (e.g. "Rain", "Holiday") that **scales the hourly hours only — salaried stays fixed** (you can't send a salaried manager home). Default 0%. Owner-set. Applied after the daily split, before coverage. |
| 4 | Build sequence | **2A** (auto-forecast + total-sales + daily split + adjustment), then **2B** (dayparts + coverage engine). |
| 5 | Operating hours | Use the real **`StoreHours`** per weekday; fall back to sales-shape inference only when absent. |
| 6 | Supervisor rule | **≥ 1 supervisory position on the floor during all open hours** (`LaborPosition.isSupervisory`). Configurable per daypart. |
| 7 | Minimum staffing | Floor of 1 while open, plus a configurable `minHeadcount` per daypart. Under-coverage **flagged, never thrown**. |
| 8 | Coverage card | Stays labeled **"Recommended · guidance."** Rule-satisfying, still advisory, single headcount axis. |
| 9 | **Salaried = weekly constant** | The daily split, adjustment, and coverage operate on **hourly hours only**. Salaried hours are shown as one weekly figure, never distributed per day. |

Decisions #2, #3, #6, #7 are owner-configurable — build them as settings/inputs, not constants.

---

## 2 · Audit checklist (read before planning)

Report what you find for each. Extend the Phase-0/1 primitives — do not duplicate.

1. **`src/lib/labor-budget.ts`** — `computeWeeklyLaborBudget`: how `denominator` + `projectedDelivery` currently feed `salesBasis`. Plan the **total-only** simplification (basis = total forecast) and how salaried/hourly hours split, since the adjustment scales hourly only.
2. **The Forecasting module** — `GoalPlan` → `DailyGoal` (`goalAmount` per store per date, unique `storeId+date`; `../FORECASTING.md`). Confirm summing Mon–Sun `DailyGoal.goalAmount` yields the week's total forecast (delivery included). This is the auto-forecast source.
3. **`src/lib/labor-coverage.ts`** — `recommendCoverage` (Phase-1B heuristic). Phase 2's engine generalizes it with min-staffing rules; keep the `SalesHourlyCache` demand source.
4. **`SalesForecast` model + `/api/labor/forecast` + `/api/labor/budget`** — how the manual forecast is read today; Phase 2 makes it the *override* and adds the `TREND` default. Report the response shapes the Budget card consumes.
5. **`src/lib/labor-week.ts`** (`mondayOfWeekStr`) and **`StoreHours`** — reuse for week keys and operating windows; confirm `StoreHours` shape + timezone handling.
6. **`LaborSettings` / `LaborPosition`** — org-default row, `isSupervisory`, the partial-unique index; and the two columns being deprecated (§1.2).
7. **`requireLaborView` / `requireLaborContext` / `requireLaborStore`** — reuse verbatim.
8. **`scripts/verify-labor-budget.ts`** — the pure-function fixture pattern; Phase 2 adds `verify-labor-coverage.ts`.
9. **The dashboard Labor row** (`dashboard-client.tsx`) + the Budget/Coverage cards — Phase 2 wires the auto-forecast, the adjustment control, and the rule-based coverage.

---

## 3 · Feature flag

**No change.** Everything stays behind the existing two gates; new routes reuse `requireLaborView` / `requireLaborContext`. New settings live on `/settings/labor`.

---

## 4 · Data model (additive Prisma)

Match shipped conventions (relations to `Organization`/`Store`, org-default rows with `storeId` null, `@db.Decimal`). **Deprecate but do not drop** `LaborSettings.denominator` and `SalesForecast.projectedDelivery`.

```prisma
/// Per-store day-of-week weighting for the weekly→daily hour split.
/// Weights are basis points (sum ≈ 10000). Auto-seeded from trailing sales;
/// flips isOverride when hand-edited.
model LaborDaySplit {
  id             String   @id @default(cuid())
  organizationId String
  storeId        String
  weekday        Int      // 0 = Monday … 6 = Sunday
  weightBps      Int      // basis points (0–10000)
  isOverride     Boolean  @default(false)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@unique([storeId, weekday])
  @@index([organizationId, storeId])
}

/// Shift blocks / dayparts with minimum-staffing rules. Org default (storeId
/// null) with optional per-store overrides — LaborSettings pattern.
model LaborDaypart {
  id                 String   @id @default(cuid())
  organizationId     String
  storeId            String?  // null = org default
  name               String   // "Opening", "Mid", "Close"
  startLocalMinutes  Int      // minutes from local midnight (480 = 8:00a)
  endLocalMinutes    Int      // exclusive
  minHeadcount       Int      @default(1)
  requiresSupervisor Boolean  @default(false)
  sortOrder          Int      @default(0)
  active             Boolean  @default(true)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  @@index([organizationId])
}

/// Date-specific labor adjustment (weather, holiday, event). Scales that day's
/// HOURLY hours by adjustmentPct; salaried is untouched. Keyed by exact date,
/// not weekday, because conditions are one-off.
model LaborDayAdjustment {
  id             String   @id @default(cuid())
  organizationId String
  storeId        String
  date           DateTime @db.Date
  adjustmentPct  Decimal  @db.Decimal(5, 2) // e.g. -20.00 = staff 20% below
  reason         String?
  createdById    String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@unique([storeId, date])
  @@index([organizationId, storeId])
}
```

No shift-*assignment* table — Phase 2 recommends coverage, it doesn't persist an assigned schedule. Add partial-unique indexes for any org-default (`storeId` null) exactly like `LaborSettings_org_default_key`, documented in `../LABOR.md`.

---

## 5 · The engines (pure functions — no DB, unit-testable)

### 5A · Weekly forecast source (data-layer helper, thin)
`getWeeklyForecast(store, weekStart)`: if a `MANUAL` `SalesForecast` row exists → use its total; else sum `DailyGoal.goalAmount` for Mon–Sun (`TREND`). Return `{ total, source }`. Feeds the existing budget service as the **total basis** (no denominator).

### 5B · Daily hour split (pure)
```
splitWeeklyHoursToDays({ weeklyHourlyHours, weightsByWeekday, openDays }) -> { weekday, hourlyHours }[]
```
- Splits **hourly hours only**: `hourlyHours[d] = floor((weeklyHourlyHours × weightBps[d] / 10000) × 2) / 2`.
- **Salaried hours are a weekly constant — NOT distributed per day** (decided). A salaried manager's hours aren't a per-day budget line; the dashboard shows salaried as one weekly figure, and the per-day split, adjustment, and coverage all operate on the **hourly** hours. Missing/zero weights → even split across open days.

### 5C · Day adjustment (pure)
```
applyDayAdjustment(dayHourlyHours, adjustmentPct) -> floor(dayHourlyHours × (1 + adjustmentPct/100) × 2) / 2
```
Scales **hourly** hours only; salaried untouched. Clamp at ≥ 0.

### 5D · Minimum-staffing coverage (pure)
```
computeDailyCoverage({ adjustedDayHours, storeHours, dayparts, demandShape, positions }) -> DailyCoverageResult
```
Reuse `labor-coverage.ts` distribution, then enforce: `headcount ≥ max(1, daypart.minHeadcount)`; supervisor coverage where `requiresSupervisor`; if floors exceed `adjustedDayHours`, set `exceedsDailyBudget` (don't throw). Return the integer step line, peak window, per-daypart coverage vs min, supervisor flag, budget-vs-used delta.

**Write 5B–5D as unit tests** in `scripts/verify-labor-coverage.ts`.

### Acceptance cases (must reproduce exactly)

**Budget (total-only, unchanged math)** — total forecast **$14,900**, target 20%, rounding $1,000, blended $12.50, SM+ASM salaried $20/$18 @40h, Lead/Sup/Team hourly $15/$13/$12 → conservative $14,000, budget $2,800, salaried $1,520/80h, hourly $1,280/**102.0h**, **total 182.0h, projected 18.8%**. (Same numbers as Phase 1; just no delivery field.)

**Daily split** — `weeklyHourlyHours = 102.0`, weights (bps) Mon–Sun `1000/1200/1300/1500/1800/2000/1200` → Mon `floor(10.2×2)/2 = 10.0`, Fri `floor(18.36×2)/2 = 18.0`, Sat `floor(20.4×2)/2 = 20.0`. Assert the 7-day array and sum ≤ 102.0 with remainder reported.

**Adjustment** — Fri hourly 18.0 with `adjustmentPct = -20` → `floor(18 × 0.8 × 2)/2 = floor(28.8)/2 = 14.0`. Assert salaried unchanged.

**Coverage invariants** — every open hour `headcount ≥ 1`; `requiresSupervisor` daypart always has supervisor coverage; `exceedsDailyBudget` flips true when summed floors exceed `adjustedDayHours` (12-hour open day, `adjustedDayHours = 8`, three `minHeadcount ≥ 1` dayparts).

---

## 6 · Phase deliverables

### 2A — Auto-forecast + total-sales + daily split + adjustment (must ship)
- **Total-sales simplification:** budget service uses the total basis; drop the denominator branch. Remove the denominator selector and the delivery input from `/settings/labor` and the forecast dialog. Deprecate (not drop) the two columns.
- **Auto-forecast:** `getWeeklyForecast` (TREND default from `DailyGoal`, MANUAL override). Budget card shows a real number with no entry; "Set projected sales" becomes "Adjust this week." Empty state only when no `DailyGoal` and no manual row.
- **`LaborDaySplit`** + migration; auto-seed weights from trailing sales; `splitWeeklyHoursToDays` + fixture; per-store weight editor on `/settings/labor` (edit/override, "reset to sales-derived").
- **`LaborDayAdjustment`** + migration; `applyDayAdjustment` + fixture; a per-day adjustment control (±% + reason) reachable from the dashboard for the viewed day (ADMIN/MANAGER); the Budget hero shows the adjusted total + an "adjusted −20% (Rain)" chip.
- API: `GET/PUT /api/labor/day-split`, `GET/PUT/DELETE /api/labor/day-adjustment` (org-scoped, reuse guards).

### 2B — Dayparts + coverage engine (should ship; may defer if the session runs long)
- **`LaborDaypart`** + migration; CRUD on `/settings/labor`; seed Opening/Mid/Close defaults on enable.
- `computeDailyCoverage` + fixture.
- **Upgrade the Coverage card** to the rule-based engine: same step line, plus a supervisor-coverage indicator, per-daypart min badges, and an under/over-coverage flag. Keep the label + single headcount axis. Respects the day's adjustment.
- If 2B can't land cleanly, ship 2A and note 2B as a follow-up.

---

## 7 · RBAC

- **ADMIN / MANAGER:** edit day-split weights, dayparts, day adjustments (`requireLaborContext`).
- **STORE / STAFF:** read-only coverage on the dashboard (`requireLaborView`).
Enforce on both the page and the server action.

---

## 8 · Out of scope (do not build)

Named-employee assignment / actual schedules · push-to-Square scheduling · Square Timecards actuals · per-employee wages (Team API) · OT modeling · Square backfill of `DailyGoal` (that's the Forecasting module's own job; Phase 2 only *reads* it). Leave clean seams.

---

## 9 · Definition of done

- Audit reported and plan approved before edits.
- Migration additive; no drops (including deprecated columns); applied to the dev branch only after approval.
- `next build` passes; `package-lock.json` committed if deps changed (none expected).
- Acceptance cases pass (`scripts/verify-labor-coverage.ts` + the updated budget fixture): total-only budget still reproduces **182.0h / 18.8%**; daily split, adjustment, and coverage invariants hold.
- Budget card shows the **auto-derived** forecast with no data entry; manual override still works; denominator/delivery gone from the UI.
- Both feature-flag gates verified: nothing renders when either is off.
- Empty/fallback states handled (no `DailyGoal` + no manual forecast; no `StoreHours`).
- Coverage card stays guidance-labeled, single headcount axis.
- Out-of-scope issues noticed are listed as text, not fixed.
