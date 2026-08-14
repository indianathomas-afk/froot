# BUG-7 — Task 1 audit: concurrent `syncSalesForStore` writers race on the sales caches

**Session date:** 2026-08-13 · **TIER 3** · Audit-only phase, no code edited.
**ID confirmed:** highest existing row is `BUG-6` (`docs/ROADMAP.yaml:7420`). **BUG-7 is the
next free integer.**

**Reported evidence (Gary, staging · preview env · branch `92de25f` · org
`cf888f2d-f234-48c7-8097-fd5b44b5b3dd` · 2026-08-13 18:48:50 UTC):**

```
prisma.salesPeriodCache.createMany() — P2002, unique constraint failed on
("storeId", date), store=cmrd1a4hz000004jjl91v23nm
```

followed 3.5 s later by a clean 796 ms refresh on the same store. Recovered by a later
poll attempt; invisible to the operator today.

---

## 1a. Every writer to `SalesPeriodCache`

### There is exactly ONE write site in production code

```
src/lib/sales-sync.ts:221-275   prisma.$transaction(...)
  :222  salesPeriodCache.deleteMany({ storeId, date: { in: dateList } })
  :223  salesHourlyCache.deleteMany(...)
  :224  salesLineCache.deleteMany(...)
  :226  salesPeriodCache.createMany(...)      ← the statement that threw
  :245  salesHourlyCache.createMany(...)
  :261  salesLineCache.createMany(...)
```

Every production write funnels through `syncSalesForStore`. Verified by grepping all
non-read accesses to the three cache models across `src/` and `scripts/`: the only other
hits are three fixtures (`verify-goal-engine.ts:58`, `verify-f5-polish.ts:104`,
`verify-f4-rollup-webhook.ts:112`), each writing into a throwaway org it deletes
afterwards. **No route, cron or lib writes these tables directly.**

So "every writer" means "every caller of `syncSalesForStore`", directly or through
`ensureSalesCached`.

### Direct callers — full wholesale rewrite of each day in the window

| # | Call site | Trigger | Window |
|---|---|---|---|
| 1 | `src/app/api/dashboard/summary/route.ts:90` | first-ever load for the store-day, **inline** | today |
| 2 | `src/app/api/dashboard/summary/route.ts:102` | stale cache, **inside `after()`** | today |
| 3 | `src/app/api/dashboard/sales/route.ts:200` | first-ever load, **inline** | today |
| 4 | `src/app/api/dashboard/sales/route.ts:209` | stale cache, **inside `after()`** | today |
| 5 | `src/app/api/dashboard/rollup/route.ts:67` | missing **or** stale, **inline**, once per store in a serial loop | today |
| 6 | `src/app/api/webhooks/square/route.ts:121` | Square order/payment event, inside `after()` | the order's local day |
| 7 | `src/app/api/cron/sales-reconcile/route.ts:42` | Vercel cron 11:00 UTC, all orgs, serial | **today−2 … today** |
| 8 | `src/app/api/square/sales/sync/route.ts:48` | manual resync | caller-supplied |
| 9 | `src/app/api/forecasting/backfill/route.ts:78, :116` | backfill chunk loop | chunk range |

### Indirect callers via `ensureSalesCached` (`sales-sync.ts:292-308`)

`ensureSalesCached` syncs **only missing dates** (`:305` returns early when none are
missing), so it is a gap-filler, not a refresher. It still reaches the same transaction
when it does fire.

| Call site | Note |
|---|---|
| `dashboard/summary/route.ts:111, :112` | month-to-date + comparison day |
| `dashboard/sales/route.ts:218, :219` | both selection windows |
| `dashboard/rollup/route.ts:69` | month-to-date, per store |
| `inventory/reports/item-sales/route.ts:30` | |
| `inventory/reports/variance/route.ts:54` | |
| `inventory/reports/profitability/route.ts:31` | |
| `inventory/reports/cogs/route.ts:67` | |
| `src/lib/expected-inventory.ts:166, :333` | **one level of indirection** |

`expected-inventory.ts` is reached by five further GET routes that never name a sync
helper — `inventory/order-guide`, `inventory/expected`, `inventory/alerts`,
`inventory/alerts/count`, `inventory/pars`. **This is the blind spot DEBT-30 already
documented**: a by-name grep for `syncSalesForStore`/`ensureSalesCached` finds 8 of the 13
GET routes that write, and misses these five. That row is worth re-reading before anyone
concludes they have enumerated the writers.

**Total: 14 distinct call sites across 9 direct and 13 GET routes, all funnelling into one
transaction.** Gary's expectation of "at least the lazy sync, the webhook, and the cron"
is correct and is an undercount by an order of magnitude.

---

## 1b. Why the write is check-then-act, and how many writers can overlap

### The mechanism

The transaction at `sales-sync.ts:221` is **delete-then-insert**, which is check-then-act
with the delete standing in for the check:

- **Check** — `:222` `deleteMany` clears the day, on the assumption that afterwards no row
  for `(storeId, date)` exists.
- **Act** — `:226` `createMany` inserts on that assumption.

Nothing holds the assumption true in between. No isolation level is set anywhere in the
repo (`grep isolationLevel|Serializable|RepeatableRead` over `src/` and
`prisma.config.ts` → zero hits), so Prisma uses the Postgres default, **READ COMMITTED**,
where each statement takes a fresh snapshot and there is no protection against a
concurrent insert of a key you just deleted.

Two interleavings both reach P2002:

1. **Both start with the day absent** (first sync of a new local day, or both after each
   other's delete). Both `deleteMany`s affect 0 rows; both `createMany`s target the same
   `(storeId, date)`; the second to commit violates `@@unique([storeId, date])`.
2. **T1 deletes the pre-existing row and inserts; T2's `deleteMany` blocks on T1's row
   lock.** T1 commits. T2's delete re-evaluates and finds the old row gone, while T1's
   newly-inserted row is not visible to T2's already-started statement snapshot. T2
   deletes nothing, then inserts, then violates.

`salesPeriodCache.createMany` at `:226` runs **before** the hourly and line inserts, which
is why the observed violation is on `("storeId", date)` and not on the other two.

### What limits the window — and what does not

The expensive part is **outside** the transaction. The Square `orders/search` pagination
loop runs at `:123-214`, and only the aggregated result enters `$transaction` at `:221`.
So the critical section is milliseconds, not the ~1 s the sync takes end to end. That is
why this stayed latent: two syncs starting a second apart normally do not overlap their
transactions at all.

**What makes them overlap is two syncs starting at nearly the same instant**, and there
are more sources of that than the report assumes.

### How many writers can overlap for one store-day

**Correction to the framing in the prompt, and it matters for the fix.** BUG-6's fix did
not make this reachable — it raised the frequency of something already reachable. **A
single dashboard load has always issued two concurrent syncs for the same store-day**:

- `dashboard-client.tsx` mounts and fetches `/api/dashboard/summary` (`:225-231`).
- `SalesPerformanceCard` mounts in the same commit and fetches `/api/dashboard/sales`
  (`:291`), whose default preset is `today` (`:274`), so `end === today` and the stale
  branch at `sales/route.ts:199-217` applies.

Both routes independently evaluate the same `STALE_MS` test against the same
`salesPeriodCache` row, both register an `after()` sync for the same `(store, today)`, and
both fire once their responses flush — **within milliseconds of each other**. That is a
two-writer collision on every stale dashboard load, and it predates BUG-6 entirely: it has
existed since the `after()` deferral shipped in `2081401` on 2026-07-23, and in an inline
form since D-1 (`1b8160f`, 2026-07-06).

**What BUG-6's fix changed is the multiplier.** Each poll attempt re-enters the route,
re-evaluates the same stale test, and — because a sync in flight has not yet advanced
`syncedAt` — registers **another** `after()` sync. With `POLL_ATTEMPTS = 3` on both cards,
one store switch can now schedule up to **8 syncs** for a single store-day (2 initial + 6
polled) where it previously scheduled 2. In the healthy case the first sync lands inside
2 s and the polls stop, so only 2 fire; the 8-way case needs a sync slower than the 2 s
poll interval, which is exactly the condition Gary observed (a 796 ms recovery after a
failure, i.e. the failed attempt had been slower).

**Full concurrency inventory for one store-day at HEAD:**

| Source | Concurrent instances |
|---|---|
| `/api/dashboard/summary` initial + up to 3 polls | 4 |
| `/api/dashboard/sales` initial + up to 3 polls | 4 |
| `/api/dashboard/rollup`, if any user or tab is on "All locations" | 1 per viewer |
| Any of the 13 gap-filling GET routes, if the day is missing | 1 each |
| Square webhook | 1 per event — currently 0, see 1d |
| Nightly reconcile cron (today is inside its 3-day window) | 1 |
| Manual `/api/square/sales/sync`, backfill chunks | 1 each |
| **× every user and every open tab viewing that store** | multiplies all of the above |

The per-user multiplier is the one that scales worst: two managers opening the same
store's dashboard at the same moment is four concurrent syncs before any polling.

### What the constraint and the transaction already save us from

Worth stating plainly, because it bounds the severity and should not be re-derived:

- **All three tables carry unique constraints** — `SalesPeriodCache @@unique([storeId,
  date])` (`schema.prisma:1083`), `SalesLineCache @@unique([storeId, date,
  squareVariationId])` (`:1101`), `SalesHourlyCache @@unique([storeId, date, hour])`
  (`:1118`). Without them a race would silently insert **duplicate rows**, and every
  reader sums (`summary/route.ts:108-111` aggregates `netSales`; `loadWindow` in
  `sales/route.ts:85-88` reduces over `dayRows`) — so the failure mode would be silent
  double-counted revenue instead of a loud error. **The constraint is what makes this a
  crash rather than a corruption.**
- **The whole rewrite is one transaction**, so a P2002 rolls back all six statements. The
  loser's `deleteMany` is undone with its `createMany`. **The day is never left partially
  written, and never left empty.** The winner's complete rewrite stands.

So today's cost is **wasted work and a swallowed error**, not bad data.

### Where the error goes

Every caller swallows it:

- Webhook: `webhooks/square/route.ts:122-125` catches and `console.error`s inside
  `processEvent`; the route already returned 200 at `:94`, so **Square never retries**.
- Dashboard `after()` callbacks: `summary/route.ts:103-105`, `sales/route.ts:210-212`.
- Inline paths: the enclosing `try` at `summary/route.ts:98-101` / `sales/route.ts:206-209`
  ("Square being down never blanks the dashboard — serve what's cached").
- Rollup: `rollup/route.ts:70-72`, a **bare `catch {}` with no logging at all**.
- Cron: `sales-reconcile/route.ts:44-48`, recorded per store in the response.

A raced sync is therefore a silently dropped refresh everywhere except the cron.

---

## 1c. What SHOULD happen when two syncs race and disagree — **RULING NOW, Gary's call**

Framing first, because it changes how the options read. Each sync **rewrites the day
wholesale** from a complete Square re-read. Two syncs for the same store-day therefore
never disagree about method, only about **when they read Square**. They differ exactly by
the orders that landed between the two fetches. So the question "later write wins or is
discarded" is really **"which fetch time should win"** — and the trap is that *later
commit* and *later fetch* are not the same thing.

### The hazard that makes this a ruling rather than a detail

`syncedAt` is `@default(now())` (`schema.prisma:1078`), stamped at **insert** time, not at
fetch time. So under any last-commit-wins scheme:

- Sync X fetches Square at 10:00:00. Sync Y fetches at 10:00:01 and sees one more order.
- Y commits at 10:00:02. X commits at 10:00:03.
- **X's older totals overwrite Y's newer ones — the day's sales go DOWN** — and the row is
  stamped `syncedAt = 10:00:03`, which looks *fresher* than Y's write.
- That fresh-looking stamp then suppresses the 15-minute lazy refresh for a further 15
  minutes, and suppresses the webhook burst absorber
  (`webhooks/square/route.ts:119`, `cached.syncedAt >= eventAt`) for every event emitted
  before 10:00:03.

**A visibly decreasing "Today so far", self-sustaining for 15 minutes.** No option below
should be chosen without deciding about this specifically.

### The options

**Option 1 — Later COMMIT wins. Replace delete+insert with an idempotent upsert.**
Per-row `upsert` on the unique key (or raw `INSERT … ON CONFLICT DO UPDATE`), keeping the
deletes only for variation/hour rows that no longer exist.
*Consequences:* the P2002 disappears entirely; no writer ever loses its work; no lock
contention; smallest change to the concurrency model. **But it adopts the going-backwards
hazard above as designed behaviour**, and it is the only option that does. Cheapest to
build, and the one whose failure mode is invisible.

**Option 2 — Later FETCH wins. Upsert guarded by a fetch timestamp.**
Capture `fetchStartedAt` before the Square loop (before `:123`), write it to `syncedAt`
instead of `now()`, and make the update conditional — `ON CONFLICT DO UPDATE … WHERE
excluded.syncedAt > sales_period_cache.syncedAt`. A stale writer's row is **discarded
silently and correctly**.
*Consequences:* fixes the P2002 *and* the going-backwards hazard in one move; `syncedAt`
becomes "the moment Square was read", which is more honest than "the moment we inserted"
and is what both the staleness test and the webhook burst absorber actually mean by it.
Costs: `createMany` cannot express a conditional upsert, so this needs either per-row
upserts in a loop or one raw `INSERT … ON CONFLICT` per table; and `syncedAt` changes
meaning, which every reader of it must be re-checked against
(`summary:83`, `sales:192`, `rollup:66`, `webhooks/square:119`). **This is the option that
makes the data correct rather than merely quiet.**

**Option 3 — Neither writer loses; serialize per store-day.**
`pg_advisory_xact_lock(hashtext(storeId || date))` taken at the top of the transaction.
The second writer waits, then rewrites over the first.
*Consequences:* no error, no lost work, both writes applied in commit order — which means
it **still has the going-backwards hazard**, because the lock orders the writes, not the
fetches. To fix the ordering the lock would have to be taken before the Square fetch,
which serialises the 1 s network call and would make 8 queued syncs a visible 8 s stall.
More moving parts than Option 2 for strictly less correctness.

**Option 4 — Reduce the number of racers instead of fixing the write.**
Single-flight coalescing per `(storeId, date)`, and/or having the summary and sales routes
stop scheduling independent syncs for the same store-day.
*Consequences:* attacks the actual root cause of the multiplication and would cut Square
API spend meaningfully. But in-process coalescing is **per lambda instance**, so it cannot
help across concurrent instances or across users — it lowers probability without closing
the race. **Sound as a companion to Option 2; unsound as the whole fix.**

**Option 5 — Accept and document.**
The constraint plus atomicity already prevent corruption; the poll and cron recover;
today's symptom is invisible.
*Consequences:* free. But it is a bet on the recovery paths staying in place, and 1d is
the reason not to take it.

### Recommendation, stated as a recommendation and not a decision

**Option 2, with Option 4's route-level de-duplication as a follow-up.** It is the only
option that makes a raced write *correct* rather than merely non-erroring, and it fixes a
second defect — `syncedAt` meaning insert-time — that is currently feeding wrong answers
to three staleness tests and to the webhook burst absorber. Option 1 is materially cheaper
and I would not argue against it *if* the going-backwards hazard is separately accepted in
writing, because that hazard is silent and self-sustaining and will not announce itself.

---

## 1d. Blast radius if a Square webhook subscription were registered today

**Today the webhook contributes zero writers** — `SQUARE_WEBHOOK_SIGNATURE_KEY` is absent
from every Vercel environment (re-measured 2026-08-13, F-4), so every delivery would 500 at
`webhooks/square/route.ts:49` before reading the body. Registering a subscription turns it
on as a writer at transaction rate.

### Frequency

Measured on branch `br-broad-wave-a6vpjdw0`, org `cf888f2d-f234-48c7-8097-fd5b44b5b3dd`,
2026-08-13 mid-afternoon: **76–144 paid orders per store per day**, across 9 stores. F-4
subscribes to four event types — `order.created`, `order.updated`, `payment.created`,
`payment.updated` (`route.ts:44`) — and a single completed transaction normally emits
several (an order is created, updated one or more times as items and tenders are added,
then a payment is created and updated).

So a conservative **3–5 events per order** puts a busy store at **roughly one event every
10–20 seconds sustained, and several per second in a lunch rush**, against a sync that
takes ~1 s. Across 9 stores that is a continuous stream of writers where today there are
none.

### What absorbs it, and where the absorber fails

`webhooks/square/route.ts:115-119` skips the resync when
`cached.syncedAt >= eventAt` — i.e. when a sync already ran after the event was emitted.
This is a genuinely good burst absorber and will collapse most of a single order's event
cluster into one sync.

**It fails exactly on the case that matters**: two events emitted within the ~1 s a sync
takes. Neither sees an advanced `syncedAt` — because the in-flight sync has not committed —
so both proceed, and both enter the transaction. **The absorber is itself a check-then-act
against the same unprotected `syncedAt`**, one layer above the one in 1b.

### The consequences, in order of how much they should weigh

1. **Volume, not severity.** Atomicity and the unique constraints still hold, so the
   outcome per collision is unchanged: one sync's work is discarded, nothing is corrupted,
   the day is never partially written. The change is that a rare event becomes a routine
   one.
2. **Silence.** `processEvent`'s catch at `:122-125` logs and swallows, and the route
   already returned 200 at `:94`, so **Square never retries a dropped sync**. A raced
   webhook event is simply lost. Today that is covered by the poll and the cron; once
   webhooks are the primary freshness path the cache will usually look fresh, the
   15-minute lazy sync will rarely fire, and **the recovery paths that currently hide this
   are precisely the ones the webhook is meant to make unnecessary.** The safety net is
   removed by the same change that increases the load on it.
3. **The going-backwards hazard goes from rare to frequent.** Under the current
   last-commit-wins-by-accident behaviour, every collision is a coin flip on whether the
   older fetch overwrites the newer. At one collision an hour that is a curiosity; at
   transaction rate it is a "Today so far" that visibly ticks downward during a rush —
   the exact number F-4 exists to make trustworthy, on the exact screen an operator
   watches during service.
4. **Wasted Square quota.** Every raced sync completed its full paginated
   `orders/search` before losing at commit. Square publishes no rate limits
   (`sales-reconcile/route.ts:13-14` says so, which is why stores are processed serially),
   so this is unquantified spend against an unknown ceiling — and it rises with the same
   multiplier.
5. **Lambda cost and concurrency.** `maxDuration = 60` on the webhook route; every
   discarded sync still holds an invocation for its full duration.

### The one-line answer

**Registering the subscription today would convert a rare, self-healing, invisible race
into a frequent one — while removing the recovery path that currently makes it invisible.
BUG-7 should be fixed before F-4's subscriptions are registered**, which stacks under
BUG-6's existing ordering constraint rather than conflicting with it:

> verify BUG-6 on staging → fix BUG-7 → register Square subscriptions → verify F-4.

---

## Proposed plan (Task 2 scope, pending the 1c ruling)

Not written yet, because its shape is entirely determined by the ruling. Sketch under
Option 2:

1. `src/lib/sales-sync.ts` — capture `fetchStartedAt` before the Square loop; replace the
   three `deleteMany` + `createMany` pairs with conditional upserts keyed on the existing
   unique constraints, discarding a write whose `fetchStartedAt` is older than the stored
   `syncedAt`; write `fetchStartedAt` into `syncedAt`.
2. Re-check every reader of `syncedAt` against its new meaning —
   `summary/route.ts:83`, `sales/route.ts:192`, `rollup/route.ts:66`,
   `webhooks/square/route.ts:119`, `getSyncedThrough` (`sales-sync.ts:281`).
3. Handle the rows that must still be *deleted* — an hour or variation present in the old
   write and absent from the new one — which an upsert alone will not remove. This is the
   part most likely to be got wrong and needs to be explicit in the plan.
4. Fixture coverage: a concurrency check that runs two `syncSalesForStore` calls for one
   store-day and asserts no throw plus a single row per key. `scripts/verify-f4-rollup-webhook.ts`
   is the natural home; note it seeds its own org, so this is testable without Square.
5. **Not in scope:** BUG-6's poll logic, per Gary. The poll is correct and the lambda
   timings (796/1032/1162/1184 ms) confirm it.

**No schema change is required under any option** — every constraint needed already
exists. Say so explicitly, because Option 2 sounds like it needs one and does not.
