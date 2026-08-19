# TIER 3 — AL-2: Advanced Labor Phase 2 — dashboard labor % cards (features 1, 3, 4, 6, 7)

**Session type: STRUCTURAL BUILD, plan-first with a HARD STOP.** Phase 2 puts
the Phase 1 number on the dashboard: labor % on the Sales Performance card,
the Monthly Goal card, and the All Locations view, with green/red budget
judgment. Phase A designs every card change and STOPS for Gary. Phase B
builds only after his explicit proceed.

---

## Context (self-contained — do not rely on chat history)

Repo: `~/Claude_Projects/Froot/froot` (lowercase `froot` is the git root;
verify with `git rev-parse --show-toplevel`).

Read first, in order:
1. `docs/ADVANCED_LABOR.md` — the vision (Gary's words) and the Phase 1
   design record. Phase 2 = features 1, 3, 4, 6, 7. Feature 5 (tips) and
   features 2/10 (/staff pay, Positions roster) are Phase 3 — OUT of scope.
2. `docs/DECISIONS.md` top entries — read-only ruling, deferral lift, and
   the AL-1 rulings (Q1–Q8, recorded via the AL-1 session).
3. `src/lib/labor-actuals.ts` — the Phase 1 module. Its `getLaborActuals`
   aggregate shape is the ONLY labor data source Phase 2 may read. Do not
   add per-person reads to any dashboard payload.
4. The dashboard components behind the Sales Performance card, Monthly
   Goal card, and All Locations table, plus the labor budget model
   (weekly labor model / budget settings on /labor) — locate and read all
   of them in Phase A; list file:line in the report.

State this session inherits:
- AL-1 shipped to staging (work `be705a2`, recorder `2d1c8ae`) and was
  verified live 2026-08-19 with real output: laborPct 33.7% at Las Brisas,
  2 open timecards, health fresh. The number exists and is trusted.
- `squareLaborEnabled` (per-org, default false) + `SQUARE_LABOR_AVAILABLE`
  env gate (Preview only today). Production has the code but is dark.
- Cron route exists, deliberately unregistered (AL-1 Q7). Sync is
  on-demand via POST /api/square/labor/sync.

## Gary's rulings already in force for this phase

- **Budgets are NET-sales-based (Gary, 2026-08-19).** The labor % from
  labor-actuals uses net sales as denominator; Gary confirmed his budget
  targets are also set against net sales. Green/red comparisons are
  like-for-like. Record this in DECISIONS-adjacent docs if not already
  written; if the existing budget model's stored targets turn out to be
  derived from gross anywhere, that is a RULING NOW, not a silent
  conversion.
- Honesty rules carry forward from the seam: stale renders as stale
  (ON BUT UNHEALTHY posture), laborPct null renders as an em-dash or
  "no sales yet", NEVER as 0%. `otApplied:false` and `costComplete:false`
  must have visible consequences (a small footnote/asterisk), not be
  swallowed.

## Phase 2 scope — the five features

1. **Sales Performance card**: labor % displayed alongside gross sales /
   transactions / average sale; the sales graph gains a green bar when the
   store is within budget (meets or beats goal), red when over.
3. **Monthly Goal card**: MTD labor % with budget judgment — green when
   within, bold red when over.
4. **All Locations view**: an MTD labor % card across [Today · All
   Locations], [to Date], [Projected Month End].
6. **All Locations view**: date range selection (daily, weekly, monthly,
   custom) matching the Sales Performance card's existing picker.
7. **All Locations view**: per-location MTD labor % column, green within
   budget, red over.

## Hard rules

1. Aggregates only. No per-person fields in any dashboard payload — the
   labor-actuals module already enforces this; do not go around it.
2. Visibility gating is a Phase A design item with a RULING NOW attached
   (see Q-V below). Whatever Gary rules, wages and per-person data remain
   ADMIN/MANAGE-gated territory regardless — this phase renders
   percentages and dollars-in-aggregate at most.
3. `squareLaborEnabled` off, or env gate off, or Square disconnected =
   the dashboard renders EXACTLY as it does today. Zero visual change for
   non-labor orgs. The seam's boundary test applies: forecast-driven core
   unchanged with the toggle off.
4. Additive-only schema if any schema is needed (expect none; if the
   budget comparator needs a stored target, that is Phase A design +
   Gary's call, not an improvised column).
5. Read-only toward Square. No cron registration. No webhook changes.
6. No `&&` chains. `npm run build` green before each commit. Two-commit
   pattern. No push — Gary pushes.

## PHASE A — Design (read-only) then HARD STOP

A1. Map the existing dashboard: the three surfaces above, their data
    routes, their current date-range mechanics, and who can see them
    today (which roles reach the dashboard and the All Locations view).
    File:line for everything.
A2. Map the budget side: where a store's labor budget/target %
    lives today (weekly labor model? budget settings?), and define the
    comparator precisely: "within budget" = actual labor % <= target
    labor % for the same period and same net-sales basis. If no clean
    per-period target exists, present options (derive from weekly model
    vs. new stored target) with a lean — do not invent silently.
A3. Freshness design: dashboard cards need reasonably-current actuals
    with the cron unregistered. Options analysis (sync-on-load debounced
    vs. manual refresh button vs. registering the cron for staging
    sweeps), with a lean and rate-limit math (DEBT-69's lesson: no sync
    storms — one dashboard load must not fan out nine Square calls
    uncoalesced).
A4. Projection math for [Projected Month End]: propose the formula
    (lean: MTD labor cost and MTD net sales both projected by remaining
    days using the store's recent daily averages — keep it simple and
    LABEL it as a projection), with the honesty treatment for early-month
    instability.
A5. Per-card render design: exactly what each card shows in each state —
    healthy, stale, no-sales-yet, costComplete:false, toggle off. Include
    the green/red visual treatment and where the otApplied footnote
    lives.
A6. **Q-V (RULING NOW at the stop):** who sees labor % on the dashboard?
    STORE accounts are shared iPad logins (DEBT-10 principle: operational
    breadth, zero confidential data). Is aggregate labor % operational or
    confidential? Lean: MANAGER and up see labor %; STORE sees the
    dashboard exactly as today (no labor row) — matching the
    Manager/Admin instinct Gary attached to feature 2. Present the lean;
    Gary rules.
A7. HARD STOP. Present the full Phase A report and wait for Gary's
    explicit proceed plus his rulings.

## PHASE B — Build (after Gary's go)

B1–B4. Implement per approved design, one surface at a time: Sales
    Performance card, Monthly Goal card, All Locations (card + column +
    date ranges). Shared comparator + formatting utilities live beside
    labor-actuals.ts, not inline in components.
B5. `npm run build`; work commit; recorder commit updating L-2 status and
    ADVANCED_LABOR.md phase map (Phase 2: staging), preserve-and-mark.

## After this session (Gary's steps — record verbatim in output)

1. Push. Wait for staging deploy green.
2. Dashboard with a labor-enabled store selected: labor % appears on the
   Sales Performance card, plausible number, green/red matches gut.
3. Monthly Goal card: MTD % present, judgment sensible.
4. All Locations: card, column, and date ranges behave; a store with no
   timecards yet shows an honest gap, not 0%.
5. Sanity check the boundary: flip Advanced Labor OFF in /settings, reload
   the dashboard, confirm it looks exactly like it did before Phase 2.
   Flip it back ON.
6. Report all of it to the planning chat, screenshots welcome. Production
   remains dark regardless — env var still Preview-only; production
   activation is its own future decision.

## Decisions that are NOT this session's to make

- Tips (Phase 3). /staff pay + Positions (Phase 3).
- Cron registration anywhere. Production env-var activation.
- Any change to how budgets are SET (feature 9 is explicitly unchanged).
- OT math (stays deferred and labeled).
