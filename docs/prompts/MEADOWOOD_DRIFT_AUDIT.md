# What moved Meadowood — `adjustedTotalSchedulableHours` 175.5 → 175 · AUDIT

**Session:** TIER 2, audit only, 2026-08-22. **NOTHING WAS BUILT** — no file
outside `docs/` was touched.
**Artifact written because this session's entire product is analysis**
(CLAUDE.md § Where documents live, DEBT-45) and because something surprising
turned up, which TIER 2 requires be said rather than swallowed.
**Code read at:** `staging` `c568893`, working tree clean.
**Observation under audit (Gary's, measured):** staging
`/api/labor/budget?storeId=cmrd1a4l6000004k06v4sw4cq&weekStart=2026-08-10`
returned `adjustedTotalSchedulableHours` **175.5** on 2026-08-21 and **175** on
2026-08-22, re-fetched minutes later still 175. Every other field byte-identical,
`weekAdjustments` `[]` in all three reads, staging's tip `c568893` (docs-only)
throughout, no Gary action, Rebalancer never used.
**Deviations:** S5-D28 onward.

---

## 0 · The answer in one paragraph

**Nothing wrote anything. `adjustedTotalSchedulableHours` is a function of the
wall clock.** `weekStart` is pinned by the query parameter but `today` is not —
`budget/route.ts:26` computes it as `localDateStr(new Date(), store.timezone)` at
request time, and hands it to `getWeeklyDayPlan` as the third argument. Two
inputs to the daily split are trailing-56-day windows anchored on `today`
(`labor-plan.ts:171` and `:228`), so the window slides one day at midnight
Pacific, the derived day-of-week weights change, the floor-first split
redistributes, and each of seven days re-floors to 0.5 hr
(`labor-daily.ts:107`). The sum moves in 0.5 steps. **This was reproduced on
real data below: dev's Meadowood moves 176.0 → 175.5 across exactly this date
boundary with zero database writes.** "It moved once and settled" is the
signature of the diagnosis, not a complication for it — `today` changes once a
day, so a re-fetch minutes later is the same computation.

---

## 1 · What computes it, and what its inputs are

```
src/lib/labor-plan.ts:281
  adjustedTotalSchedulableHours = +((budget?.salariedHours ?? 0)
                                  + days.reduce((s, d) => s + d.hourlyHours, 0)).toFixed(1)
```

Two terms. Trace each:

**Term 1 — `budget.salariedHours`. `today`-INDEPENDENT.** `budget` is
`computeWeeklyLaborBudget` (`labor-plan.ts:173`) over `settings`, `positions` and
`forecast`. None of the three takes `today`: `resolveLaborSettings(orgId, storeId)`,
`laborPosition.findMany({organizationId, active})`, `getWeeklyForecast(storeId,
weekStart)`. **The entire budget block cannot move with the clock** — which is
exactly why Gary observed it byte-identical.

**Term 2 — `Σ days[].hourlyHours`. `today`-DEPENDENT.**

```
labor-plan.ts:276   hourlyHours = applyDayAdjustment(split, adjustmentPct)
labor-plan.ts:271   split       = override ?? base            (weekAdjustments [] -> pct 0 -> split passes through)
labor-plan.ts:232   base        = splitWeeklyHoursToDaysFloorFirst({ poolForSplit, weightsByWeekday, floorForSplit })
```

and the split's three arguments:

| Argument | Source | `today`-dependent? |
|---|---|---|
| `poolForSplit` | `budget.hourlyHours` minus any overrides (`labor-plan.ts:222`) | **no** |
| `weightsByWeekday` | saved `LaborDaySplit` rows **if any**, else `deriveDayWeightsFromSales(storeId, today)` (`labor-plan.ts:226-228`) | **YES, when no rows are saved** |
| `floorForSplit` | `openHours − gmCredit` (`:219`), where `openHours` comes from `StoreHours` **if configured**, else `inferOpenWindowsByWeekday(storeId, today)` (`labor-plan.ts:171`) | **YES, when StoreHours is empty** |

Both `today`-dependent paths are **trailing 56-day windows ending at `today`**:

```
labor-plan.ts:64,66    inferOpenWindowsByWeekday : salesHourlyCache  WHERE date BETWEEN today-56 AND today
labor-plan.ts:100,102  deriveDayWeightsFromSales : salesPeriodCache  WHERE date BETWEEN today-56 AND today
```

**And `today` is wall-clock, not a parameter:**

```
src/app/api/labor/budget/route.ts:26   const today = localDateStr(new Date(), store.timezone)
src/app/api/labor/budget/route.ts:31   const plan  = await getWeeklyDayPlan(storeId, weekStart, today)
```

`weekStart` is pinned by the caller. `today` is whatever the clock says, in the
STORE's timezone. **A historical week's per-day allocation is therefore not a
function of that week.**

### 1.1 Why the 0.5 quantum

`splitWeeklyHoursToDaysFloorFirst` floors **each of seven days independently**:

```
labor-daily.ts:107   hourlyHours: Math.floor((floor[weekday] + extra) * 2) / 2
```

The pool is unchanged, but how much each day loses to its own flooring depends on
where its allocation lands relative to a 0.5 boundary. One day crossing a
boundary moves the weekly sum by exactly 0.5. **175.5 → 175 is one such step**,
and 0.5 is the smallest move this figure can make.

### 1.2 The route exposes nothing else that could have moved

`budget/route.ts:46-53` returns `store, today, weekStart, canManage, target,
source, hasForecast, forecast, budget, adjustedTotalSchedulableHours,
weekAdjustments`. **There is no per-day data in this payload.**
`adjustedTotalSchedulableHours` is the ONLY field carrying a `today`-dependent
value. Everything else is pinned by `weekStart` or by stored rows. That is why it
moved alone, and it is a structural fact rather than a coincidence.

**One field in the payload should also have differed and was not captured:
`today` itself** (`base`, `budget/route.ts:32`). The hand-assembled JSONL format
carries `name, id, tz, hasForecast, source, forecastTotal, …` and **drops
`today`**. Had it been in the capture, the two files would have differed on
`"today":"2026-08-21"` vs `"2026-08-22"` on every line and this would have been a
five-second diagnosis instead of an audit. See **S5-D28**.

---

## 2 · Which inputs are stored rows, and every writer

| Input | Model | Every writer in `src/` |
|---|---|---|
| day weights | `LaborDaySplit` | `api/labor/day-split/route.ts:47` (upsert), `:64` (deleteMany) |
| per-date rebalance | `WeeklyDayHours` | `api/labor/day-hours/route.ts:67,69,98` — **the Rebalancer** |
| per-date adjustment | `LaborDayAdjustment` | `api/labor/day-adjustment/route.ts:49,68` |
| open windows | `StoreHours` | `api/stores/[id]/hours/route.ts:133,135` |
| **trailing sales** | **`SalesPeriodCache`** | `lib/sales-sync.ts:175-189` (raw upsert) |
| **trailing sales** | **`SalesHourlyCache`** | `lib/sales-sync.ts:208` (deleteMany) + `:218` (createMany) |
| rate legend | `LaborPosition` | `api/labor/positions/route.ts:51`, `[id]/route.ts:39,51` |
| settings | `LaborSettings` | the labor settings route |
| forecast | `SalesForecast` / `DailyGoal` | the forecasting routes |

**`sales-sync.ts` is the one that matters, and it has eleven entry points:**

```
api/webhooks/square/route.ts:121        ← Square order/payment webhook, ACK-then-resync of the store-day
api/cron/sales-reconcile/route.ts       ← vercel.json "0 11 * * *"
api/square/sales/sync/route.ts:48       ← manual sync
api/dashboard/sales/route.ts:227,236    ← lazy sync on page load
api/dashboard/rollup/route.ts:112       ← lazy sync on page load
api/dashboard/summary/route.ts:96,108   ← lazy sync on page load
api/forecasting/backfill/route.ts       ← ensureSalesCached
api/inventory/reports/{item-sales,variance,profitability,cogs}/route.ts  ← ensureSalesCached
lib/expected-inventory.ts               ← ensureSalesCached
```

**`/api/labor/budget` is not among them.** It imports `labor-access`, `reports`,
`labor-week`, `labor-plan` and nothing else (`budget/route.ts:1-5`). **Reading
the endpoint Gary read writes nothing.** Fetching it twelve times, twice, changed
no row.

---

## 3 · Can any of them fire without a deployment and without a user action?

**Yes — but none of them had to, and the Vercel scheduler did not.**

**Vercel crons: production only.** Recorded in this repo at
`docs/DEPLOY_LOG.md:52` — *"Vercel crons fire on Production only"* — written when
CRON-1 was activated. `vercel.json` registers four (`sales-reconcile 0 11 * * *`,
`pace-alerts 0 15 * * *`, `checklist-day-close 0 * * * *`, `labor-timecards 30 11
* * *`), and the scheduler invokes them against the **production** deployment
only. **Gary's observation that labor-timecards fired on production this morning
is consistent and is not evidence about staging.** Nothing analogous runs against
staging.

**The one path that CAN fire against staging with no deployment and no Gary
action is the Square webhook.** `api/webhooks/square/route.ts:121` calls
`syncSalesForStore(store.organization, store, dateStr, dateStr)`, rewriting that
store-day's `SalesPeriodCache` and `SalesHourlyCache` wholesale. Staging's Square
app is separate but **the merchant account is the real one**, and the deploy note
in `docs/ROADMAP_ARCHIVE.md:21` says the subscription was to be added *"in each
Square app (prod + Froot Staging) — notification URL
`${NEXT_PUBLIC_APP_URL}/api/webhooks/square`"*. If that subscription is live,
**every real transaction at any of the nine stores rewrites staging's sales
caches continuously.**

**I cannot verify from this machine whether it is live** — that is a Square
Developer Dashboard subscription plus a staging Vercel env var
(`SQUARE_WEBHOOK_SIGNATURE_KEY`), and `vercel env pull` is banned repo-wide. The
check is: Square Developer Dashboard → Froot Staging app → Webhooks →
Subscriptions, and the presence of the signature key in staging's Vercel env.

**IT DOES NOT CHANGE THE DIAGNOSIS, and this is the important part.** §4 shows
the move reproduces with **zero writes**. Whether a webhook also fired is a
separate question that would only add a second, concurrent cause. The `today`
slide is **sufficient on its own**.

---

## 4 · The measurement — reproduced with zero writes

**Branch: `dev` (`ep-late-water-a6k53nv2`, Neon branch `br-broad-wave-a6vpjdw0`)**,
read 2026-08-22 via a temporary `npx tsx` script; script deleted, tree clean. All
timestamps decoded to **America/Los_Angeles** before reasoning; the columns are
UTC.

```
dev  STORE Meadowood Mall id=cmqvygqz2000004iia18nozpm tz=America/Los_Angeles
dev  LaborDaySplit  rows: 0   -> weights are DERIVED from trailing sales
dev  WeeklyDayHours rows, ALL weeks: 0        (Rebalancer never used — matches Gary)
dev  LaborDayAdjustment rows, ALL dates: 0    (matches weekAdjustments [])
dev  StoreHours    rows: 0   -> open windows INFERRED from trailing SalesHourlyCache
dev  window today=2026-08-21 [2026-06-26 .. 2026-08-21]  SalesPeriodCache=31  SalesHourlyCache(net>0)=310  newest syncedAt=2026-07-26 04:02:28 PT
dev  window today=2026-08-22 [2026-06-27 .. 2026-08-22]  SalesPeriodCache=30  SalesHourlyCache(net>0)=299  newest syncedAt=2026-07-26 04:02:28 PT
dev  boundary 2026-06-26: net=2249.98  syncedAt=2026-07-25 11:00:10 PT  hourlyRows=11   ← DROPS OUT
dev  boundary 2026-06-27: net=2602.62  syncedAt=2026-07-25 11:00:10 PT  hourlyRows=13
dev  boundary 2026-08-21: SalesPeriodCache=ABSENT  hourlyRows=0
dev  boundary 2026-08-22: SalesPeriodCache=ABSENT  hourlyRows=0
```

**The newest `syncedAt` on this store is 2026-07-26 — a month before either
capture date. Nothing was written between 2026-08-21 and 2026-08-22.** The row
set still changed, by exactly one day's worth (−1 period row, −11 hourly rows),
purely because the window slid. On dev it is a **pure drop with no addition**,
which is the cleanest possible isolation of the mechanism.

### 4.1 Running the real derivation both ways

Same code path, same store, same 137.5 hourly pool (staging's figure), GM window
8–14, cap 40. **The only difference between the two runs is the `today` string:**

```
dev  2026-06-26 is a Fri  (the day the window drops)

dev  today=2026-08-21
dev     weights bps : 1076  966 1098 1262 2032 2227 1339
dev     openHours   :   10   10   10   10   11   11    8
dev     floorHours  : 6.00 6.00 6.00 6.00 7.00 7.00 5.00
dev     day split   : 16.0 15.0 16.0 17.5 26.0 28.0 17.5
dev     SUM days    : 136.0   -> adjustedTotalSchedulableHours = 40 + 136.0 = 176.0

dev  today=2026-08-22
dev     weights bps : 1118 1004 1141 1310 1724 2313 1390
dev     openHours   :   10   10   10   10   11   11    8
dev     floorHours  : 6.00 6.00 6.00 6.00 7.00 7.00 5.00
dev     day split   : 16.5 15.0 16.5 18.0 23.0 28.5 18.0
dev     SUM days    : 135.5   -> adjustedTotalSchedulableHours = 40 + 135.5 = 175.5
```

**176.0 → 175.5. One 0.5 step, no writes, only the clock.** Same magnitude and
same direction as Gary's staging observation.

Read the rows: **`openHours` and `floorHours` did not move at all** — the open
windows were stable, so `inferOpenWindowsByWeekday` contributed nothing here.
**The entire move came from the weights.** Friday fell 2032 → 1724 bps when a
Friday worth $2,249.98 left the window, Friday's allocation fell 26.0 → 23.0, the
other six days rose, and the per-day 0.5 flooring landed differently. `Σ` went
136.0 → 135.5.

**What this establishes and what it does not.** It establishes the mechanism
conclusively, on real rows, through the production code path. It is **not**
staging's arithmetic: dev's Meadowood is a different store row
(`cmqvygqz2…` vs staging's `cmrd1a4l6…`) with different sales history, and the
absolute figures differ (176.0/175.5 here, 175.5/175 on staging). The claim is
that this is *the* mechanism, not that these are staging's numbers.

### 4.2 The staging read, for the Neon console

Deployed-environment reads go through the Neon console (CLAUDE.md § Environment
Variables). On **`preview/staging`** (`ep-odd-rain-a6gr4xmm`), for Meadowood
`cmrd1a4l6000004k06v4sw4cq`:

```sql
-- Must be 0 rows each, or the derived paths are not in play and the cause differs:
SELECT (SELECT count(*) FROM "LaborDaySplit"      WHERE "storeId"='cmrd1a4l6000004k06v4sw4cq') AS day_splits,
       (SELECT count(*) FROM "StoreHours"         WHERE "storeId"='cmrd1a4l6000004k06v4sw4cq') AS store_hours,
       (SELECT count(*) FROM "WeeklyDayHours"     WHERE "storeId"='cmrd1a4l6000004k06v4sw4cq') AS rebalances,
       (SELECT count(*) FROM "LaborDayAdjustment" WHERE "storeId"='cmrd1a4l6000004k06v4sw4cq') AS adjustments;

-- Did anything WRITE between the captures?  Pacific, not UTC:
SELECT max("syncedAt") AT TIME ZONE 'America/Los_Angeles' AS newest_sync_pt
FROM "SalesPeriodCache" WHERE "storeId"='cmrd1a4l6000004k06v4sw4cq';

-- The day the window dropped, and the day it gained:
SELECT date, "netSales", "syncedAt" AT TIME ZONE 'America/Los_Angeles' AS synced_pt
FROM "SalesPeriodCache"
WHERE "storeId"='cmrd1a4l6000004k06v4sw4cq' AND date IN (DATE '2026-06-26', DATE '2026-08-21', DATE '2026-08-22')
ORDER BY date;
```

**A newest-sync inside 2026-08-21..22 would mean a writer ALSO fired** (the
webhook of §3) — a second concurrent cause, not a replacement for this one.

---

## 5 · Can it be in a strict byte-for-byte invariant diff?

**NO. It must be excluded, and the strict gate is the budget block plus the
`today`-independent remainder.**

**Gary's prompt is truncated after "the budget block plus" — the sentence ends
there.** What follows is my answer to what completes it; the completion is his to
confirm.

### 5.1 Why exclusion is forced

`adjustedTotalSchedulableHours` moves **on its own, daily, with no writer and no
deployment** (§4). A BEFORE/AFTER pair for a schema promotion is captured on
different days essentially by definition — that is what "before the build" and
"after the build" mean. So a strict diff including this field **fails every time,
for a reason that has nothing to do with the build.**

**The failure direction is the dangerous one.** A gate that cries wolf daily gets
its diff skimmed — and the fields that actually matter (`blendedHourlyRate`,
`salariedCost`, `salariedHours`, S5-D24) sit on the **same lines** as the noisy
one. A reader trained to wave past "just the schedulable-hours drift again" is a
reader who waves past the line that also moved `blendedHourlyRate`. This is the
same argument, at field scale, that S5-D25 makes at file scale about formatting
noise.

### 5.2 The gate that survives it

**STRICT, byte-for-byte — every field below is provably `today`-independent
(§1):**

```
hasForecast · source · forecastTotal · salesBasis · conservativeSales ·
totalLaborBudget · salariedCost · salariedHours · hourlyDollars ·
blendedHourlyRate · hourlyHours · totalSchedulableHours ·
projectedLaborPctAtForecast · floorExceedsBudget · target · weekAdjustments
… and, for the seven null stores, `hasForecast:false` + `budget:null` (S5-D26)
```

**EXCLUDED from strict, captured and reviewed by eye:**

```
adjustedTotalSchedulableHours · today
```

Note that `totalSchedulableHours` (the budget block's own
`salariedHours + hourlyHours`, `labor-budget.ts:100`) **stays in the strict gate**
— it is the *unadjusted* figure and is `today`-independent. Only the *adjusted*
one drifts. The two names are one word apart and mean different things; that
alone is worth a sentence in the capture header.

### 5.3 The condition that lets it back in

**If BEFORE and AFTER are captured on the same Pacific day, the field is
deterministic and may be promoted into the strict diff for that run.** Same
`today`, same trailing windows, same split. The capture's recorded `today`
(S5-D28) is what licenses the promotion — without it, nobody can tell after the
fact whether the pair qualified. This is worth having because a same-day
migration-plus-verify is a realistic shape, and on those runs the strict gate can
cover everything.

**Not recommended: adding a `?today=` override** to `/api/labor/budget` to pin it.
It would make the capture fully deterministic, and it is a build, it changes a
public API surface, and it puts a testing affordance on a route that four
production surfaces read. If determinism is wanted badly enough to justify it,
that is its own ruling.

### 5.4 The larger fact this exposes, recorded and not ruled

**A saved week's day-by-day plan is not stable.** Ask `/api/labor/budget` or
`/api/labor/weekly-plan` for the same historical week on two different days and
the per-day hours differ, because the split's weights and floors are derived from
a window anchored on *now* rather than on the week being planned. Nothing is
wrong with any single answer; there simply is no single answer.

Two consequences worth Gary's attention, **neither ruled and neither fixed here**:

- **A manager who plans a week, leaves, and comes back sees different day
  numbers**, with nothing on screen indicating why. The weekly total is stable;
  the days are not.
- **This interacts with the Rebalancer** (`api/labor/day-hours`), which pins
  specific days by writing `WeeklyDayHours` and lets the rest re-split against
  `poolForSplit` (`labor-plan.ts:222`). Pinned days hold; unpinned days keep
  drifting underneath them. That is arguably correct behaviour, and it is
  certainly undocumented.

Whether a week should freeze its derived inputs once planned is a design
question, not a defect report. Recorded so it is not rediscovered as new.

---

## 6 · Deviations proposed

Continuing S5-D24..D27. **All are proposals. Nothing is built or approved.**

- **S5-D28** — **The capture records `today` on every line** (and keeps `tz`,
  which it already has). It is in the payload already (`budget/route.ts:32`) and
  the hand-assembled JSONL drops it. Without it, a diff cannot distinguish a
  clock slide from a real change, and this audit is what that costs.
- **S5-D29** — **`adjustedTotalSchedulableHours` is EXCLUDED from the strict
  byte-for-byte diff**; the strict gate is §5.2's list. It is still captured and
  reviewed by eye. `totalSchedulableHours` — a different field, one word apart —
  **stays** in the strict gate.
- **S5-D30** — **Same-day promotion.** If BEFORE and AFTER share a Pacific day,
  `adjustedTotalSchedulableHours` is deterministic and may be moved into the
  strict diff for that run. The recorded `today` from S5-D28 is what proves the
  pair qualified.
- **S5-D31** — **The capture header states which fields are clock-dependent and
  why**, so the next reader of a noisy diff does not repeat this audit. One
  sentence naming `today`, `labor-plan.ts:171` and `:228`.

---

## 7 · What this audit does NOT establish

- **Nothing was built.** No file outside `docs/` was touched.
- **§4 is the `dev` branch, named on every line.** It reproduces the MECHANISM on
  a different store row with different sales history. It is **not** staging's
  arithmetic, and the absolute figures differ (176.0/175.5 vs staging's
  175.5/175). §4.2 carries the Neon-console SQL that would confirm it on staging.
- **Whether a writer ALSO fired against staging is unresolved.** The Square
  webhook is the one path that could (§3), its subscription status is not
  verifiable from this machine, and the diagnosis does not depend on it — the
  clock slide is sufficient alone. A newest-`syncedAt` inside 2026-08-21..22
  would mean two concurrent causes, not a different one.
- **Gary's prompt is truncated** after "the budget block plus" (§5). §5.2 is my
  proposed completion, not his instruction.
- **§5.4's plan-instability finding is recorded, not ruled and not fixed.**
