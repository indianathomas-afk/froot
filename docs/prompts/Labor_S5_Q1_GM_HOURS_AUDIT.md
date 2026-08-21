# Labor Q1 — GM hours in scheduling figures · AUDIT

**Date:** 2026-08-21 · **Tier:** audit only, nothing built
**Ruling this answers:** `docs/DECISIONS.md` § "Scheduling hours count the whole
crew, GM included" (2026-08-21, Gary)
**Status:** proposals only. Numbered deviations run S5-D9 onward. Copy is Gary's
call and nothing below changes any string.

---

## 1. The arithmetic — CONFIRMED, and it is stronger than a measurement

Gary's arithmetic is not merely correct for the week he sampled. **It is an
identity that holds by construction, at every store, every week.**

```
labor-budget.ts:100    totalSchedulableHours = salariedHours + hourlyHours
labor-plan.ts:281      adjustedTotalSchedulableHours
                         = budget.salariedHours + Σ days[].hourlyHours
route.ts:106           hoursAllocated = d.hourlyHours          ← the day card
weekly-plan-client.tsx:272   Schedulable = adjustedTotalSchedulableHours
weekly-plan-client.tsx:319   the bare "19.0 hrs" on the card = hoursAllocated
```

`Schedulable − salariedHours ≡ Σ day cards` is [labor-plan.ts:281](../../src/lib/labor-plan.ts) rearranged. UNR's
`148.0 − 40 = 108.0` and `148.5 − 40 = 108.5` are that line, twice. There was no
coincidence to rule out.

### The three figures, named

| Figure | Source | Includes GM? | Budget-capped? |
|---|---|---|---|
| **Day card hours** (`hoursAllocated`) | [route.ts:106](../../src/app/api/labor/weekly-plan/route.ts) ← `d.hourlyHours` ← [labor-plan.ts:276](../../src/lib/labor-plan.ts) ← `budget.hourlyHours` [labor-budget.ts:96](../../src/lib/labor-budget.ts) | **NO** | **YES** — derived from `conservativeSales`, the sales basis floored to the rounding tier ([labor-budget.ts:63](../../src/lib/labor-budget.ts)) |
| **Comparison Suggested** | [route.ts:160-164](../../src/app/api/labor/weekly-plan/route.ts) — `Σ points[open].headcount`, and `headcount = hourly + (gm ? 1 : 0)` ([labor-coverage.ts:98](../../src/lib/labor-coverage.ts)) | **YES** | **Partly.** The hourly part is capped; the GM band is added on top; floor-of-1 bumps can push it over ([labor-coverage.ts:86-89, 121](../../src/lib/labor-coverage.ts)) |
| **Comparison Scheduled** | [route.ts:169](../../src/app/api/labor/weekly-plan/route.ts) → `computeScheduledHoursByDay` ([labor-schedule.ts:1278](../../src/lib/labor-schedule.ts)) | **Whatever Square says.** If the GM is on a Square shift they are in it; if not, not. Froot does not decide | **NO** — observed data, no cap of any kind |

### The gap is not purely the GM window

```
Suggested − day card = (Σ integer hourly heads − d.hourlyHours) + (GM on-floor hours)
                        └─ integerisation delta ─┘
```

`computeDailyCoverage` places `Math.round(hourlyBudgetHours)` **integer** heads by
largest-remainder ([labor-coverage.ts:72-83](../../src/lib/labor-coverage.ts)) and then bumps any hour below a
floor of one total body ([:86-89](../../src/lib/labor-coverage.ts)). So the observed 7, 7, 7, 8 are *dominated*
by the GM window but are not guaranteed to equal it. **Any fix that assumes
gap ≡ GM hours will drift on floor-bumped days.** This is the main reason the
recommendation below adds a GM figure rather than reverse-engineering the gap.

---

## 2. THE BLOCKING QUESTION — answered: no forecast-engine edit. **Not blocked.**

**The day-card figure is a rendering of the LABOR BUDGET. The forecast engine is
not in its path and does not produce hours at all.**

```
getWeeklyForecast          labor-forecast.ts   →  SALES DOLLARS
computeWeeklyLaborBudget   labor-budget.ts:96  →  hourlyHours   (dollars ÷ blended rate)
splitWeeklyHoursToDaysFloorFirst  labor-daily.ts:68  →  per-day base
applyDayAdjustment         labor-daily.ts:39   →  d.hourlyHours
route.ts:106                                   →  hoursAllocated
```

The forecast engine's entire output is `{ total, source }` — a dollar figure
([labor-plan.ts:176](../../src/lib/labor-plan.ts)). Hours first exist two steps later. **Including the GM in the
day figure requires touching neither `labor-forecast.ts` nor the demand-shape
path.** L-2 stands untouched: nothing here reads a Square-sourced input, and the
schedule overlay still feeds nothing.

**Better still, no engine need change at all.** The per-day GM figure the
recommendation uses is `DayPlan.gmCreditHours`, which **already exists**
([labor-plan.ts:121, 219, 269](../../src/lib/labor-plan.ts)) and is already on the object the route maps at
[route.ts:86](../../src/app/api/labor/weekly-plan/route.ts). The change can be a pure display addition in the route.

---

## 3. Every surface carrying an hours figure

| # | Surface | Figure | Crew today | Labelled today? |
|---|---|---|---|---|
| 1 | **/labor day card** [weekly-plan-client.tsx:319](../../src/app/\(app\)/labor/weekly-plan-client.tsx) | `hoursAllocated` | hourly only | **NO — bare "19.0 hrs"** |
| 2 | **/labor Schedulable header** [:272](../../src/app/\(app\)/labor/weekly-plan-client.tsx) | `adjustedTotalSchedulableHours` | hourly **+ GM** | no |
| 3 | **/labor DayDetail** [:667-668](../../src/app/\(app\)/labor/weekly-plan-client.tsx) | `hoursAllocated` | hourly only | **YES — "Hourly hours"** |
| 4 | **/labor Floor need** [:669-670](../../src/app/\(app\)/labor/weekly-plan-client.tsx) | `floorHours` | hourly only (open − GM credit, [labor-plan.ts:220](../../src/lib/labor-plan.ts)) | partly |
| 5 | **/labor comparison Suggested** [:399-401, 425](../../src/app/\(app\)/labor/weekly-plan-client.tsx) | `suggestedHours` | hourly **+ GM** | **YES — [:457](../../src/app/\(app\)/labor/weekly-plan-client.tsx) "counts the GM on floor"** |
| 6 | **/labor comparison Scheduled** [:408-410, 428](../../src/app/\(app\)/labor/weekly-plan-client.tsx) | `scheduledHours` | Square's crew | no |
| 7 | **/labor Rebalancer inputs** [:488, 496-497, 512, 574](../../src/app/\(app\)/labor/weekly-plan-client.tsx) | `splitHourlyHours` / `overrideHours` | hourly only | **YES — "weekly hourly budget"** |
| 8 | **Dashboard Labor Budget headline** [labor-budget-card.tsx:184-189](../../src/app/\(app\)/dashboard/labor-budget-card.tsx) | `totalSchedulableHours` | hourly **+ GM** | "schedulable this week" |
| 9 | **Dashboard Labor Budget breakdown** [:252, 254](../../src/app/\(app\)/dashboard/labor-budget-card.tsx) | `salariedHours` / `hourlyHours` | split out | **YES — "Salaried (fixed)" / "Hourly pool"** |
| 10 | **Dashboard Coverage legend** [labor-coverage-card.tsx:286](../../src/app/\(app\)/dashboard/labor-coverage-card.tsx) | the curve | hourly **+ GM** | **YES — "(incl. GM)"** |
| 11 | **Dashboard Coverage budget chip** [:452](../../src/app/\(app\)/dashboard/labor-coverage-card.tsx) | `hourlyBudgetHours` | hourly only | **YES — "Hourly budget"** |
| 12 | **Understaffed banners** [:340](../../src/app/\(app\)/dashboard/labor-coverage-card.tsx) and [weekly-plan-client.tsx:694](../../src/app/\(app\)/labor/weekly-plan-client.tsx) | `usedHourlyHours` vs `hourlyBudgetHours` | hourly only, both sides | yes, internally consistent |
| 13 | **/settings/labor split editor** [labor-settings-client.tsx:144-145](../../src/app/\(app\)/settings/labor/labor-settings-client.tsx) | percentages, not hours | n/a | **YES — states the rule** |

**No export, report, or store-view surface carries any of these.** The complete
consumer set of the plan/budget engines is five API routes
(`weekly-plan`, `coverage`, `budget`, `day-hours`, `day-split`) plus
`/settings/labor`; `/reports` and `/store-view` reference none of it, and
`labor-judgment.ts` contains no hours figure at all.

### The finding inside the finding

**Row 1 and row 3 are the same number, one labelled and one bare, on the same
page.** `DayDetail` calls it "Hourly hours"; the card two hundred pixels above
calls it nothing. The bare one is the one Gary read.

### Row 7 is the trap

**The Rebalancer is an hourly-pool editor and it WRITES ROWS.** Its inputs are
`splitHourlyHours`/`overrideHours`, its client guard is against
`weekly.hourlyHours` ([:512](../../src/app/\(app\)/labor/weekly-plan-client.tsx)) and its server guard is
`plan.weeklyHourlyHours` ([day-hours/route.ts:57](../../src/app/api/labor/day-hours/route.ts)). If the day card above it
starts reading GM-inclusive while these stay hourly-only, a manager reads "19.0"
on the card and types "19.0" into the input **and has pinned a different
quantity.** Row 7 must stay hourly-only and must say so louder than it does.

---

## 4. What the numbers become

**Everything below is arithmetic over Gary's own screenshots and the code. No
database was queried** — deployed-environment reads go through the Neon console
(CLAUDE.md § Environment Variables), so the per-day GM split for UNR is derived,
not measured, and is marked where that matters.

The choice of GM number decides the answer, and **there are three of them in the
system today, with three different weekly totals**:

| Candidate | Where | UNR weekly total |
|---|---|---|
| `budget.salariedHours` — Σ `impliedWeeklyHours` on SALARIED positions | [labor-budget.ts:76](../../src/lib/labor-budget.ts) | **40** (a planning constant) |
| `gmCreditHours` — GM window ∩ open, scaled so the week ≤ 40 | [labor-plan.ts:219](../../src/lib/labor-plan.ts) → [labor-daily.ts:51](../../src/lib/labor-daily.ts) | **40** (exactly, when uncapped > 40) |
| Raw GM on-floor hours — the band `computeDailyCoverage` actually draws | [labor-plan.ts:213](../../src/lib/labor-plan.ts), [labor-coverage.ts:67](../../src/lib/labor-coverage.ts) | **≈54–56** (7–8h × 7 days, uncapped by design) |

### Under the recommendation (`gmCreditHours`), UNR week of Aug 17

`capGmFloorCredits` scales by `40 / total`, so with raw GM hours of 7/7/7/8/8/8/8
(= 53) the scale is `40/53 ≈ 0.7547`:

| Day | Card before | GM credit (derived) | Card after |
|---|---|---|---|
| Mon | 19.0 | ≈5.28 | ≈24.3 |
| Tue | 21.0 | ≈5.28 | ≈26.3 |
| Wed | 19.0 | ≈5.28 | ≈24.3 |
| Thu | 13.0 | ≈6.04 | ≈19.0 |
| Fri | 17.0 | ≈6.04 | ≈23.0 |
| Sat | 12.0 | ≈6.04 | ≈18.0 |
| Sun | 7.0 | ≈6.04 | ≈13.0 |
| **Σ** | **108.0** | **40.0** | **148.0** |

**Schedulable: 148.0 before, 148.0 after — unchanged.** The header is already
GM-inclusive and is already correct; it is the day cards that move up to meet it.
**Σ day cards = Schedulable becomes true on screen**, which is the whole point.

The raw 7/7/7/8/8/8/8 split is inferred from Gary's observed Mon–Thu gaps and a
7a–3p GM window; the *total* (40.0) is exact regardless of how the days divide,
because `capGmFloorCredits` scales to the cap exactly. **Per-day figures need one
staging read to confirm; the weekly total does not.**

### ⚠ The identity rests on two independent 40s

`WEEKLY_GM_CAP_HOURS = 40` is **hardcoded** at [labor-plan.ts:29](../../src/lib/labor-plan.ts).
`budget.salariedHours` is **summed from `LaborPosition.impliedWeeklyHours`** at
[labor-budget.ts:76](../../src/lib/labor-budget.ts). They coincide at UNR. Nothing makes them coincide.

They diverge in two real cases: an admin sets the GM's implied weekly hours to
anything but 40, or the GM's window ∩ open sums to **under** 40 for the week (a
short-hours store), in which case `capGmFloorCredits` returns the hours unchanged
([labor-daily.ts:54](../../src/lib/labor-daily.ts)) and Σ credits < `salariedHours`. Then
`Σ day cards ≠ Schedulable` again — **the same defect, quieter, at a different
store.** See S5-D10.

---

## 5. Dollars and labor percentage — Gary's lean HOLDS, conditionally

**It holds under a display-additive change. It does NOT hold under an
engine-level change, and the failure would be silent.**

```
route.ts:93-95
  salariedShare  = salariedCost × (day forecast ÷ week forecast)
  dayLaborCost   = d.hourlyHours × blendedRate + salariedShare
  projectedLaborPct = dayLaborCost ÷ forecastSales × 100
```

**The dollar math already counts the GM** — that is what `salariedShare` is. So
if `d.hourlyHours` were mutated in place to include GM hours, line 94 would
(a) **double-count the GM**, once in hours-times-rate and again in
`salariedShare`, and (b) **cost the GM's hours at the hourly blended rate**,
which is the wrong rate for a salaried person. Every day's projected labor % on
`/labor` would rise, wrongly, with nothing on screen indicating a change.

Three further consumers of the same field would move with it:
`weeklyHourlyAllocated` ([labor-plan.ts:280](../../src/lib/labor-plan.ts)), `adjustedTotalSchedulableHours`
([:281](../../src/lib/labor-plan.ts) — Schedulable would gain the GM twice), and the Rebalancer's
server-side guard ([day-hours/route.ts:57](../../src/app/api/labor/day-hours/route.ts)).

**Conclusion: `d.hourlyHours` is load-bearing for money and must not change
meaning.** The GM-inclusive figure has to be a NEW field alongside it. Under
that constraint Gary's lean is exactly right — no dollar or percentage
computation changes at all.

---

## 6. The ADMIN-only toggle

**Recommendation: a view toggle with no persistence, no new capability, and no
schema change — gated by ABSENCE in the payload rather than by a client
conditional.**

Why not the alternatives:

- **A new capability** (`labor.hours.gmExcluded.view`): Gary said follow the
  existing pattern rather than invent. It would also have to enter
  `ENFORCED_CAPABILITIES` to be denialable, and `labor.manage` is deliberately
  **held out** of the override grid ("Labor governance is its own ruling",
  [permissions.ts:299-303](../../src/lib/permissions.ts)). A new one would reopen that.
- **A per-org setting**: schema change, which Gary would rather avoid, and it is
  the wrong shape — this is one admin's momentary lens, not an org policy.
- **A view toggle**: the S4 legend toggle is the precedent — "display state only,
  resetting on day navigation" (DECISIONS.md, 2026-08-20), no fetch, no
  round-trip, no persistence.

**The mechanism.** The route already carries `canManage` ([route.ts:60](../../src/app/api/labor/weekly-plan/route.ts)) and
`ctx.isAdmin` is available on the same context. Ship the GM-excluded figures
**only when `ctx.isAdmin`**, as an absent key otherwise — the exact pattern
`overlay` and `comparison` already use ([coverage/route.ts:84-85](../../src/app/api/labor/coverage/route.ts),
[weekly-plan/route.ts:125-126](../../src/app/api/labor/weekly-plan/route.ts)). A MANAGER's payload then **cannot** carry the
GM-excluded view under any code path, which makes "not visible to MANAGER or
STORE" a property of the response rather than a promise a client is keeping.

**Ship both crews fully computed server-side**, not a GM number for the client to
subtract. The day card and Suggested rest on *different* GM bases (§4), so
client-side subtraction would eventually mix them.

**Scope:** `/labor` day cards, the Schedulable header, DayDetail, and the
comparison's Suggested column. **Not** the dashboard cards — rows 8-11 are
already correctly labelled and are STORE-visible, so putting an admin lens on
them is a separate question. **Not** the Rebalancer, which stays hourly-only
(S5-D11).

---

## 7. "Forecast", "suggested", "scheduled", "recommended" — used as synonyms

Gary is right that this is half the confusion. **Four words, and on one chart
three of them name the same curve.**

| Where | Word | Actually means |
|---|---|---|
| [weekly-plan-client.tsx:268](../../src/app/\(app\)/labor/weekly-plan-client.tsx), [:663](../../src/app/\(app\)/labor/weekly-plan-client.tsx) | **Forecast** | sales DOLLARS |
| [:453](../../src/app/\(app\)/labor/weekly-plan-client.tsx) and [labor-coverage-card.tsx:469](../../src/app/\(app\)/dashboard/labor-coverage-card.tsx) | **"showing the forecast only"** | the SUGGESTED COVERAGE CURVE — not dollars |
| [labor-coverage-card.tsx:408](../../src/app/\(app\)/dashboard/labor-coverage-card.tsx) legend chip | **Suggested** | the curve |
| [labor-coverage-card.tsx:662](../../src/app/\(app\)/dashboard/labor-coverage-card.tsx) tooltip | **Recommended** | **the same curve, same dataKey** |
| [labor-coverage-card.tsx:238](../../src/app/\(app\)/dashboard/labor-coverage-card.tsx), [weekly-plan-client.tsx:658](../../src/app/\(app\)/labor/weekly-plan-client.tsx) badge | **Recommended · guidance** | the same curve again |
| [weekly-plan-client.tsx:194](../../src/app/\(app\)/labor/weekly-plan-client.tsx) page subtitle | "forecast, hours, and **recommended** coverage" | three different things in one line |
| [:408](../../src/app/\(app\)/labor/weekly-plan-client.tsx), [:428](../../src/app/\(app\)/labor/weekly-plan-client.tsx) | **Scheduled** | Square's mirrored shifts — the only unambiguous one |

**The sharpest instance:** hovering the curve says *Recommended*; the chip beside
it says *Suggested*; the empty state calls it *the forecast*; and the word
*Forecast* elsewhere on the same page is a dollar amount. `Scheduled` is the only
term that means one thing everywhere.

**Not proposing copy** — Gary's call. Flagged as S5-D13 with the observation that
collapsing to two words (one for the plan, one for Square's shifts) would remove
more confusion than any number change in this audit.

---

## Options, with a lean

### ▶ OPTION 1 — display-additive at the route (**recommended**)

Add a new GM-inclusive field to the day payload; leave `d.hourlyHours` untouched.
No engine edit, no schema, no dollar-math change. The GM component is
`d.gmCreditHours`, which already exists on the object the route maps.

- Σ day cards = Schedulable becomes true on screen (at UNR, exactly).
- `hoursAllocated`'s current meaning is preserved for money, `weeklyHourlyAllocated`,
  and the Rebalancer guard.
- Cost: the two-independent-40s coupling (§4) stays live and needs S5-D10.

### OPTION 2 — engine-level: make `DayPlan.hourlyHours` GM-inclusive

Honest in the model, one number everywhere, no parallel field. **But** it walks
straight into §5: `route.ts:94` double-counts the GM in dollars, Schedulable
double-counts in hours, and the Rebalancer's server guard changes meaning. Each
is fixable, and each fix is a separate correctness argument on a money path.
**Not recommended in a display-fix-sized session.**

### OPTION 3 — label instead of unify

Explicitly rejected by the ruling ("rather than label the discrepancy, I am
removing it"). Recorded only so the option is visibly closed.

---

## Deviations proposed

- **S5-D9** — Display-additive at the route (Option 1). No engine edit; `labor-forecast.ts`,
  `labor-budget.ts`, `labor-daily.ts` and `labor-coverage.ts` all keep a zero diff.
- **S5-D10** — The per-day GM number is `gmCreditHours`, **not** raw GM on-floor hours
  and not `salariedHours ÷ 7`. **Plus a guard:** the route should assert
  `Σ gmCreditHours == budget.salariedHours` and surface a discrepancy rather than
  let the two independent 40s drift silently into the same defect at a different
  store. Whether the guard is a log line, a page note, or a reconciliation of the
  two constants is a ruling, not an implementation detail.
- **S5-D11** — The Rebalancer stays hourly-only and its label is strengthened, because
  it writes rows and its inputs are pool values. It is the one place a
  GM-inclusive number on screen could cause a wrong WRITE.
- **S5-D12** — The toggle is admin-only by **payload absence**, no persistence, no new
  capability, no schema. Both crews computed server-side; the client never
  subtracts.
- **S5-D13** — Vocabulary: "forecast" / "suggested" / "recommended" name one curve
  across three surfaces while "Forecast" also means dollars. Flagged, not changed.

---

## What this audit does NOT establish

- **No database was queried and nothing was verified on staging.** The per-day GM
  credits in §4 are derived from Gary's screenshots plus `capGmFloorCredits`'s
  scaling rule; the weekly total (40.0) is exact from the code, the per-day split
  is not.
- **The 7/7/7/8 gaps were not decomposed against real data.** Per §1 the gap
  carries an integerisation delta as well as the GM band, and only a staging read
  can say how much of Gary's observed 7 is which.
- **Nothing was built.** No file outside `docs/` was touched.
