# TIER 3 — AL-3: Advanced Labor Phase 3 — staff pay, Positions roster, tips (features 2, 5, 10)

**Session type: STRUCTURAL BUILD, plan-first with a HARD STOP.** Phase 3 is
the first phase where PER-PERSON labor data (names beside wages) reaches a
page. That makes it the most privacy-sensitive session of the track — DEBT-10
is the governing law here, ahead of feature completeness. Phase A designs and
STOPS for Gary. Phase B builds only after his explicit proceed.

---

## Context (self-contained — do not rely on chat history)

Repo: `~/Claude_Projects/Froot/froot` (lowercase `froot` is the git root;
verify with `git rev-parse --show-toplevel`).

Read first, in order:
1. `docs/ADVANCED_LABOR.md` — vision + phase map. Phase 3 = features 2, 5,
   10. Everything else is shipped or explicitly unchanged.
2. `docs/DECISIONS.md` top entries — read-only ruling, AL-1 Q1–Q8, AL-2
   rulings (Q-V capability, R1–R6, the superseded-R3 boundary note).
3. `src/lib/labor-actuals.ts` and `src/lib/labor-judgment.ts` — Phase 1/2
   foundations. `labor.actuals.view` (OPERATIONAL, per-user deniable) gates
   aggregate labor %; it does NOT license per-person data.
4. `src/lib/square.ts` — NOTE: `fetchSquareTeamMembers` /
   `fetchSquareTeamMember` still carry the personal-token fallback
   (SQ-1/SQ-3 territory). Phase 3 must NOT use them for wage data — org
   OAuth via `getSquareClient(org)` only, same law as AL-1.

State this session inherits:
- AL-1 + AL-2 live and verified on staging (work commits `be705a2`,
  `8a28f61`, `f47e3bd`). SquareTimecard stores per-timecard wage snapshot
  and declared cash tips. Production dark for all labor UI (env gate
  Preview-only).
- The scale: <= target green; grace band amber; beyond red. Actuals vs
  planned asymmetry is deliberate and fixture-guarded.

## The three features

2. **/staff shows pay rate for all staff — Manager/Admin ONLY.** Gary's
   words. Wage data on the staff list (and/or detail pages), gated at
   MANAGE tier minimum.
5. **All Locations: Tips column** — average hourly tip payout per location,
   MTD. Source of truth available today: declared CASH tips on timecards
   (AL-1 stores them). Card/electronic tips ride payments, NOT timecards —
   if not cheaply and reliably derivable from data Froot already syncs,
   the column ships as "declared cash tips only", clearly labeled, and
   card-tips become a filed follow-up. Do not invent a payments ingest to
   make a column complete.
10. **/labor Positions card, Advanced Labor ON:** replaces the predefined
   rate legend with the store's actual team members from Square — name,
   pay, current position(s). WK HRS and SUP remain Froot-adjustable
   per person (they are Froot concepts). Advanced Labor OFF = the card
   renders exactly as today.

## Hard rules — privacy first

1. **Per-person wage data is MANAGE-gated, everywhere, with no exceptions.**
   STORE accounts are shared iPad logins; a roster of names-with-wages on a
   STORE session is the DEBT-10 leak repeated on purpose. Server-side
   gating: the payload for a non-MANAGE viewer must never contain wage
   fields — not hidden in the UI, ABSENT from the response.
2. Phase A must answer explicitly: what does a STORE (or actuals-denied)
   viewer see on the Positions card with Advanced Labor ON? Options with a
   lean (e.g., roster names + positions + WK HRS/SUP without pay vs. the
   legacy legend). Gary rules.
3. Read-only toward Square. Team/wage reads via `getSquareClient(org)`
   ONLY. If team-member wage data requires touching the legacy helpers,
   the fix is routing them through the org client (SQ-3's known
   prerequisite), presented in Phase A — not building on the personal
   token.
4. Additive-only schema if any (a team-roster cache table is plausible;
   justify every field; include storage estimate per AL-1's precedent).
5. Tips NEVER enter laborCost (AL-1 Q6 ruling). Feature 5 is display-only.
6. No cron registration. No webhook changes. No `&&` chains.
   `npm run build` green before commits. Two-commit pattern. No push.

## PHASE A — Design (read-only) then HARD STOP

A1. Map /staff (list + detail) and the /labor Positions card as they exist:
    components, routes, role gating today. File:line for everything.
A2. Wage data design: where per-person pay comes from (Square team wage vs.
    timecard snapshots), freshness, whether a roster cache table is
    warranted, and how salaried members appear (this is also the chance to
    MEASURE the salaried gap AL-1 deferred — count salaried members per
    store as data, no cost math). Include the SQ-3 routing question if the
    legacy helpers are in the path.
A3. Tips math: avgHourlyTips = declared cash tips ÷ paid hours, MTD,
    per location; the "cash-declared only" label text; and a one-paragraph
    feasibility note on card tips from existing synced data (lean expected:
    file a follow-up row, do not build).
A4. Positions card design: enabled-state layout (name, position, pay,
    WK HRS, SUP), where WK HRS/SUP edits persist (existing fields vs. new),
    the disabled-state guarantee (byte-identical to today), and the
    non-MANAGE viewer answer (hard rule 2).
A5. Visibility matrix for every new surface: ADMIN / MANAGER / STORE /
    actuals-denied user — what each sees, enforced server-side.
A6. HARD STOP. Present the report, the visibility matrix, open questions
    with leans. Wait for Gary's explicit proceed and rulings.

## PHASE B — Build (after Gary's go)

B1–B3. Implement per approved design: /staff pay (MANAGE), Tips column
    (labeled), Positions roster (gated per ruling). Shared gating logic
    beside labor-judgment.ts, not inline.
B4. `npm run build`; work commit; recorder commit updating L-2 and the
    ADVANCED_LABOR.md phase map (Phase 3: staging), preserve-and-mark.
    If a migration ships, follow the house flow (migrate diff → review →
    db execute → resolve), never migrate dev.

## After this session (Gary's steps — record verbatim in output)

1. Push. Staging deploy green.
2. /staff as yourself (ADMIN): pay rates visible, plausible against Square.
3. /labor Positions card, Advanced Labor ON: real roster, real pay,
   WK HRS/SUP still editable. Toggle OFF: card is exactly the old legend.
4. All Locations: Tips column present, labeled, numbers plausible.
5. THE PRIVACY CHECK, non-negotiable: sign in as (or impersonate) a STORE
   account — tommy@keva.com is the standing test account — and confirm no
   wage appears anywhere: /staff, /labor, dashboard. If a wage is visible
   to STORE, that is a stop-everything defect; report before touching
   anything else.
6. Report all of it, screenshots welcome. Production stays dark.

## Decisions that are NOT this session's to make

- Card/electronic tips ingest (file a row if worth it; do not build).
- Salaried cost allocation (measure the gap; do not invent math).
- OT (still deferred and labeled). Cron/production activation.
- Any change to budget-setting (feature 9 remains untouched).
