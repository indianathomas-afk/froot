# L-3 — Weekly Plan Report · Session Prompt

**Module:** Weekly Labor Model
**Phase:** L-3 (Weekly Plan report + floor-first daily split + cross-day rebalancing)
**Source of truth:** froot_docs/UseFroot_Labor_Model_Reset_Brief, .../Status, .../L-1_Findings
**Session type:** Single Claude Code session. Audit-first. No edits until the
plan is approved. No commit until Gary verifies on staging.

## 0 · How to run this session
Follow ../../CLAUDE.md, ../../AGENTS.md, ../WORKFLOW.md, ../MIGRATIONS.md.
1. Audit first. Read the Audit Checklist, present a written plan (files to add,
   files to touch, migration, forks) BEFORE changing anything. Wait for approval.
2. Reuse, don't reinvent. This report ASSEMBLES engines that already exist. Do
   not re-implement budget math or sales queries — call existing functions.
   EXCEPTION: this phase deliberately changes the coverage engine's hour
   ALLOCATION (floor-first) and the GM cap — see §3. Confirm in your audit
   exactly what else depends on that allocation so nothing else breaks.
3. Additive-only migrations. No drops. Neon is source of truth; show SQL, get
   approval, dev branch only.
4. next build must pass before a step is done. Reuse recharts (already a dep).
5. Scope containment. Note unrelated issues as text; don't fix inline.
6. No commit this session. Working tree only until Gary runs a staging pass.

## 0.1 · L-1 staging findings that drive this phase
Gary ran the L-1 pass. Core math verified exact ($14,900 → $14,000 → $2,800 →
18.8%). No blockers. Relevant findings:
- The floor-vs-budget conflict ("budget can't cover a floor of 1") is CONFIRMED
  on 4+ days. Root cause: the weekly→daily split allocates by SALES WEIGHT, but
  floor hours (keep one body on the floor all open hours) DON'T scale with
  sales — a slow day is open the same hours as a busy one. So L-3B rebalancing
  and the floor-first policy below are PRIORITY, not optional.
- The GM on-floor window is counted on EVERY open day, so an 8a–2p window across
  7 open days assumes ~56 GM floor-hours when a GM only works 40 — see §3 cap.

## 1 · What L-3 is
A dedicated Weekly Plan page — the digital successor to the "Chief Schedule
Strategy" spreadsheet — assembling everything a manager needs to write a week's
schedule in one view. This phase also corrects two allocation issues L-1
surfaced (floor-first split; GM 40-hour cap). Read-only except the rebalancing
write (L-3B) and the new settings toggle.

## 2 · Audit checklist (name the exact function/route to reuse for each)
1. Budget engine — computeWeeklyLaborBudget (labor-budget.ts): full return shape.
2. Coverage engine — labor-coverage.ts + /api/labor/coverage: per-day
   demand→headcount, the GM-on-floor window logic, floor + supervisor-gap flags.
   THIS IS THE FILE THAT CHANGES — report its current allocation logic in full.
3. Weekly → daily split — the per-store day-weight logic that allocates weekly
   hours across days. Report exactly how it works today (sales-weighted).
4. Forecast — how per-day / per-week projected sales are derived.
5. Hourly demand source — the SalesHourlyCache query the cards use.
6. Last-year same-weekday sales — how to query SalesPeriodCache per store.
7. Shared date hook — use-labor-date.ts (or equiv).
8. Dashboard cards — labor-budget-card.tsx & labor-coverage-card.tsx: add a link
   to the Weekly Plan page from both.
9. Nav + gating — sidebar, two-gate flag, RBAC (requireLaborView/Context).
10. Manual weather adjustment — surface it if set; build NO weather integration.

## 3 · Deliverables

### L-3A · Weekly Plan page + floor-first split + GM cap (MUST ship)

**(a) Floor-first daily split — NEW DEFAULT.**
The weekly→daily split must default to FLOOR-FIRST: guarantee each open day
enough hourly hours to cover its minimum floor (one body every open hour, minus
the GM on-floor window) BEFORE distributing the remaining hours by sales weight.
- Add a per-store setting `dailySplitPolicy` (enum FLOOR_FIRST | SALES_WEIGHTED,
  default FLOOR_FIRST) in /settings/labor. SALES_WEIGHTED = the current behavior
  (slack days may warn).
- Add an info (i) explainer in TWO places, same content: (1) next to the setting
  toggle, explaining the choice; (2) next to the Coverage-card floor warning,
  explaining the symptom. Use this plain-language slack-day example:
  "A slow day is open the same hours as a busy one, so it needs the same minimum
  staffing to keep one person on the floor — even though sales are lower.
  Floor-first guarantees those hours; sales-split warns so you can rebalance."
- NOTE: defaulting existing orgs to FLOOR_FIRST changes their current day
  allocations. That's intended, but flag it so Gary reviews existing stores'
  new allocations as part of this phase's staging pass.

**(b) GM 40-hour cap — correctness fix.**
Stop counting GM on-floor coverage past 40 hours per week. Today an 8a–2p window
across 7 open days assumes ~56 GM floor-hours; cap the GM's counted floor
coverage at 40/week so the model can't lean on hours the GM doesn't work.
(Which SPECIFIC days the GM is off is L-4 — see §7. This phase only caps the
weekly total.)

**(c) The Weekly Plan page.**
New page (established route pattern), both-gates gated, linked from both cards.
- Layer 1 — Week overview strip: 7 columns Mon–Sun (store week-start), each with
  forecast sales, last-year same-weekday actual (+delta), hours allocated,
  projected labor %, a weather chip only if the manual adjustment is set, and a
  coverage-status indicator (ok/tight/under/slack) from the coverage flags.
  Click a day to select it below.
- Layer 2 — Selected-day detail: reuse the coverage output — hourly demand shape
  with the recommended staffing step-line over it (recharts, SINGLE headcount
  axis, never dual-axis with dollars), GM band, that day's budget line, callout
  chips (peak; recommended break window as GUIDANCE text only).
- Empty states (no forecast, no hourly history, module off) show muted guidance,
  never a broken chart.

### L-3B · Cross-day hour rebalancing (PRIORITY — ship it)
Per L-1 findings this is no longer "may defer." Let ADMIN/MANAGER move allocated
hours between days within a week, constrained by the weekly total, to fix any
day the floor-first split still leaves tight.
- Needs one additive write (§4). Audit the day-split first; propose reuse-weights
  vs per-week overrides as a FORK before building.
- Week strip + day detail recompute live from the override.

## 4 · Data model (additive; names to house convention; DOLLARS + Decimal)
- LaborSettings: add `dailySplitPolicy` enum (FLOOR_FIRST | SALES_WEIGHTED),
  default FLOOR_FIRST.
- L-3B rebalancing (if per-week overrides chosen):
  model WeeklyDayHours {
    id String @id @default(cuid())
    organizationId String
    storeId String
    weekStart DateTime @db.Date
    date DateTime @db.Date
    hoursOverride Decimal @db.Decimal(6,2)
    createdById String
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt
    @@unique([storeId, date])
    @@index([organizationId, storeId, weekStart])
  }
Present the reuse-weights-vs-override choice as a fork before the migration.

## 5 · Reuse map (do not re-implement)
- Weekly budget/hours/% → computeWeeklyLaborBudget
- Per-day staffing + flags → labor-coverage.ts (MODIFIED here for floor-first + cap)
- Forecast → existing derivation
- Hourly demand → existing SalesHourlyCache query
- Last-year sales → SalesPeriodCache query
- Week/day nav → existing shared date hook
- Charts → recharts

## 6 · RBAC & gating
- Both feature-flag gates (module off → page 404s, card links hide).
- View (read-only page): requireLaborView.
- Rebalance + settings writes: ADMIN/MANAGER via requireLaborContext({write}).

## 7 · Out of scope (do not build)
- FULL GM days-off scheduling (pick which 5 of 7 days the GM works, floor falls
  to hourly on off-days) → RESERVED FOR L-4. That's the assignment layer.
  L-3 only does the weekly 40-hour CAP (§3b), not per-day GM scheduling.
- Assigning named people, per-person breaks, manager/supervisor line → L-4.
- Actual worked hours / wages from Square → L-2.
- Real weather-data integration → later optional add.
- Push-to-Square → L-4.

## 8 · Definition of done
- Audit reported, plan approved, reuse targets named, coverage-engine change
  scoped (what else depends on allocation) — before edits.
- Floor-first is the default; toggle works; info (i) explainers in both places.
- GM floor coverage capped at 40/week.
- Weekly Plan page renders week strip + day detail; empty states handled; both
  gates enforced; card links added.
- L-3B rebalancing ships, constrained to the weekly total, live recompute.
- Migration additive (dev only, post-approval).
- next build passes; no new deps (or package-lock.json committed).
- NO commit — working tree only, pending Gary's staging pass.
- Existing stores' new floor-first allocations flagged for Gary to review.
- Out-of-scope issues listed as text, not fixed.