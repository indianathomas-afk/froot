# R7-D — the double-drawn GM band: measure the coverage side, then fix it

TIER 3 — structural. Phase 1 is READ-ONLY. HARD STOP at Phase 2.
Nothing is built without Gary's explicit approval inside this session.
Branch: staging. Commit only. NEVER push.

## ESTABLISHED — do not re-litigate, verify only if cheap

Measured on staging @ c91af6c:
- labor-plan.ts:297-298 — the GM floor-credit ceiling IS the store's own
  salariedHours (20 at Las Brisas, 20 at UNR under R7-C). Hours are NOT
  double-credited. Money is settled: 35d002a AFTER matched the signed
  manifest at all nine stores.
- labor-plan.ts:282-284 — the band window comes from
  LaborSettings.gmOnFloorStartMinutes/EndMinutes with NO allocation term.
- labor-plan.ts:249 — hasGm = salaried.hasSalariedPerson, true at exactly
  the two allocated stores.
- labor-coverage.ts:67,87,98,102,107 — the coverage engine treats the GM as
  an UNCAPPED WHOLE BODY in four places and never learns about allocation.

THE DEFECT IN ONE LINE: labor-plan credits half a manager every day;
labor-coverage counts a whole manager every day. The worst consequence is
labor-coverage.ts:87 — during the band, hourly heads may be ZERO and the
floor-of-1 is considered satisfied, at BOTH stores.

## PHASE 1 — MEASURE. Read-only. No writes, no edits, no migrations.

Report a table for Las Brisas and UNR, current week, and say which Neon
branch every figure came from IN THE SAME OUTPUT:

  1. salariedHours and salariedCost
  2. Sigma gmCreditHours for the week (expect == salariedHours == 20)
  3. RAW GM band hours for the week (gmOnFloor window intersect open)
  4. Sigma headcount over open hours — the Suggested figure
  5. COUNT OF OPEN HOURS where hourly == 0 AND gmAt(h) is true.
     THIS IS THE NUMBER THAT MATTERS. It is the count of hours a store
     plans with nobody in it on the belief the GM is present.
  6. supervisorGap: its value, and what it would be with the GM removed

Then answer three scoping questions with file:line:

  A. Does labor-coverage's floor-of-1 bump feed back into ANY budget or
     hours figure, or is it display-only? Trace it. Do not assume.
  B. Does the coverage engine's call site have access to the allocation
     fraction (bps) today, or must it be threaded through? Name the call
     site and what it currently passes.
  C. Across all nine budgeted stores, is hasGm true at exactly two?

## PHASE 2 — STOP. REPORT. WAIT.

No file outside docs/ is touched before Gary approves. Present the table,
the three answers, and the real diff size of Phase 3.

## PHASE 3 — BUILD, on approval only

Gary's lean, to be confirmed or replaced in-session:

  A salaried person allocated UNDER 100% to a store may be DRAWN on that
  store's coverage chart, but may NOT satisfy the floor-of-1, may NOT be
  added to headcount as a whole body, and may NOT suppress supervisorGap.

Rejected and recorded so neither is rediscovered as new:
- Scaling the BAND WIDTH by allocation — invents a schedule. L-4's job.
- A FRACTIONAL body in headcount — arithmetically neat, operationally
  meaningless; half a person cannot open a store.

Constraints:
- Additive only. No schema. No migration. No drops.
- labor-plan.ts gets a ZERO DIFF unless Phase 1 finding A says otherwise.
- Fixture first: extend scripts/verify-labor-coverage.ts to cover the
  under-100% case BEFORE the engine change, and show it failing.
- Capture BEFORE and AFTER at Las Brisas and UNR. No dollars may move.
- COMMENT, not a row: labor-plan.ts:297 — resolveGmCeilingHours(0, 40)
  returns 40, inert only because hasGm is false. Name it at the site.
- Deviation numbers come from ROADMAP.yaml's next-free, NOT from this
  prompt (S5-D56 — three collisions in four sessions).
- Preserve-and-mark. Two-commit pattern. Gate: scoped eslint then
  npm run build. No bare npm run lint (DEBT-33).

Triage everything found and not fixed: FIX NOW / RULING NOW / COMMENT /
ROW. Default to the first three. Report the count in each bucket.

## OUT OF SCOPE — do not get pulled in
L-4 itself. The band's day-shape. S5-D15..D17. The unscheduled cron.
Emmalea England. BUG-13. DEBT-72. DEBT-80/81/82.
