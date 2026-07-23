# Labor Model — Phase 0–1 Session Prompt

**Module:** Weekly Labor Model
**Phase:** 0 (config & foundations) + 1 (weekly budget + dashboard cards)
**Companion doc:** `froot_docs/UseFroot_Labor_Model_Brief` (feasibility & decision brief)
**Session type:** Single Claude Code session. Audit-first. No edits until the plan is approved.

---

## 0 · How to run this session

Follow the standard Froot workflow (`../../CLAUDE.md`, `../../AGENTS.md`, `../WORKFLOW.md`, `../MIGRATIONS.md`):

1. **Audit first.** Read the files in the Audit Checklist below and present a written plan — files to add, files to touch, the Prisma migration, and any forks — **before changing anything**. Wait for explicit approval.
2. **Additive-only migrations.** New models and new columns only. **No column drops, ever.** Neon is the source of truth; do not run any SQL that mutates data without showing it and getting approval first.
3. **`next build` must pass** before you consider a step done and before any commit.
4. **Commit `package-lock.json`** with any dependency change. Prefer reusing existing libraries — do not add a chart library; reuse whatever the Sales Performance card already uses.
5. **Scope containment.** If you notice unrelated bugs or drift (e.g. `operationalPhase` / `sectionName` inconsistencies), note them as text at the end. Do not fix inline.
6. **Surface forks.** If you hit a design fork not resolved here, stop and list it plainly with a recommendation. Don't guess.

---

## 1 · Locked decisions (from the brief)

| # | Decision | Value for this build |
|---|---|---|
| 1 | Build sequence | Weekly budget first (this phase). Daily templates are Phase 2 — out of scope. |
| 2 | Labor-% denominator | **Configurable.** `LaborSettings.denominator` enum, default `TOTAL_WITH_DELIVERY`. Forecast captures store + delivery separately. |
| 3 | Rate model | Role/position **default rates** only. Per-employee override is a later phase — out of scope. |
| 4 | Overtime | **Warn only** in v1 (no OT modeling). A soft flag is fine; do not build OT math. |
| 5 | Rounding rule | Round conservative sales **down** to the nearest `roundingIncrementCents` (default $1,000). |
| 6 | Labor Coverage card | Ship in **recommended mode**, clearly labeled as guidance. |

Decisions #2 and #4 are owner-configurable defaults — build them as settings, not constants.

---

## 2 · Audit checklist (read before planning)

Report what you find for each. **The first two are the highest-risk items — reconcile, do not duplicate.**

1. **`../FORECASTING.md` + any existing forecast models/services.** If Froot already stores or computes sales forecasts, the Labor model must **reuse** that, not create a parallel forecast. Report whether `SalesForecast` below should be a new model or a view/extension of what exists.
2. **The Dashboard "Sales Performance" card** and its data source. Find how it gets hourly sales (today vs prior-year). The Labor Coverage card must reuse this same hourly-sales source and the same charting component/library. Report the component path, the data source, and the chart lib.
3. **`Organization` model + `activeModules` toggle pattern** (used by the HR module and Instagram integration). The Labor module uses the identical two-gate pattern.
4. **The server-side module env-flag pattern** (e.g. `HR_MODULE_AVAILABLE`). Mirror it as `LABOR_MODULE_AVAILABLE`.
5. **Settings page structure** — how HR/Instagram sections register, and how per-module settings are edited.
6. **The store/location model** — confirm its exact name (`Store` vs `Location`), how it relates to `Organization`, and how "the current store" is resolved on the dashboard.
7. **Clerk roles** (`ADMIN` / `MANAGER` / `STORE` / `STAFF`) and how RBAC is enforced on pages/actions.
8. **`prisma/schema.prisma`** money/decimal conventions — are amounts stored as `Int` cents already? Match the existing convention.
9. **Prior session-prompt format** in `froot_docs/` so this module's docs match house style.

---

## 3 · Feature flag (two gates)

Nothing labor-related renders unless **both** are true:

- **Gate 1 (server env):** `LABOR_MODULE_AVAILABLE=true`.
- **Gate 2 (per-org):** `"labor"` present in `Organization.activeModules`, toggled in Settings.

Mirror the exact HR-module implementation. Sidebar nav, dashboard cards, and settings section are all conditional on both gates.

---

## 4 · Data model (additive Prisma)

Match existing naming/relation conventions from the audit. Money is **`Int` cents** (Square-compatible). Adjust relation fields to the real `Organization` / store model names.

```prisma
enum LaborPayType {
  HOURLY
  SALARIED
}

enum LaborDenominator {
  IN_STORE
  TOTAL_WITH_DELIVERY
}

enum SalesForecastSource {
  MANUAL
  LAST_YEAR
  TREND
}

/// Org-scoped labor positions (the rate legend): Store Manager, ASM, Lead
/// Supervisor, Supervisor, Team Member, District Manager, etc.
model LaborPosition {
  id                      String       @id @default(cuid())
  organizationId          String
  name                    String
  payType                 LaborPayType @default(HOURLY)
  defaultHourlyRateCents  Int                    // salaried positions also carry an implied hourly rate
  impliedWeeklyHours      Int?                   // e.g. 40 for salaried; null for hourly
  isSupervisory           Boolean      @default(false) // Manager/ASM/Lead/Supervisor = true (for the Phase-2 coverage rule)
  sortOrder               Int          @default(0)
  active                  Boolean      @default(true)
  createdAt               DateTime     @default(now())
  updatedAt               DateTime     @updatedAt
  // organization  Organization @relation(...)
  @@index([organizationId])
}

/// Org default settings (storeId null) with optional per-store override rows.
model LaborSettings {
  id                       String           @id @default(cuid())
  organizationId           String
  storeId                  String?                          // null = org default
  laborTargetPct           Decimal          @db.Decimal(5,2) @default(20.00)
  roundingIncrementCents   Int              @default(100000) // $1,000
  denominator              LaborDenominator @default(TOTAL_WITH_DELIVERY)
  plannedBlendedRateCents  Int?                             // optional manual blended rate; else computed
  createdAt                DateTime         @default(now())
  updatedAt                DateTime         @updatedAt
  @@unique([organizationId, storeId])
  @@index([organizationId])
}

/// Weekly projected sales input. Reuse existing forecasting infra if the audit
/// finds it — this model is the fallback if none exists.
model SalesForecast {
  id                        String              @id @default(cuid())
  organizationId            String
  storeId                   String
  weekStart                 DateTime            @db.Date   // Monday of the week
  projectedStoreSalesCents  Int
  projectedDeliveryCents    Int                 @default(0)
  source                    SalesForecastSource @default(MANUAL)
  createdById               String
  createdAt                 DateTime            @default(now())
  updatedAt                 DateTime            @updatedAt
  @@unique([storeId, weekStart])
  @@index([organizationId, storeId])
}
```

No `WeeklyLaborBudget` table — the budget is **derived on read** by the service below, so there's nothing to keep in sync. Persist a snapshot only if the audit shows the dashboard needs it for performance; if so, raise it as a fork.

---

## 5 · Budget calculation service (the core)

A **pure function** — no DB calls inside — so it's unit-testable. Suggested signature:

```
computeWeeklyLaborBudget({ settings, positions, forecast }) -> LaborBudgetResult
```

Algorithm (all money in cents):

1. `salesBasisCents = projectedStoreSalesCents + (denominator === TOTAL_WITH_DELIVERY ? projectedDeliveryCents : 0)`
2. `conservativeSalesCents = Math.floor(salesBasisCents / roundingIncrementCents) * roundingIncrementCents`
   *(round **down to the nearest tier**. A basis already on a tier boundary — e.g. exactly $15,000 with a $1,000 increment — stays there; there is **no full-step-down**. Rule locked 7-20.)*
3. `totalLaborBudgetCents = Math.round(conservativeSalesCents * laborTargetPct / 100)`
4. For each active `SALARIED` position with `impliedWeeklyHours`:
   `weeklyCost = defaultHourlyRateCents * impliedWeeklyHours`
   → `salariedCostCents = Σ weeklyCost`, `salariedHours = Σ impliedWeeklyHours`
5. `hourlyDollarsCents = Math.max(0, totalLaborBudgetCents - salariedCostCents)`
6. `blendedHourlyRateCents = plannedBlendedRateCents ?? round(mean(defaultHourlyRateCents of active HOURLY positions))`
7. `hourlyHours = blendedHourlyRateCents > 0 ? Math.floor((hourlyDollarsCents / blendedHourlyRateCents) * 2) / 2 : 0`
   *(round **down** to nearest 0.5 hr — conservative, matches the budget philosophy)*
8. `totalSchedulableHours = salariedHours + hourlyHours`
9. `projectedLaborPctAtForecast = salesBasisCents > 0 ? totalLaborBudgetCents / salesBasisCents * 100 : null`
   *(this is the number the manager sees — it shows the buffer below the target)*

Return every intermediate value (conservative sales, total budget, salaried cost/hours, hourly dollars, blended rate, hourly hours, total hours, projected %). If `salariedCostCents > totalLaborBudgetCents`, set a `floorExceedsBudget: true` flag for the UI to warn on — do not throw.

### Acceptance test (must reproduce exactly)

Seed: SM salaried $20/40h, ASM salaried $18/40h, Lead $15, Supervisor $13, Team $12 (hourly). `LaborSettings`: target 20%, rounding $1,000, blended rate $12.50. Forecast: store **$14,900**, delivery $0, denominator `TOTAL_WITH_DELIVERY`.

Expected result:

| Field | Value |
|---|---|
| conservative sales | $14,000 |
| total labor budget | $2,800 |
| salaried cost / hours | $1,520 / 80 hrs |
| hourly dollars | $1,280 |
| hourly hours | 102.0 |
| **total schedulable hours** | **182.0** |
| projected labor % (at $14,900 forecast) | **18.8%** |

*(Case corrected 7-20 to match the locked floor-to-tier rule: $14,900 floors to
the $14,000 tier; projected % is `2,800 / 14,900 = 18.79% → 18.8%`. The earlier
$15,000 / 18.7% case was internally inconsistent with step 2 and is retired.)*

Write this as a unit test.

---

## 6 · Phase deliverables

### Phase 0 — config & foundations
- Feature flag (both gates) wired to sidebar, dashboard, and settings.
- Prisma models above + additive migration. `next build` green.
- **Settings › Labor** section (ADMIN/MANAGER): toggle the module; edit `LaborSettings` (target %, rounding increment, denominator, optional blended-rate override); CRUD `LaborPosition` rows (name, pay type, rate, implied hours, supervisory, sort order, active).
- Seed the default positions from the rate legend so a new org starts usable.

### Phase 1 — weekly budget + dashboard

**1A · Weekly budget (must ship)**
- Forecast entry (ADMIN/MANAGER): pick store + week (Monday), enter projected **store sales** and **delivery** separately, `source = MANUAL`. Upsert on `(storeId, weekStart)`.
- Wire `computeWeeklyLaborBudget` and render the **Labor Budget hero card** on the dashboard: big `totalSchedulableHours`, a projected-labor-% gauge against `laborTargetPct` (green ≤ target, amber near, red over), and the conservative-tier / buffer shown as supporting text. If `floorExceedsBudget`, show the warning state.
- If no forecast exists for the week, show an empty state with a "Set projected sales" action — never a broken card.

**1B · Labor Coverage card (should ship; may defer if the session runs long)**
- A **step line** of recommended staff-on-floor by hour for the currently-viewed day, using the hourly-sales shape from the **same source as the Sales Performance card** (from the audit).
- Method: normalize that day's hourly sales into a demand shape; distribute the day's share of `totalSchedulableHours` across operating hours proportional to demand, with a floor of 1 during open hours; render as an integer step line with the peak window shaded. Keep the weekly→daily hour split a single clearly-commented heuristic (day's share of weekly sales) so it's easy to tune later.
- Label it **"Recommended · guidance"** and place it directly beneath the Sales Performance card so the time axes align. Single y-axis only (headcount) — never dual-axis with dollars.
- If 1B can't land cleanly, ship 1A and leave 1B as a noted follow-up rather than blocking the build.

---

## 7 · RBAC

- **ADMIN / MANAGER:** edit settings, positions, and forecasts.
- **STORE / STAFF:** read-only dashboard cards. No access to settings or forecast entry.
Enforce on both the page and the server action, matching the existing pattern.

---

## 8 · Out of scope (do not build)

Daily shift templates and the min-staffing coverage engine (Phase 2) · Square-driven forecasting (Phase 3) · actual labor from Square Timecards, per-employee wages from the Team API, push-to-Square scheduling, and OT modeling (Phase 4). Leave clean seams for these; don't implement them.

---

## 9 · Definition of done

- Audit reported and plan approved before edits.
- Migration is additive; no drops; applied to Neon only after approval.
- `next build` passes; `package-lock.json` committed if deps changed (none expected).
- Acceptance test passes and reproduces the $182 / 18.7% example.
- Both feature-flag gates verified: module hidden when either is off.
- Empty states handled (no forecast, module off).
- Any out-of-scope issues noticed are listed as text, not fixed.
