# Labor Model — Phase 2 Session Prompt

**Module:** Weekly Labor Model
**Phase:** 2 (daily hour split + shift templates + minimum-staffing coverage engine)
**Builds on:** Phase 0–1 (shipped — see `LABOR.md`, commit `eb35a85` on staging)
**Companion doc:** `froot_docs/UseFroot_Labor_Model_Brief` (feasibility & decision brief)
**Session type:** Single Claude Code session. Audit-first. No edits until the plan is approved.

---

## 0 · How to run this session

Follow the standard Froot workflow (`CLAUDE.md`, `AGENTS.md`, `WORKFLOW.md`, `MIGRATIONS.md`):

1. **Audit first.** Read the Phase-0/1 code in the Audit Checklist below and present a written plan — files to add, files to touch, the Prisma migration, and any forks — **before changing anything**. Wait for explicit approval.
2. **Additive-only migrations.** New models and new columns only. **No column drops, ever.** Neon is the source of truth; show any SQL and get approval before running it against the dev branch.
3. **Match the shipped conventions.** Money is **dollars as `Decimal(10,2)`**; the budget service computes in **integer cents internally** (see `LABOR.md`). Hours round **down to the nearest 0.5**. Reuse the existing two-gate feature flag verbatim — do **not** add a new flag.
4. **`next build` must pass** before a step is done and before any commit. **Commit `package-lock.json`** with any dependency change (none expected — reuse `recharts`, no new libs).
5. **Recommendation-only.** Phase 2 outputs *recommended coverage*, not an assigned schedule. **No named-employee assignment, no push-to-Square, no OT math** — those are Phase 4. Leave clean seams.
6. **Scope containment.** Note unrelated bugs/drift as text at the end. Don't fix inline.
7. **Surface forks.** If you hit a design fork not resolved here, stop and list it with a recommendation. Don't guess.

---

## 1 · Locked decisions (defaults — confirm or override in the plan)

| # | Decision | Value for this build |
|---|---|---|
| 1 | Build sequence | **Daily hour split first (2A)**, then the coverage engine (2B). |
| 2 | Output granularity | **Recommended coverage only** — headcount by hour/daypart, and shift *blocks* (not people). No employee assignment. |
| 3 | Weekly→daily split | **Auto-seed** day-of-week weights from trailing sales actuals; **owner-editable override**. This replaces the single Phase-1B heuristic. |
| 4 | Operating hours | Use the real **`StoreHours`** model for each weekday's open/close — not inferred from sales. Fall back to the sales-shape inference only when `StoreHours` is absent. |
| 5 | Supervisor rule | **≥ 1 supervisory position on the floor during all open hours** (uses `LaborPosition.isSupervisory`, seeded in Phase 0 for exactly this). Configurable per daypart. |
| 6 | Minimum staffing | **Floor of 1 while open**, plus a configurable `minHeadcount` per daypart. Under-coverage is **flagged, never thrown**. |
| 7 | Rounding | Person-hours round **down to 0.5** (matches Phase 1's conservative philosophy). |
| 8 | Coverage card | Stays labeled **"Recommended · guidance."** It graduates from a raw heuristic to a **rule-satisfying** recommendation, but is still advisory. |

Decisions #3, #5, #6 are owner-configurable — build them as settings, not constants.

---

## 2 · Audit checklist (read before planning)

Report what you find for each. The Phase-1 primitives are the load-bearing pieces — **extend, do not duplicate**.

1. **`src/lib/labor-budget.ts`** — `computeWeeklyLaborBudget` returns `totalSchedulableHours`, `salariedHours`, `hourlyHours`, `blendedHourlyRate`. Phase 2 consumes these. Confirm what's available for the daily split (do you split total hours, or salaried and hourly separately?).
2. **`src/lib/labor-coverage.ts`** — `recommendCoverage` is the Phase-1B heuristic (`dayShareOfWeek` × total hours, distributed by demand, floor 1). Report exactly how it works; Phase 2's engine **generalizes/replaces** it. Keep the same demand source.
3. **`src/lib/labor-week.ts`** — `mondayOfWeekStr` / `mondayOfWeekDate`. Reuse for week keys.
4. **The Coverage card** (`src/app/(app)/dashboard/labor-coverage-card.tsx`) + **`/api/labor/coverage`** — the demand shape comes from `SalesHourlyCache` (same source as the Sales Performance card). Report the response shape; Phase 2 extends it.
5. **`StoreHours` model** — confirm its exact shape (per-weekday open/close, timezone handling) and how it relates to `Store`. This is the new operating-hours source.
6. **`LaborSettings` / `LaborPosition`** — the org-default row, `isSupervisory`, `impliedWeeklyHours`, and the partial-unique index guaranteeing one org default (`LABOR.md`). Phase-2 per-store overrides must respect that pattern.
7. **`requireLaborView` / `requireLaborContext` / `requireLaborStore`** (`src/lib/labor-access.ts`) — reuse verbatim (view = any role read; context = ADMIN+MANAGER write).
8. **`scripts/verify-labor-budget.ts`** — the pure-function fixture pattern (`npx tsx`, plain asserts). Phase 2's engine gets its own `verify-labor-coverage.ts`.
9. **`prisma/schema.prisma`** money/decimal conventions and the Labor section at the end of the file (where the new models go).

---

## 3 · Feature flag

**No change.** Everything Phase 2 renders stays behind the existing two gates (`laborModuleAvailable()` env + `"labor"` in `activeModules`). New API routes reuse `requireLaborView` / `requireLaborContext` (which already 404 when either gate is off). New settings live under the existing `/settings/labor` page.

---

## 4 · Data model (additive Prisma)

Match the shipped Labor conventions (relations to `Organization`/`Store`, org-default rows with `storeId` null, `@db.Decimal` where applicable). Adjust names to what the audit finds.

```prisma
/// Per-store day-of-week weighting for the weekly→daily hour split.
/// Weights are basis points (sum ≈ 10000) so the split is exact; a row is
/// auto-seeded from trailing sales and flips isOverride when hand-edited.
model LaborDaySplit {
  id             String   @id @default(cuid())
  organizationId String
  storeId        String
  weekday        Int      // 0 = Monday … 6 = Sunday (match mondayOfWeekStr)
  weightBps      Int      // basis points of the week (0–10000)
  isOverride     Boolean  @default(false)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@unique([storeId, weekday])
  @@index([organizationId, storeId])
}

/// Shift blocks / dayparts with minimum-staffing rules. Org default (storeId
/// null) with optional per-store overrides — same pattern as LaborSettings.
model LaborDaypart {
  id                 String   @id @default(cuid())
  organizationId     String
  storeId            String?  // null = org default
  name               String   // e.g. "Opening", "Mid", "Close"
  startLocalMinutes  Int      // minutes from local midnight (e.g. 480 = 8:00a)
  endLocalMinutes    Int      // exclusive
  minHeadcount       Int      @default(1)
  requiresSupervisor Boolean  @default(false)
  sortOrder          Int      @default(0)
  active             Boolean  @default(true)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  @@index([organizationId])
}
```

No shift-*assignment* table — Phase 2 recommends coverage, it does not persist an assigned schedule. Persist a snapshot only if the audit shows the dashboard needs it for performance; if so, raise it as a fork. If a partial unique index is needed for the `LaborDaypart` org-default (storeId null), add one exactly like `LaborSettings_org_default_key` and document it in `LABOR.md`.

---

## 5 · The engines (pure functions — no DB, unit-testable)

### 5A · Daily hour split

```
splitWeeklyHoursToDays({ totalSchedulableHours, weightsByWeekday }) -> { weekday, hours }[]
```

- `hours[d] = floor((totalSchedulableHours × weightBps[d] / 10000) × 2) / 2` (round down to 0.5).
- Return the per-day array (sums to ≤ total; the rounding remainder is the buffer — report it).
- If weights are missing/zero, fall back to an even split across **open** days.

### 5B · Minimum-staffing coverage engine

```
computeDailyCoverage({ dayHours, storeHours, dayparts, demandShape, positions }) -> DailyCoverageResult
```

Reuse `labor-coverage.ts`'s demand distribution, then apply rules:

1. Operating window from `storeHours` for that weekday (fallback: demand-shape inference, as today).
2. Distribute `dayHours` across open hours proportional to `demandShape`.
3. **Enforce rules** per hour: `headcount ≥ max(1, daypart.minHeadcount)`; if any covering daypart `requiresSupervisor`, ensure ≥ 1 supervisory slot in that window.
4. If enforcing the floors pushes total person-hours **over** `dayHours`, do not throw — set `exceedsDailyBudget: true` and report the overage.
5. Return the integer step line (per hour), the peak window, per-daypart coverage vs. minimum, the supervisor-coverage flag, and the budget-vs-used delta.

Return every intermediate. **Write both as unit tests** in `scripts/verify-labor-coverage.ts`.

### Acceptance cases (must reproduce exactly)

**Daily split** — `totalSchedulableHours = 182.0`, weights (bps) Mon–Sun = `1000/1200/1300/1500/1800/2000/1200`:

| Day | Calc | Hours |
|---|---|---|
| Mon | 182 × .10 = 18.2 | **18.0** |
| Fri | 182 × .18 = 32.76 | **32.5** |
| Sat | 182 × .20 = 36.4 | **36.0** |

(Assert the full 7-day array and that the sum ≤ 182.0 with the remainder reported.)

**Coverage invariants** — for any day with a demand shape and open window, assert: every open hour `headcount ≥ 1`; a `requiresSupervisor` daypart always has supervisor coverage; and `exceedsDailyBudget` flips true when the summed floors exceed `dayHours` (construct a tight case, e.g. a 12-hour open day with `dayHours = 8` and three `minHeadcount ≥ 1` dayparts).

---

## 6 · Phase deliverables

### 2A — Daily hour split (must ship)
- `LaborDaySplit` model + additive migration. Auto-seed weights from trailing sales (reuse `SalesPeriodCache`); recompute on demand.
- `splitWeeklyHoursToDays` pure fn + fixture.
- **Settings › Labor:** a per-store day-of-week weight editor (ADMIN/MANAGER) — edit/override the split, "reset to sales-derived" action.
- API: `GET/PUT /api/labor/day-split` (org-scoped, reuse the guards).

### 2B — Shift templates + coverage engine (should ship; may defer if the session runs long)
- `LaborDaypart` model + migration; CRUD on `/settings/labor` (name, window, min headcount, requires-supervisor, sort, active). Seed sensible defaults (Opening/Mid/Close) on enable.
- `computeDailyCoverage` pure fn + fixture.
- **Upgrade the dashboard Coverage card** to the rule-based engine: same step line, now with a supervisor-coverage indicator, per-daypart min badges, and an under/over-coverage flag. Keep the "Recommended · guidance" label and the single headcount axis.
- If 2B can't land cleanly, ship 2A and leave 2B as a noted follow-up.

---

## 7 · RBAC

- **ADMIN / MANAGER:** edit day-split weights and dayparts. Reuse `requireLaborContext` (write = ADMIN+MANAGER).
- **STORE / STAFF:** read-only coverage on the dashboard (reuse `requireLaborView`).
Enforce on both the page and the server action, matching Phase 1.

---

## 8 · Out of scope (do not build)

Named-employee assignment / actual schedules · push-to-Square scheduling · actual labor from Square Timecards · per-employee wages (Team API) · OT modeling · Square-driven auto-forecasting (that's Phase 3 — `SalesForecast.source` `LAST_YEAR`/`TREND`). Leave clean seams; don't implement.

---

## 9 · Definition of done

- Audit reported and plan approved before edits.
- Migration is additive; no drops; applied to the dev branch only after approval.
- `next build` passes; `package-lock.json` committed if deps changed (none expected).
- Both acceptance cases pass (`scripts/verify-labor-coverage.ts`): the 182h daily split reproduces exactly, and the coverage invariants (floor 1, supervisor coverage, `exceedsDailyBudget`) hold.
- Both feature-flag gates verified: nothing renders when either is off.
- Empty states handled (no forecast → no split/coverage; no `StoreHours` → documented fallback).
- Coverage card stays guidance-labeled, single headcount axis.
- Out-of-scope issues noticed are listed as text, not fixed.
