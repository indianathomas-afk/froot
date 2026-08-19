# TIER 3 — AL-1: Advanced Labor Phase 1 — spec filing + timecard ingest + labor % foundation

**Session type: STRUCTURAL BUILD, plan-first with a HARD STOP.** First build
session of the Advanced Labor vision. Phase A files the spec and designs the
schema + sync, then STOPS for Gary. Phase B builds only after his explicit
proceed. No dashboard UI in this phase — Phase 1 makes the labor number exist
and be trustworthy; Phase 2 puts it on cards.

---

## Context (self-contained — do not rely on chat history)

Repo: `~/Claude_Projects/Froot/froot` (lowercase `froot` is the git root;
verify with `git rev-parse --show-toplevel`).

Read first, in order:
1. `docs/DECISIONS.md` top entries — the L-2 deferral lift, the read-only
   ruling, and the 2026-08-05 seam rulings ("Square labor integration is
   STRICTLY OPTIONAL", "A Square disconnect does NOT disable the labor
   toggle").
2. `docs/ROADMAP.yaml` — L-2 row in full: the seam design (per-org toggle,
   comparison layer, failure posture) is authoritative.
3. `docs/prompts/LABOR-0B_RESULTS.md` — Task 1c lists every construction
   site this build touches.
4. `src/app/api/square/labor/verify/route.ts` — the working example of a
   labor read: `getSquareClient(org)` only, never the personal-token
   fallback.

State this session inherits (verified 2026-08-18 on BOTH environments):
- OAuth grants carry six read scopes incl. `TIMECARDS_READ` and
  `TIMECARDS_SETTINGS_READ`; first labor read returned
  `{"ok":true,"httpStatus":200,"hasData":true}` on production.
- `SQUARE_VERSION = "2026-01-22"` at all sites via the shared constant.
- Froot is read-only toward Square, app-wide, by ruling. Nothing in this
  build may write to Square.

## The spec this build serves (Gary's vision, 2026-08-18 — file it)

Phase A Task A1 creates `docs/ADVANCED_LABOR.md` containing this feature
list VERBATIM as the north star, marked as Gary's words, with a phase map:

1. /dashboard Sales Performance card: real-time labor % alongside gross
   sales / transactions / average sale; green bar in the sales graph when
   within budget (meets or exceeds goal), red bar when not.
2. /staff page shows pay rate for all staff — Manager/Admin access only.
3. /dashboard Monthly Goal card: MTD labor % vs budget — green if
   meets/exceeds, bold red if over.
4. /dashboard All Locations: card showing MTD labor % across
   [Today · All Locations], [to Date], [Projected Month End].
5. /dashboard All Locations: Tips column — average hourly tip payout per
   location MTD.
6. /dashboard All Locations: selectable date ranges (daily, weekly,
   monthly, custom) matching the Sales Performance card.
7. /dashboard All Locations: MTD labor % column — green within budget, red
   out of budget.
8. /labor page: "Advanced Labor" option — sync labor from Square (READ
   ONLY; "sync to Square" in the original vision is superseded by the
   read-only ruling — Gary confirmed reporting data only).
9. /labor Budget settings: unchanged.
10. /labor Positions (rate legend): with Advanced Labor enabled, lists the
    store's team members from Square with pay and current positions;
    positions may vary per Square; WK HRS and SUP stay Froot-adjustable.
11. /labor Weekly → daily split: unchanged.
12. /labor Shift blocks (min staffing): unchanged.

Phase map to record in the doc: Phase 1 (this session) = toggle + ingest +
labor % foundation. Phase 2 = dashboard cards (1, 3, 4, 6, 7). Phase 3 =
/staff pay + Positions roster (2, 10) and tips (5). Items 9, 11, 12 are
explicit non-changes.

## Phase 1 scope — what this session builds

A. **Per-org toggle** — `advancedLaborEnabled Boolean @default(false)` on
   Organization (additive migration). Settings control on /settings/labor
   (or /labor — follow the existing settings pattern), ADMIN-gated via
   `square.manage`. Off by default for every org, per the seam ruling.
B. **Timecard ingest (poll, not webhook)** — a sync module
   (`src/lib/labor-actuals.ts` per the seam's naming) that pulls timecards
   from Square for an org's locations over a date range and upserts them
   into a new `SquareTimecard` table. Poll-based on demand + cron-ready;
   do NOT add webhook events (the webhook dial stays untouched, and
   DEBT-69's coalescing lesson says don't multiply webhook-driven syncs).
C. **Labor % calculation** — a pure function: labor cost (hours × wage,
   OT-aware later) over net sales for a store + range, reading
   SquareTimecard + existing sales data. Returns
   `{ laborPct, laborCost, sales, health }` where `health` reflects sync
   staleness — the seam's ON BUT UNHEALTHY posture: stale data renders as
   stale, NEVER as zero pretending to be a measurement.
D. **A read surface for verification only** — extend the pattern of
   `labor/verify`: one ADMIN-gated JSON route returning the calculation
   for a store + range, so Phase 1 is verifiable without any dashboard UI.

## Hard rules

1. Additive-only schema. New table + new column; no drops, no renames.
2. All `DateTime` columns are UTC (`TIMESTAMP(3)`, Prisma writes UTC).
   Timecard start/stop from Square arrive as RFC 3339 with offsets — store
   UTC, and record in the schema comment that display-local conversion
   uses `Organization.timezone`. Do not repeat the UTC/local false-
   investigation trap documented in CLAUDE.md.
3. Wage data is DEBT-10 territory: every surface exposing pay rides the
   `labor.costs.view` capability (MANAGE tier). STORE accounts are shared
   in-store logins and must NEVER receive wages, per-person hours, or
   tips — neither in JSON nor in HTML. The verify-style route in D is
   ADMIN-gated.
4. Read-only toward Square, absolutely. `getSquareClient(org)` only — the
   personal-token fallback helpers (`fetchSquareTeamMembers` etc.) must
   not be used for timecards; a sync that silently used the personal token
   would repeat the exact defect SQ-WB-1 removed.
5. No dashboard card changes. Features 1–7 are Phase 2/3.
6. No `&&` chains. `npm run build` green before each commit. Two-commit
   pattern. No push — Gary pushes.
7. Migrations run against staging Neon (`br-square-feather` /
   `ep-odd-rain`) via the established migration path only. NOTE: Neon
   storage was ~82% of the Free plan on 2026-08-17 — Phase A must estimate
   the new table's growth (rows/day at 9 stores) and surface it; if the
   estimate is material, that is a RULING NOW for Gary, not a reason to
   silently shrink scope.

## PHASE A — Plan (read-only) then HARD STOP

A1. Write `docs/ADVANCED_LABOR.md` (the one file Phase A may create):
    vision verbatim, phase map, and the Phase 1 design below filled in.
A2. Schema proposal: `SquareTimecard` fields (Square timecard id unique
    per org, teamMemberId, locationId, start/stop UTC, break minutes,
    declared cash tips, wage snapshot fields, syncedAt), indexes, and the
    Organization column. Justify each field against features 1–7 and 10 so
    nothing speculative rides in. Include the storage growth estimate
    (rule 7).
A3. Sync design: date-window strategy, upsert key, staleness/health
    definition, cadence recommendation (on-demand + which cron), and the
    idempotency argument (re-running a window must be safe — BUG-7's
    guarded-upsert lesson applies).
A4. Calculation design: exact formula for Phase 1 (simple hours × wage;
    name what is deferred — OT rules, salaried allocation, tips in labor
    cost — as OPEN QUESTIONS for Gary, with a lean each).
A5. Riders authorized by Gary: the stale comment at `permissions.ts:190`
    ("Nothing calls square.manage") gets its one-line correction in
    Phase B's work commit.
A6. HARD STOP. Present: the spec doc draft, schema, sync design, formula,
    open questions with leans, and the storage estimate. Wait for Gary's
    explicit proceed and his rulings on the open questions.

## PHASE B — Build (after Gary's go)

B1. Migration + Prisma schema (additive), `npx prisma migrate dev` against
    staging per house procedure.
B2. `src/lib/labor-actuals.ts` — sync + calculation, per approved design.
B3. Toggle UI on the labor settings surface, ADMIN-gated.
B4. Verification route (scope D), ADMIN-gated, shape-documented.
B5. `npm run build`; work commit; recorder commit updating L-2
    (in_progress, citing work SHA) and ADVANCED_LABOR.md status.

## After this session (Gary's steps — record verbatim in output)

1. Push. Wait for staging deploy green.
2. /settings labor area: turn Advanced Labor ON for the staging org.
3. Trigger the sync (the session will give the exact URL or button).
4. Hit the verification route for one store + today; confirm laborPct is
   a plausible number and health reads fresh.
5. Report results to the planning chat. Production waits for a future
   promotion — no production steps this session.

## Decisions that are NOT this session's to make

- OT/salaried/tips treatment in labor cost (Gary rules at the stop).
- Any dashboard card. Any /staff surface. Any Positions change.
- Webhook subscription changes. Cron schedule activation on production.
- Neon plan upgrade (surface the estimate; Gary decides).
