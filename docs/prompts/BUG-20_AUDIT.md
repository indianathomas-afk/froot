# BUG-20 — Phase 1 audit: the dashboard's duplicated today-sales sync

Session: BUG-20 (TIER 3), prompt `docs/prompts/BUG-20.md`. Read-only audit,
written 2026-11-03 at HEAD `9933ad5` on `staging` (clean apart from the
untracked prompt). No code, schema or database touched. No database queried —
every claim below is from code at `9933ad5`, from figures already recorded in
the repo, or from figures quoted in the prompt, and each one says which.

---

## Summary

1. **The duplicate is real and confirmed from code.** On the dashboard's
   per-store view, `SalesPerformanceCard` (`/api/dashboard/sales`) and
   `DashboardClient.loadSummary` (`/api/dashboard/summary`) fire in parallel
   on mount, and when the sales card's selection ends today (the default
   preset is "today") **both** routes independently call
   `syncSalesForStore(org, store, today, today)` — inline when today has no
   `SalesPeriodCache` row, in `after()` when the row is more than 15 min old.
2. **Removing it will probably NOT make first loads noticeably faster.** The
   two syncs run in parallel, in two separate requests — not one after the
   other. Each route waits for its own Square read, and both reads happen at
   the same time. With the duplicate gone, the route that loses still cannot
   show today's sales until the winner's single Square read commits. So its
   time to respond stays about the same. What dedupe saves is: one Square
   orders search per load, the `discarded … superseded` line, and a few ms of
   row-lock wait in the losing writer. **The prompt's hypothesis ("this
   duplicate is the likeliest share" of the 0.6–1.4 s) is weak from the code.**
   This is RULING NOW #1.
3. **Staging and production take different paths, and only staging takes the
   inline path.** Vercel runs `vercel.json` crons on production only
   (`docs/WORKFLOW.md:36`). The nightly `cron/sales-reconcile` (11:00 UTC =
   03:00 PST) re-syncs `today-2 … today` per store, and `writeSalesCache`
   writes **every** date in the window, including today with zero sales. So on
   production, today's row exists from 03:00 local. The first dashboard load
   of the day takes the **stale / `after()`** branch, not the inline one. On
   staging there is no cron, so the first load per store per day takes the
   **inline** branch in both routes. The 0.6–1.4 s staging first loads and the
   0.8–1.3 s production first loads are therefore not the same thing.
4. **Recommendation (BUG20-F1): a fixed owner plus a fallback, with no new
   state.** `/api/dashboard/summary` stays the owner and syncs exactly as
   today. `/api/dashboard/sales` defers: when today's row is missing, it polls
   the cache for up to N ms and then falls back to syncing itself. When the
   row is stale, its `after()` waits briefly, re-reads `syncedAt`, and skips
   the Square call if a newer fetch has landed. No column and no migration.
   Webhook and reconcile are untouched. Details and alternatives are in § D.

---

## A. Every caller of `syncSalesForStore`

Enumerated by caller, not by guard name (CLAUDE.md § Verifying a guard covers
every path): `grep -rn syncSalesForStore src scripts`, excluding
`src/generated/`. That gives **seven call sites in six route files, plus one
internal caller** (`ensureSalesCached`, `src/lib/sales-sync.ts:448`), which is
itself called from three routes.

| # | Caller | Window | When it syncs | Needs today **before responding**? |
|---|---|---|---|---|
| 1 | `api/dashboard/summary/route.ts:96` | today | no today row → **inline** | **Yes.** Sales card total, hourly series and MTD feed the Monthly Goal card. Serving nothing is "zero today". |
| 2 | `api/dashboard/summary/route.ts:108` | today | row older than 15 min → `after()` | No. It serves the cached row, sets `salesRefreshing`, and the client polls (BUG-6). |
| 3 | `api/dashboard/sales/route.ts:227` | today | `end === today` and no row → **inline** | **Yes**, same reason, for the Sales Performance card. |
| 4 | `api/dashboard/sales/route.ts:236` | today | `end === today` and stale → `after()` | No. Same BUG-6 poll. |
| 5 | `api/dashboard/rollup/route.ts:113` | today, per store, **serial** | no row **or** stale → **inline** | Yes, by design. Rollup has no `after()` path. It is the all-locations view, rendered **instead of** summary + sales (`dashboard-client.tsx` `isRollup`), so it never runs in the same page load as #1–4. |
| 6 | `api/webhooks/square/route.ts:121` | the order's local day | in `after()`; skipped when the cached `syncedAt >= eventAt` | No (no user waiting). It already has its own single-flight-like skip. |
| 7 | `api/cron/sales-reconcile/route.ts:42` | `today-2 … today` | nightly, production only | No. It is the source of truth for late edits and refunds. |
| 8 | `api/square/sales/sync/route.ts:48` | caller's range | manual (admin "sync") | Yes. It returns the sync result itself. |
| 9 | `api/forecasting/backfill/route.ts:78,116` | historical chunks | manual backfill | Yes, per chunk. Never today-only. |
| — | `ensureSalesCached` (`sales-sync.ts:433`) | first..last **missing** date | when any date in the window has no row | Called by summary (month start → today; comparison day), sales (selection; comparison window) and rollup (month start → today). |

**What the dashboard pair actually shares.** Only #1/#3 (inline) and #2/#4
(`after()`) collide with each other. #5 never runs alongside them. #6 and #7
can coincide with a dashboard load only by chance, and BUG-7 already covers
that.

**A second, smaller overlap that BUG-20's row does not name:** both routes
gap-fill the **same comparison day**. Summary calls
`ensureSalesCached(today-364)`. Sales with the default
`compare=same_weekday_last_year` and a today-only selection resolves
`compStart = compEnd = today-364` (`sales/route.ts:68`). When that day has
never been cached (no backfill), both routes run a second, parallel Square
search for it. This happens once per store per calendar day, and only on
stores without a backfill. Under F3 this is not in scope unless ruled.

**Also not in scope, noted:** summary's `ensureSalesCached(mStart, today)` is
a **serial** second Square search inside the same request whenever the month
has a gap. An example is a staging store nobody opened for several days.
That is a stronger candidate for first-load latency than the duplicate
(§ C).

## B. The BUG-7 guard, exactly

`writeSalesCache` (`src/lib/sales-sync.ts:144-251`). What it does today:

1. `fetchStartedAt = new Date()` is taken **before** the first Square page
   (`:274`). It becomes `syncedAt`. So `syncedAt` means *"when Square was
   read"* (understated for multi-page fetches, which is the safe direction).
2. A single `INSERT … ON CONFLICT ("storeId","date") DO UPDATE … WHERE
   "SalesPeriodCache"."syncedAt" < EXCLUDED."syncedAt" RETURNING "date"`
   (`:174-191`), over **all** dates in the window plus any spillover dates,
   sorted so concurrent writers take row locks in the same order (`:157`).
3. Concurrent writers to one store-day serialise on that row lock. The second
   writer re-evaluates `WHERE` against the **committed** value, so the
   **newer fetch wins regardless of which commits last**. A losing row is not
   `RETURNED`, and that absence is the signal.
4. Hourly and line rows are delete-then-insert **only for won dates**
   (`:201-247`), under the period-row lock still held. Ordering matters: the
   period upsert must come first.
5. Lost dates are logged as `[sales-sync] store=… wrote X/Y day(s); discarded
   N superseded by a newer fetch: …` (`:400-409`) and returned as
   `discardedDays`.
6. The invariant that makes discarding safe: every sync re-reads the **whole
   day** from Square, so the winner's read covers everything the loser saw
   (`:20-23`).

**What any fix must not break:**

- **Webhook correctness.** `processEvent` skips when `syncedAt >= eventAt`.
  That is only right because `syncedAt` is the *read* instant. Anything that
  stamps `syncedAt` with something other than a Square read time (for
  example a placeholder row, or a "claim" written into `syncedAt`) would make
  webhooks skip real changes. **`syncedAt` must stay "Square read at", and
  nothing may write a `SalesPeriodCache` row that is not a real read.**
- **Reconcile correctness.** It must always be allowed to write. Under
  BUG-7 it wins whenever its read is newer. Nothing in a dashboard fix may
  make reconcile wait for, or defer to, a dashboard claim.
- **Row existence means "cached".** `ensureSalesCached` treats any existing
  row as covered (`:440-446`), and MTD / range sums read rows directly. A
  placeholder row (for example a claim row with zeros) would be read as real
  zero sales **and** would stop the gap-fill from ever filling it. This rules
  out putting a claim column on `SalesPeriodCache`: on the first load of the
  day, the row the claim would live on does not exist yet.
- **Newest-fetch-wins stays the only arbiter of what is stored.** A dedupe
  decides only *whether to call Square*. It never decides which write
  survives.

## C. Measuring the duplicate

**Confirmed from code that both routes sync on a first load.** On mount for
a single store: `DashboardClient`'s effect calls `loadSummary()`
(`dashboard-client.tsx:275-278`). `SalesPerformanceCard`, rendered in the same
tree (`:353`), fires its own effect (`sales-performance-card.tsx:215-250`).
The two requests are independent and concurrent. The card's default selection
is `preset: "today"`, `compare: same_weekday_last_year` (`:197`), so
`end === today` and route #3/#4 is reached. With no today row, both reach
`syncSalesForStore` inline. With a stale row, both register an `after()`.
**The duplicate does not occur** when the operator's saved selection ends
before today (for example "Yesterday"), because the sales route never touches
today then.

**Poll re-entry multiplies the stale case.** Each BUG-6 poll re-enters its
route (`dashboard-client.tsx:244`, `sales-performance-card.tsx:234`). If the
cache is still stale when a poll lands, that poll registers **another**
`after()` sync. The bounds are 3 attempts × 2 s per card (`card-fetch.ts`).
A typical background refresh lands well inside the first 2 s, so in practice
this is the two initial syncs. But a slow Square read can add up to three
more syncs per card.

**Square vs database split.** **The raw log lines from staging 2026-11-03
20:32–20:33 PST are not in this session.** They are not in the repo either:
`grep 20:3[23] docs/` matches only the prompt. So I can't cite them. The
figures I *can* cite:

- Prompt (`BUG-20.md:21-23`, relaying Gary): staging warm loads after
  REGION-1 are summary **77 ms** and sales **55 ms**. First loads per store
  are **~0.6–1.4 s**.
- `docs/DEPLOY_LOG.md` (745a1ee entry): staging first loads "stayed ~1 s
  (they include Square fetches)". Production first loads were 0.8–1.3 s.
  Unchanged `[sales-items/sync]` `writeMs` on staging pdx1 was 1,159 then
  604. That is a different, larger write, not comparable row-for-row.

**No existing log line splits a sales sync into Square time and DB time.**
The inline path logs nothing about the sync. The `after()` path logs
`background refresh Nms` (Square + write together). So the split below is an
**estimate from code, not a measurement**:

- DB work on a first-load summary, beyond the warm path: one guarded write
  transaction (`INSERT … ON CONFLICT`, 2 × `deleteMany`, up to 2 ×
  `createMany`, plus BEGIN/COMMIT). The warm route runs about 10 queries in
  77 ms (pdx1, next to Neon), so the write adds **on the order of 40–80 ms**.
- That leaves **~0.5–1.3 s** of a 0.6–1.4 s staging first load for: the
  Square orders search (1 page for <500 orders/day), **plus** any serial
  month gap-fill search (§ A), **plus** function cold start (a first load per
  store is often the first request to a cold function). The code cannot
  apportion between those three.

**What this means for the fix.** The losing route still has to wait for the
winner's Square read before it can show today's sales. So the first-load
time of each route should stay at about one Square search after the dedupe.
**Expected, from code: no visible first-load improvement.** Expect one
`[sales-sync]` per store per load, no `superseded` line, and Square request
volume halved on the dashboard. If Gary wants the latency answered, the
cheapest evidence is a log line in `syncSalesForStore` that reports
`squareMs` / `writeMs`, mirroring `[sales-items/sync]`'s `writeMs`. That
changes nothing fetched, stored or shown, but it is still a code change
(RULING NOW #3).

**Why production's first loads aren't explained by this at all.** On
production the 03:00 reconcile row exists, so the first load of the day
serves that row immediately and syncs in `after()`. The route's logged
duration (`console.log` before `return`) **excludes** `after()` work.
Production's 0.8–1.3 s first loads therefore contain **no** today sync. They
are cold start, labor, goal, checklist and any gap-fill. A side effect of the
same mechanism: the production first load of the day **shows the 03:00 row**
(usually near zero) until the BUG-6 poll picks up the refresh. That is
correct per BUG-6, and not this bug.

## D. The losing request on a first load: options

The hard constraint is that **neither panel may show zero/empty today because
the other one claimed the sync.**

### (a) One owner, the other reads the cache, no fallback

Summary syncs. Sales never syncs today and just reads.
**Fails the constraint on staging-style first loads.** The sales request
reads before summary's inline sync commits, so the card shows "No sales
recorded yet today" (`sales-performance-card.tsx:421`) until the next load.
It also leaves a sales-card date-range change (no summary request) with no
one refreshing today. **Rejected as stated.**

### (a+) Fixed owner, the other waits then falls back. **Recommended.**

- **Summary is unchanged.** It is the owner and syncs inline or in `after()`
  exactly as today.
- **Sales, no today row:** poll `SalesPeriodCache` for `(storeId, today)`
  every ~100 ms for up to **N ms** (proposal: N = 3,000, under the client's
  12 s `fetchCard` timeout and the route's 60 s `maxDuration`). If the row
  appears, read the cache as today. If not, **fall back to
  `syncSalesForStore` itself**, which is exactly today's behaviour. **It can
  never show empty**: the row it reads is a real Square read, or it does the
  read itself.
- **Sales, stale row:** keep `salesRefreshing = true` and keep registering
  `after()`. Inside it, wait ~1.5 s, re-read `syncedAt`, and **skip the
  Square call if it has moved past the value this request saw** (summary's
  refresh landed). Otherwise sync. This is the webhook's own skip rule
  (`syncedAt >= eventAt`) applied to the dashboard. The client poll is
  unchanged and still sees `syncedAt` advance.
- **No new state, no column, no migration.** `syncedAt` keeps its meaning.
  BUG-7 is untouched. Webhook and reconcile are untouched (F2).
- **Trade-offs:**
  - It is a fixed owner, not a true single-flight. A request that lands while
    the owner is **not** running (a sales-card date-range change ending today
    with no row, which is rare because the initial load creates the row) pays
    up to N ms before falling back.
  - If summary's sync **fails** (Square down), the sales card pays N ms more
    than today before it tries, and probably fails too. It then serves the
    cache, as today.
  - The stale refresh from the sales route lands ~1.5 s later. That is
    invisible to latency (it is after the response) and still inside the
    BUG-6 poll window (first poll at 2 s, 3 attempts).
  - The waiting request holds no DB connection between polls. Each poll is
    one indexed `findUnique`.
  - Latency on a first load: the sales route returns ≈ when summary's row
    commits, plus ≤100 ms poll granularity. That is about the same as today
    (§ C).

### (b) Claim + short wait (a real claim)

This is symmetric: whoever claims first syncs, and the loser polls then falls
back. It needs a place to claim, and every no-new-state place fails:

- **`SalesPeriodCache`:** on a first load the row does not exist. Creating
  it to claim would be a placeholder row, which breaks the § B rules
  (zeros read as real, gap-fill skipped, webhook skip fooled).
- **In-process memory:** summary and sales are separate route functions.
  There is no guarantee that two concurrent requests share an instance, so a
  `Map` of in-flight promises gives no cross-route guarantee.
- **Postgres transaction-scoped advisory lock** (`pg_try_advisory_xact_lock`
  keyed on store and day): this needs no column, but it holds an interactive
  transaction, and so a pooled Neon connection, **open across the Square HTTP
  call**. This repo already has a leaked-advisory-lock incident on the Neon
  pooler (the Prisma migrate lock, P1002). Not recommended.
- **A real claim therefore needs new state:** a per-store or per-store-day
  `SalesSyncState` row with a `syncStartedAt`. That is the BUG-19 /
  `squareLaborSyncState` pattern, and it means **a new table and a
  migration** (Phase 2 STOP). It is more general than (a+): symmetric, and it
  covers rollup and manual sync too. But it adds state for a fix whose
  latency payoff is ~nil (§ C).

### (c) Client-side: fetch once, both panels use it

- **Literal form** (one request feeds both panels): this is not a small
  change. The Sales card has its own date range and compare picker, so its
  payload is a different shape from summary's (`selection`, `comparison`,
  `selected`, `compareData`). Merging them means redesigning both endpoints.
- **Sequencing form** (the sales card waits for summary to settle before it
  fires): zero server change and never empty. But it **delays the sales card
  on every load**, warm ones included, by summary's whole response (77 ms
  warm, about 1 s on a staging first load, and it includes labor, goal and
  checklist work). That is a visible regression on every warm load to fix
  something that costs no visible latency today. It also moves sync
  ownership into React state, which is the wrong layer.

### Recommendation

**(a+).** It is the simplest option that never shows empty sales, it adds no
state and no migration, and it keeps BUG-7, the webhook and reconcile byte
for byte. **It does not need a column** (the `syncedAt` "read, not started"
problem the row anticipated is avoided, because (a+) never needs a "started"
instant). It needs no Phase 2.

## E. Background refresh (stale cache)

**Yes, (a+) covers it.** It handles the stale-path pair directly: summary
syncs in `after()`, and the sales route's `after()` waits, re-reads `syncedAt`
and skips. It also covers the poll re-entries **from the sales card**: those
land in the sales route and defer the same way. **It does not dedupe
summary's own poll re-entries** against each other (a slow refresh, more than
2 s, plus a summary poll gives a second summary `after()`). That is
pre-existing, bounded by `POLL_ATTEMPTS`, and BUG-7-safe. I'm noting it here,
not proposing to fix it.

**This is the production-relevant half.** On production the duplicate is
**only** this stale-path pair, because of the 03:00 reconcile row (§ C).

## F. Triage

- **FIX NOW (Phase 3, on Gary's go):** (a+) in `src/app/api/dashboard/sales/route.ts`
  only. The fixture is `scripts/verify-bug20.ts` as specified in the prompt,
  with Square stubbed and counted. One change of shape from the prompt's
  fixture bullet: "two concurrent first-load calls cause one Square search"
  holds when **summary** is one of the two. Two concurrent **sales** calls
  would each defer and then each fall back, so they get two searches after N
  ms. That is (a+)'s fixed-owner trade-off, and the fixture should assert it
  rather than hide it.
- **No migration under the recommendation.** Phase 2 is skipped unless Gary
  rules for (b)-with-a-table.
- **RULING NOW:**
  1. **Proceed knowing the latency payoff is probably ~nil?** The fix halves
     dashboard Square volume and removes the discard line. From code, it
     should not move first-load times (§ C). The staging test plan's "compare
     with 0.6–1.4 s" should be read as *expect no change*. Alternatively,
     re-scope BUG-20 to measurement first.
  2. **F1: (a+) vs (b)-with-table vs (c)-sequencing.** My lean is (a+). I
     also need N (proposed 3,000 ms) and the stale-path wait (proposed
     1,500 ms).
  3. **A timing log line** (`squareMs` / `writeMs`) in `syncSalesForStore`,
     in scope or not? It is the only way to answer "how much of a first load
     is Square". It changes nothing fetched, stored or shown, but F3 is
     worded broadly.
  4. **The comparison-day duplicate** (§ A, both routes gap-filling
     `today-364` on unbackfilled stores): in scope, or a ROW?
- **COMMENT (no action):** production never takes the inline path
  (03:00 reconcile row). Production first-load times exclude `after()` work.
  Summary's own poll re-entry can double a slow refresh. Rollup never shares
  a page with summary and sales.
- **Owed by Gary, not by code:** the raw staging log lines for 2026-11-03
  20:32–20:33 PST, if the per-request `[api/dashboard/*]` and `[sales-sync]`
  lines should be cited verbatim in the docs commit. Also, whether the
  "Froot Staging" Square app has an order-webhook subscription. That decides
  whether staging ever sees a today row before the first dashboard load, and
  the code can't tell.
