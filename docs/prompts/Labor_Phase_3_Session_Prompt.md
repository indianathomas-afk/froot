# Labor Model — Phase 3 Session Prompt

**Module:** Weekly Labor Model
**Phase:** 3 (per-store budgets · demand-shaped, budget-capped coverage · salaried GM on floor · 4-week forward scheduling)
**Builds on:** Phase 0–2 (on staging — see `../LABOR.md`, `../DECISIONS.md`)
**Session type:** Single Claude Code session. Audit-first. No edits until the plan is approved.

> This phase **reverses several Phase-2 behaviors** by operator decision (see
> `../DECISIONS.md` §"Phase 3 scope"). Read that file first.

---

## 0 · How to run this session

Standard Froot workflow (`../../CLAUDE.md`, `../../AGENTS.md`, `../WORKFLOW.md`, `../MIGRATIONS.md`):

1. **Audit first**, present a written plan (files, migration, forks) before changing anything. Wait for explicit approval.
2. **Additive-only migrations. No drops** (including Phase-2 columns already deprecated).
3. Match shipped conventions: dollars `Decimal(10,2)`, integer-cents internally, hours floor to 0.5, the existing two-gate flag.
4. **`next build` must pass**; no new deps expected.
5. **Verify-gate:** this phase is not "done" until it passes a staging pass. Don't stack the next phase on top.
6. Surface forks with a recommendation; don't guess.

---

## 1 · Locked decisions (from `../DECISIONS.md`, confirmed 7-20)

| # | Decision |
|---|---|
| 1 | **Budget is the hard cap.** Coverage never exceeds the day's budgeted hours. The conservative floor-to-tier rounding is the buffer. |
| 2 | **Demand-shaped headcount; NO fixed daypart minimums.** Heads follow the day's sales shape, capped by budget, floored at **1 opener + 1 closer**. |
| 3 | **Only the GM is salaried.** Re-seed positions to one salaried **General Manager** + everyone else hourly. |
| 4 | **GM counts on the floor, covering open→mid** (option b). The GM is a body and the supervisor during that window. |
| 5 | **Supervisor rule:** ≥1 supervisory head on floor whenever open — satisfied by the GM during their window, else an hourly supervisory position (`isSupervisory`). |
| 6 | **Future / 4-week forward.** Coverage renders future days and up to 4 weeks ahead. |
| 7 | **Future-day demand shape** = average of the **same weekday over the last 4 weeks** of `SalesHourlyCache`; fall back to last-year same-weekday (Forecasting's basis) when recent data is thin. |
| 8 | **Per-store settings.** Per-store `LaborSettings` override the org default; stores are independent and roll up to the org. |

---

## 2 · Audit checklist

1. **`src/lib/labor-coverage.ts`** (`computeDailyCoverage`) — the Phase-2 rule engine. Phase 3 **replaces the min-headcount logic** with demand-shaped + budget-cap + GM-on-floor. Report exactly how it distributes today.
2. **`src/lib/labor-budget.ts` / budget route** — `totalSchedulableHours`, `salariedHours`, `hourlyHours`. The cap = the day's hourly hours (post split/adjustment). Confirm the salaried/hourly split now that only the GM is salaried.
3. **`src/lib/labor-forecast.ts` + `SalesHourlyCache`** — Phase-2 coverage reads today's hourly cache. Phase 3 needs a **historical same-weekday hourly template** for future days. Report what history exists and how to average it.
4. **`LaborSettings`** — already has a nullable `storeId` (org default). Report the resolution needed (store row → fall back to org default) and whether a small additive column is needed for the GM on-floor window (§4).
5. **`LaborPosition` seed** (`labor-positions.ts`) — currently SM+ASM salaried. Re-seed to GM-only salaried.
6. **`LaborDaypart`** — with fixed minimums gone (decision #2), report whether dayparts are still needed at all or reduce to "supervisor-required window / open-close anchors." **Fork below.**
7. **`StoreHours`** — open/close per weekday (0=Sun), the open-window + opener/closer anchors.
8. **Rollup** (`/api/dashboard/rollup`, `pacing.ts`) — how org rollup works today, for the per-store→org story.
9. **Dashboard cards** — the Budget/Coverage cards; Phase 3 adds week/day navigation and fixes the "adjusted from N" mislabel (it fires on rounding drift).

---

## 3 · The coverage model (the core rewrite)

Replace `computeDailyCoverage` with this shape (still pure, unit-tested):

1. **Budgeted hours for the day** = the split + adjusted **hourly** hours (unchanged from Phase 2), plus the **GM's on-floor hours** counted separately (salaried, not from the hourly pool).
2. **Demand shape** for the day:
   - today/past → `SalesHourlyCache` for that date (as now);
   - **future → average the same weekday over the last 4 weeks** of `SalesHourlyCache` (fallback: last-year same-weekday). One clearly-commented helper.
3. **Distribute** the day's hourly budget across open hours **proportional to demand** — this is the headcount curve (1 at 2p, 3 at 3p). **No fixed daypart minimums.**
4. **Floors:** ≥1 during open hours; explicitly ensure **≥1 at the opening hour and ≥1 at the closing hour** (opener/closer).
5. **GM on floor (open→mid):** during the GM window, the GM is **+1 supervisory body**. Net hourly heads shown = demand curve; annotate that the GM covers 1 + the supervisor role in that window (so hourly need is effectively −1 there). Keep the exact treatment a single commented rule.
6. **Budget cap:** the distribution already sums to the budget; the only over-budget case is floor-1 across a long open day. If floors force the total above budget, **flag `understaffedBudget` and keep the floors** (accept thinner is about not *over*-scheduling to %, not about dropping below 1 while open).
7. **Supervisor coverage:** ≥1 supervisory head every open hour — GM covers open→mid; after that a scheduled hourly supervisory position is assumed. Flag `supervisorGap` only if no supervisory position exists at all.

Return the step line, opener/closer flags, GM-window annotation, supervisor status, and the budget-vs-used delta. **Write `verify-labor-coverage.ts` cases** for: demand-shaped (peak follows sales), opener/closer floor, GM-window supervisor coverage, budget cap, and the future-day 4-week-average shape.

---

## 4 · Data / config changes (additive)

- **Per-store `LaborSettings`:** no new table (nullable `storeId` exists). Add resolution (`getLaborSettings(orgId, storeId)` → store row ?? org default) and a per-store editor on `/settings/labor` (store picker; "inherit org default" vs override).
- **GM on-floor window:** **DECIDED** — add an additive pair on `LaborSettings`: `gmOnFloorStartMinutes` / `gmOnFloorEndMinutes` (default open→14:00), configurable per store. Square can refine it later.
- **Positions re-seed:** update `DEFAULT_LABOR_POSITIONS` to one salaried **General Manager** (implied 40h) + hourly ASM/Lead/Supervisor/Team. Existing orgs: a migration-safe reseed path or a note (don't clobber edited legends).
- **`LaborDaypart`:** **DECIDED** — keep the table, use it only for supervisor-required windows / named blocks; **drop `minHeadcount` from the UI but retain the column** (no drops).
- No `denominator`/`projectedDelivery` work — already deprecated.

---

## 5 · Forward scheduling UI

- **Week navigation** on the dashboard Budget + Coverage cards (or a dedicated `/labor` schedule view): pick the week (this week … +4) and the day within it. Budget auto-forecasts from `DailyGoal` (already works for future weeks); coverage uses the future-day demand template.
- Coverage no longer clamps to today/past.
- Fix the **"adjusted from N"** label to show only when a real `LaborDayAdjustment` exists (not on rounding drift).
- Per-store rollup: the existing rollup view stays; ensure labor budgets read per-store settings.

---

## 6 · RBAC

Unchanged: read = any role (`requireLaborView`); write = ADMIN + MANAGER (`requireLaborContext`). Per-store settings respect store scope (`requireLaborStore`).

---

## 7 · Out of scope (still Phase 4)

Actual labor from Square Timecards · push-to-Square scheduling · per-employee wages / assignment · OT modeling · auto-refining the GM window from Square. Leave clean seams.

---

## 8 · Definition of done

- Audit + plan approved before edits; migration additive, no drops, dev-only until approved.
- `next build` green; `verify-labor-budget.ts` + `verify-labor-coverage.ts` green (incl. demand-shaped, opener/closer, GM window, budget cap, future-day shape).
- Coverage is demand-shaped, budget-capped, floored at opener/closer, with the GM counted on floor open→mid; no fixed daypart minimums.
- Positions seed = one salaried GM + hourly rest.
- Per-store settings resolve and roll up; future days + 4-week horizon render.
- "adjusted from N" mislabel fixed.
- Verified on a staging pass before anything else is stacked on top.
