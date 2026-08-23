# Manager on the floor — the Suggested prediction, PRE-REGISTERED

Written 2026-08-23, BEFORE any capture and BEFORE any engine edit, at
staging `f015d7f`. Committed so it is tamper-evident: a number that moves
onto a written prediction is a fix, one that moves without a prediction
reads as a regression, and a prediction produced after the capture is
neither.

**DERIVED FROM THE BAND.** `MANAGER_ON_FLOOR_BUILD.md`'s WHY section has
the direction inverted — it calls `gmCreditHours` allocation-derived —
and its addendum corrects it. Reasoning from the allocation reaches the
same 20 by a route the code does not take, which would make this
prediction right by luck. The derivation below starts at the drawn band.

## The arithmetic

Today, per day, from `weekly-plan/route.ts:163-167` over
`labor-coverage.ts:103`:

    suggested(d) = Σ_{h open} headcount(h)
                 = Σ_{h open} hourly(h)  +  Σ_{h open} [gm drawn at h]
                 = U(d) + G(d)

`U(d)` is `usedHourlyHours`; `G(d)` is `gmHoursByDay[d]` — the band
intersected with the open window, in whole hours.

After the build, `headcount` sheds the GM and the day's credited hours
are added back:

    suggested'(d) = U(d) + K(d)          K(d) = gmCreditHours(d)

So the per-day delta is `Δ(d) = K(d) − G(d)`, and the WEEK is where it
collapses to something exact. `capGmFloorCredits`
(`labor-daily.ts:51-57`) scales the band so the week sums to the ceiling,
and returns it untouched below the ceiling:

    ΣK = min(B, C)        B = ΣG (weekly band hours)
                          C = resolveGmCeilingHours(salariedHours, 40)

    ┌──────────────────────────────────┐
    │  ΔWEEK  =  min(B,C) − B          │
    │         =  −max(0, B − C)        │
    └──────────────────────────────────┘

**Suggested falls by exactly the amount the drawn band exceeds the
ceiling, and does not move at all where it does not.** The fall is not a
loss of coverage — it is the withdrawal of coverage that was never there.

## The numbers, per store

`hasGm` is `salaried.hasSalariedPerson` (`labor-plan.ts:249`), and the
band is guarded by it (`:282`). At every store with no allocated person
`G ≡ 0` and `K ≡ 0`.

| Store | opens | band/day | open days | B | C | **ΔWEEK** | Δ/day |
|---|---|---|---|---|---|---|---|
| Las Brisas | 07:00 | 7h (07→14) | 7 | 49 | 20 | **−29.0 h** | −4.14 |
| UNR | 08:00 | 6h (08→14) | 7 | 42 | 20 | **−22.0 h** | −3.14 |
| The other ten | — | — | — | 0 | — | **0.0 h** | 0 |

`C = 20` at both: Kristie is 50% of a 40-hour week at each. The band's
edges are the UNSET default — `gmStart = open.startHour`, `gmEnd = 14`,
the hardcoded literal (DEBT-83) — which is what both manager stores draw,
measured before R7-D.

`peakHeadcount` drops by exactly 1 during band hours at both stores, and
`peakHours` becomes the hourly peak. Intended; no compensating term.

## Assumptions, any of which moves the number

1. **Both stores open 7 days.** Each closed day removes one day's band:
   −7 from Las Brisas's B (ΔWEEK → −22), −6 from UNR's (→ −16).
2. **Opening times are 07:00 and 08:00**, and both close at or after
   14:00. Each hour later a store opens shrinks B by 7/week and moves
   ΔWEEK 7 toward zero.
3. **`salariedHours` resolves to 20 at each store**, not 40.
4. **The open windows are what the engine actually uses.** Gary entered
   real hours on a deployed branch on 2026-08-23 and BUG-14's deployed
   sweep has not run, so 1 and 2 are the numbers most likely to be stale.
   RECOMPUTE B FROM THE SWEEP BEFORE CAPTURING, and amend this file by
   appending rather than editing if it moves.

## What would falsify this

- Any of the ten non-manager stores moving by any amount. `hasGm` gates
  the band; a move there means something other than this change moved.
- `ΔWEEK ≠ C − B` at either manager store. That is `capGmFloorCredits`
  or the `Σ headcount` sum not being what this derivation says.
- Any POSITIVE delta anywhere — a sign error.
- `usedHourlyHours`, `understaffedBudget`, `supervisorGap`, the
  floor-of-1 bump, or any `labor-plan.ts` figure moving at all. This
  change is display-side; `labor-plan.ts` carries a zero diff.
- `points[].gm` changing. The band must still draw, unchanged.

## The case where the prediction is 0 for a real reason

If `B ≤ C` the delta is zero and the WINDOW IS the credited number —
`labor-daily.ts:54` returns the band unscaled. That is S5-D10's second
divergence case, the short-hours store, filed on R7-C's first blocker and
pinned at `verify-labor-position-hours.ts:146`. It needs B ≤ 20, i.e.
under 2.9 band-hours a day across 7 days, which neither manager store is
near. If a manager store ever reports ΔWEEK = 0, that is not a no-op —
it is S5-D10 going live on a visible number.
