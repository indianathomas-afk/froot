# R7-C production promotion manifest

**Branch:** `br-sparkling-block` (production) · **Week:** `2026-08-10` · **Captured:** 2026-08-22
**Predicted under:** absent-means-zero + Kristie Connolly $1,000/wk, 40 hrs, Las Brisas 50% / UNR 50%
**Rule used:** `hourlyHours = floor(hourlyDollars ÷ 14.50, to nearest 0.5)` — verified against all nine BEFORE rows before predicting.
**Excluded from the strict diff:** `adjustedTotalSchedulableHours` (wall-clock dependent, S5-D33), `today`.

---

## Stores that move

| Store | Salaried hrs | Salaried $ | Hourly $ | Hourly hrs | Total sched. | Carries |
|---|---|---|---|---|---|---|
| **Carson** | 40 → **0** | 800 → **0** | 2000 → **2800** | 137.5 → **193.0** | 177.5 → **193.0** | nobody |
| **Las Brisas** | 40 → **20** | 800 → **500** | 3000 → **3300** | 206.5 → **227.5** | 246.5 → **247.5** | Kristie 50% |
| **Meadowood Mall** | 40 → **0** | 800 → **0** | 2000 → **2800** | 137.5 → **193.0** | 177.5 → **193.0** | nobody |
| **South Reno** | 40 → **0** | 800 → **0** | 2400 → **3200** | 165.5 → **220.5** | 205.5 → **220.5** | nobody |
| **Southgate** | 40 → **0** | 800 → **0** | 1800 → **2600** | 124.0 → **179.0** | 164.0 → **179.0** | nobody |
| **Spanish Springs** | 40 → **0** | 800 → **0** | 1600 → **2400** | 110.0 → **165.5** | 150.0 → **165.5** | nobody |
| **Sparks** | 40 → **0** | 800 → **0** | 1800 → **2600** | 124.0 → **179.0** | 164.0 → **179.0** | nobody |
| **UNR** | 40 → **20** | 800 → **500** | 200 → **500** | 13.5 → **34.0** | 53.5 → **54.0** | Kristie 50% |
| **University Village** | 40 → **0** | 800 → **0** | 1400 → **2200** | 96.5 → **151.5** | 136.5 → **151.5** | nobody |

## Stores that do not move

| Store | State |
|---|---|
| Cafe De Keva Cart | `budget: null` — no forecast, cannot move |
| Keva Kiosk | `budget: null` — no forecast, cannot move |

## Must not move

`blendedHourlyRate` stays **14.50** at every budgeted store. If it moves, the person record leaked into rate math and the promotion is wrong.

`salesBasis`, `conservativeSales`, `totalLaborBudget`, `projectedLaborPctAtForecast`, `forecast`, `source`, `target` — all unchanged. The budget size is not being altered; only its composition.

## What this changes in aggregate

Nine stores currently carry a phantom General Manager at $800/week — **$7,200/week estate-wide**.

After: seven carry nothing, two carry Kristie at $500 each — **$1,000/week**.

**$6,200/week** stops being charged to a manager who does not work there and becomes hourly hours instead. Roughly **$322,000/year** of labor budget moving from an archetype nobody staffs to hours a store can actually schedule.

UNR is the sharpest case: its hourly pool goes from 13.5 hours a week — under two hours a day for everyone who is not the GM — to 34.0.

---

## Sign-off

Gary reads each line above and confirms before the merge.

Signed: ______________________  Date: ______________
