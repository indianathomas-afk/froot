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

---

# ADDENDUM — 2026-08-23, the build session, at staging `1b0f89d`

APPENDED, NOT EDITED, as §"Assumptions" item 4 above instructs. Everything
above is the pre-registration and is the record of what was predicted
before the engine was touched.

## The derivation was re-done from the band, independently, and it AGREES

Re-derived at HEAD without reading the box above first, from
`labor-coverage.ts:111` and `labor-daily.ts:51-57`:

    before(d) = Σ_{h open} headcount(h) = U(d) + G(d)
    after(d)  = U(d) + K(d)
    ΔWEEK     = ΣK − ΣG = min(B, C) − B = −max(0, B − C)

Identical to the pre-registered box. **The formula half of this prediction is
confirmed, and it is now PINNED BY FIXTURE** rather than by argument —
`scripts/verify-labor-coverage.ts` §11 asserts `ΣK === C` over-cap,
`ΔWEEK === C − B === −29` for the B=49 case, and the unscaled `ΔWEEK === 0`
under-cap case. Those four checks fail against the pre-change module.

**Derived from the band, not the allocation.** The allocation enters only as
`C = resolveGmCeilingHours(salariedHours, 40)`. `B` comes from the drawn band
and nothing else, which is the route the code takes.

## THE MAGNITUDE HALF DOES NOT SURVIVE, AND THE B INPUTS ARE WHERE IT BREAKS

**`B` above is assumed, not measured, and three sources in this repo disagree
about it.** Item 4 of the assumptions predicted exactly this and said RECOMPUTE
B FROM THE SWEEP BEFORE CAPTURING. The sweep has not run.

Measured at HEAD on dev (`br-broad-wave-a6vpjdw0`), week 2026-07-20, the same
week the R7-D DEPLOY_LOG entry used, band = `min(14, close) − open`:

| store | source | open days | band/day | B | **ΔWEEK** |
|---|---|---|---|---|---|
| Las Brisas | pre-registered above | 7 | 7 | 49 | **−29.0** |
| Las Brisas | dev inferred windows | 7 | 7,7,7,7,7,6,6 | **47** | **−27.0** |
| UNR | pre-registered above | 7 | 6 | 42 | **−22.0** |
| UNR | dev inferred windows | **5** | 4 | **20** | **0.0** |

**Las Brisas is off by 2 hours** for a mundane reason the pre-registration did
not model: it opens at 08:00 on Saturday and Sunday, not 07:00, so those two
days draw a 6-hour band rather than a 7-hour one.

**UNR does not survive at all.** Its pre-registered row assumes 7 open days at
an 08:00 open. Dev's inference for that week says **5 open days at a 10:00
open**, which gives a 4-hour band and `B = 20` — exactly `C`.

## THE UNR CASE LANDS ON THIS FILE'S OWN TRIPWIRE

`B = C = 20` means `capGmFloorCredits` returns the band UNSCALED
(`labor-daily.ts:54`) and `ΔWEEK = 0`. §"The case where the prediction is 0 for
a real reason" above says this is not a no-op — **it is S5-D10's second
divergence case going live on a visible number** — and estimates it needs
"under 2.9 band-hours a day across 7 days, which neither manager store is
near". That estimate assumed 7 open days. **At 5 open days the threshold is 4.0
band-hours a day, and UNR's inferred window sits exactly on it.**

The tripwire fired against the file's own reasoning, one assumption earlier
than the file expected it to.

## THE REPO ALREADY CONTRADICTED ASSUMPTION 1, ONE DAY BEFORE IT WAS WRITTEN

`docs/DEPLOY_LOG.md:72`, the R7-D entry, measured **"1 of 5 open days"** at UNR
for this same week. The pre-registration's assumption 1 says both stores open
7 days. **These are the same repo, one day apart, and they disagree.** The
R7-D figure is the measured one.

## SO WHAT THE PREDICTION IS, RESTATED HONESTLY

**ΔWEEK = −max(0, B − C), with C = 20 at both stores. That is the prediction,
and it is confirmed.** The per-store numbers are a FUNCTION of B and cannot be
closed out from here:

| B (weekly band hours) | ΔWEEK at C = 20 |
|---|---|
| ≤ 20 | 0.0 — S5-D10 case 2, live on a visible number |
| 30 | −10.0 |
| 42 | −22.0 |
| 47 | −27.0 |
| 49 | −29.0 |

**Why no branch settles it.** Dev holds ZERO salaried allocation — measured
this session, all nine stores return `hasGm` false and `B ≡ 0`, so dev cannot
draw a band at all and its windows are pure sales inference. The deployed
branches hold the allocation AND the `StoreHours` rows Gary entered on
2026-08-23, and `vercel env pull` is banned, so that is a Neon console read and
it is Gary's.

## AND BUG-14 MAKES THE DEPLOYED B UNKNOWABLE FROM THE DIALOG

This is the part that was not foreseeable when the pre-registration was
written, because BUG-14's correction landed after it.

**Some typed `StoreHours` rows are DISCARDED by the engine, so the deployed
open windows are a MIX of typed rows and sales inference, and the dialog does
not show which is which.** `labor-plan.ts:286` admits a row only when `e > s`.
Both of Gary's known errors bear on B directly:

- **`08:00`–`08:00` Mon–Fri** is discarded (`s == e`), so those five days fall
  back to inference. Their band edges are NOT the ones on screen.
- **A `01:00` Sunday open** IS admitted (`s=1`, `e=16`), and it makes that day's
  band **13 hours** instead of 6 — `+7` to that store's B on its own, and it is
  at a store Kristie is 50% allocated to.

**So B cannot be read off the hours dialog.** It has to come from the engine,
which is the deployed sweep. **Do not capture the AFTER numbers until the sweep
has run and the two known-bad rows are fixed** — a capture taken now would
measure the data errors, not the ruling.

## What still falsifies this, unchanged

Every item in §"What would falsify this" above stands as written. Three are
already discharged by fixture rather than by capture: `points[].gm` unchanged,
`usedHourlyHours`/`understaffedBudget`/`supervisorGap`/the floor-of-1 bump
unchanged, and the no-band store a byte-for-byte no-op. `verify-labor-budget.ts`
is BYTE-IDENTICAL before and after (md5 `f0ce67bd3b9ddb557a974dbe7fa16914`),
which is the zero-diff proof for the plan's arithmetic — **with one stated
exception, the `parseHourEnd` fix, which is on this row deliberately and is
covered in the session report.**
