# SYNCSTATE_AUDIT — dashboard sync-state `create()` unique-constraint errors

Session: STAMP-745a1ee-SYNCSTATE, Phase 1 (read-only). Taken 2026-11-03 at
`745a1ee` on `staging`. Code reading only — no database queried, no Vercel log
pulled by this session. Log observations quoted below are from the session
prompt, not re-measured.

## Headline

**The prompt's hypothesis is half right.** The `prisma:error … Unique constraint
failed on (storeId)` lines are real and come from exactly the two `create()`
calls it suspected. But:

1. **They are not (mostly) a race.** They fire on **every dashboard load whose
   store is inside its cooldown** — which is nearly every load — not only when
   two requests collide. That is why they appear "on nearly every dashboard
   load".
2. **Single-flight per store already exists** and is correct. The losing
   request does **not** call Square. The labor/schedule refresh is **not** run
   twice per dashboard load.
3. **The error is already caught.** It reaches the logs only because the Prisma
   client is built with `log: ["error"]`, which prints a caught P2002 anyway.
   The app has already met and solved this exact noise twice, with
   `createMany({ skipDuplicates: true })` read by count.
4. **There IS a duplicated Square fetch per dashboard load — but it is the
   SALES orders sync, not labor.** `summary` and `sales` each run
   `syncSalesForStore` for the same store-day. BUG-7's guard makes the write
   safe, and `[sales-sync] … discarded 1 superseded by a newer fetch` is the
   log of that second fetch. Out of this prompt's scope as written; see § E.

No new column is needed. No migration.

---

## A. Every caller, and every trigger

### `squareLaborSyncState.create` / `squareScheduleSyncState.create` in `src/`

Exactly two, both in `src/lib/labor-dashboard.ts`:

| Line | Function | Table | Cooldown |
|---|---|---|---|
| 177 | `claimSync` | `SquareLaborSyncState` | `SYNC_COOLDOWN_MS` = 15 min (`:59`) |
| 271 | `claimScheduleSync` | `SquareScheduleSyncState` | `SCHEDULE_SYNC_COOLDOWN_MS` = 30 min (`:244`) |

Both have the same shape (`:168-183`, `:262-277`):

```ts
const claimed = await prisma.X.updateMany({
  where: { storeId, OR: [{ lastSyncStartedAt: null }, { lastSyncStartedAt: { lt: cutoff } }] },
  data: { lastSyncStartedAt: now },
})
if (claimed.count > 0) return true
try {
  await prisma.X.create({ data: { organizationId, storeId, lastSyncStartedAt: now } })
  return true
} catch {
  return false   // "another load owns this window"
}
```

Every other write to these tables is race-safe already:
`labor-actuals.ts:1081` `recordSyncStarted` and `labor-schedule.ts:511` are
`upsert`; `:1102`/`:535` and `:1112`/`:544` are `update` on a row that exists by
then. The `create()` calls in `scripts/verify-ms2.ts:380` and
`scripts/verify-ms3.ts:346` are fixture setup on fresh stores — not affected.

### Routes that trigger the refresh

Claimed (debounced) path — `scheduleLaborRefresh` / `scheduleScheduledShiftRefresh`,
both run inside `after()`:

| Route | Labor actuals | Schedule | Stores |
|---|---|---|---|
| `api/dashboard/summary/route.ts:160,162` | overlay on | overlay on | `[store]` |
| `api/dashboard/sales/route.ts:183,189` | overlay on **and `end === today`** | overlay on | `[store]` |
| `api/dashboard/rollup/route.ts:207,211` | overlay on | overlay on | all stores (capped 3 / 2 per load) |

Unclaimed (direct) path — call the sync itself, never touch `claimSync`:
`api/cron/labor-timecards/route.ts:94`, `api/cron/labor-scheduled-shifts/route.ts:81`,
`api/square/labor/sync/route.ts:68` (manual). These go through the `upsert` in
`recordSyncStarted` and cannot produce this error.

Not triggers: `labor/day-inspector`, `labor-inspector.ts` (comments say so
deliberately), `hr-ack-notification.ts` (comment reference only). Labor budget
and coverage routes do not appear in the caller set — they do not trigger a
refresh.

### The race, from the code

Two cases, and only the first is a race:

- **No row yet (first-ever load for the store).** `summary` and `sales` both
  run `updateMany` → 0 rows (nothing to update) → both `create()` → one
  commits, the other gets P2002 → caught → `false`. **One** sync runs.
  Error printed: once per table.
- **Row exists, inside cooldown (the normal case).** The `updateMany` WHERE is
  false → 0 → `create()` → P2002 (the row exists) → caught → `false`. **No**
  sync runs, correctly. **Error printed anyway, once per table per route.**
  With `summary` + `sales` loading together that is the four lines the prompt
  quotes, on every load until the cooldown expires.

So the log pattern "pairs on nearly every dashboard load" is the second case.
The `create()` fallback was written for the first case and is also hit by the
second, which is the common one.

---

## B. Is it caught, and what happens after

- **Caught: yes**, by the bare `catch {}` in both functions. Nothing is thrown
  into the response; `after()` runs post-response anyway.
- **Why it still logs:** `src/lib/prisma.ts:16` —
  `log: NODE_ENV === "development" ? ["error","warn"] : ["error"]`. Prisma's
  `error` log level prints the engine error before the exception reaches the
  caller's `catch`. The codebase states this explicitly in two places (§ C).
- **Does the loser fetch Square? No.** `claimSync` returns `false` and the loop
  `continue`s (`labor-dashboard.ts:211`, `:302`) before
  `syncTimecardsForStore` / `syncScheduledShiftsForStore`.
- **Does it retry? No.** One attempt per load; the next eligible attempt is
  after the cooldown.
- **Does anything fail for the user? No.** The card serves mirrored rows.
- **Is the refresh run twice per load? No, by code.** The concurrent case is
  serialised correctly: `updateMany` under READ COMMITTED takes the row lock;
  the second statement blocks, then re-evaluates WHERE against the committed
  `lastSyncStartedAt = now₁`, which is not `< cutoff`, so count 0. The
  no-row case is resolved by the unique index. Either way exactly one claimant
  wins. The `[labor-actuals]` / `[labor-schedule]` lines "in the same second"
  are one line each, from the one winner — one actuals sync and one schedule
  sync are two different syncs, not a duplicate. (Not re-verified against the
  logs by this session; Phase 2's test plan checks it.)

**One caveat to the "first loads are slow because of the labor Square calls"
reading:** both labor refreshes run in `after()`, so they do not hold the
response open. What does hold it open on a first load is the **inline**
`syncSalesForStore` when there is no `SalesPeriodCache` row for today
(`summary/route.ts:92-96`, `sales/route.ts:~227`). Vercel's logged duration may
include `after()` work as well; this session did not establish which.

---

## C. How the app already guards this — reuse, don't invent

Two shapes exist, and the right one here is the second:

1. **BUG-7, `src/lib/sales-sync.ts:120-140`** — `INSERT … ON CONFLICT DO UPDATE
   … WHERE syncedAt < fetchStartedAt`. A guarded write of DATA where the newer
   fetch must win. Its sibling shape is used for labor/schedule rows
   (`labor-actuals.ts:947`, `labor-schedule.ts:383-392`: "P2002 becomes
   structurally impossible"). This is about ordering two writers of data; the
   claim here does not write data.
2. **Insert-as-claim without a P2002 —
   `src/lib/notifications/schedule.ts:189-194` (`claimScheduleSlot`) and
   `src/lib/notifications/kinds/pace-alert.ts:153-162`.** Verbatim intent from
   the first: *"ON CONFLICT DO NOTHING, read by count — not create() + catch
   P2002 … a caught P2002 still prints a prisma:error line, which would fill the
   cron log with errors that are not errors."*

   ```ts
   const { count } = await prisma.notificationScheduleRun.createMany({ data: [args], skipDuplicates: true })
   return count === 1
   ```

   That is this bug, already diagnosed, already fixed elsewhere, with its reason
   written down. `claimSync` / `claimScheduleSync` predate it or missed it.

---

## D. Plan

**One change, in two functions, in one file:** `src/lib/labor-dashboard.ts`.

In `claimSync` and `claimScheduleSync`, replace the `create()` + `catch {}`
fallback with the `claimScheduleSlot` shape:

```ts
if (claimed.count > 0) return true
const { count } = await prisma.squareLaborSyncState.createMany({
  data: [{ organizationId, storeId, lastSyncStartedAt: now }],
  skipDuplicates: true,
})
return count === 1
```

(and the same against `squareScheduleSyncState`). Comments updated to cite
`claimScheduleSlot` and say why `create()` + catch was wrong here.

What this does and does not change:

- **Error gone in both cases.** Row exists → `ON CONFLICT DO NOTHING` → count 0
  → `false`, silently. No row + race → one insert wins, the other count 0.
- **Single-flight: unchanged, because it already exists.** The conditional
  `updateMany` stays first and is already the "start only if no refresh started
  in the last N" claim the prompt asks for. **N is already set**: 15 min
  (actuals) / 30 min (schedule), both Gary's earlier rulings. The plan does
  **not** touch them.
- **Fetched data, written data, refresh frequency, dashboard output:
  unchanged.** A failed sync still holds its claim (DEBT-69), unchanged.
- **Genuine DB errors** (connection drop etc.) now propagate out of
  `claimSync` instead of being swallowed as "lost the claim". They land in the
  existing per-store `catch` in the `after()` loop (`:216`, `:309`), which logs
  `[labor-dashboard] refresh failed store=…` and moves on to the next store.
  Strictly better: today a DB outage reads as "cooldown held".
- **No new column, no schema change, no migration.**
- Export both claim functions so the fixture calls the real SQL — the
  `sales-sync.ts:120` precedent ("a test that could not call it would be testing
  a copy of the SQL").

### Fixture `scripts/verify-syncstate.ts` (Phase 2)

Against the dev DB, fixture principals named `SYNCSTATE …`:

1. Two concurrent `claimSync` for a store with no row → exactly one `true`, one
   row, **zero** `prisma:error` (fixture builds its client with the same
   `log: ["error"]` and captures `console.error`/stderr for the run).
2. Same for `claimScheduleSync`.
3. Third call inside the window, row present → `false`, zero errors (the
   common case — the one actually filling the logs).
4. Call with `now` past the cooldown → `true` (refreshes again).
5. Two different stores concurrently → both `true`.
6. "One Square refresh": the refresh runs if and only if the claim returns
   `true` (`:211`, `:302`), so counting claim winners counts refreshes and
   Square is never reachable from the fixture. If Gary wants the `after()` loop
   itself exercised, that needs a stubbable sync seam — say so and it gets one.

Then all 66 `scripts/verify-*.ts`, each file's own summary line.

---

## E. Out of scope — found, not fixed

**The duplicated Square fetch is real, and it is the sales orders sync.**
`summary` (`route.ts:85-115`) and `sales` (`route.ts:~220-240`) each decide
independently to run `syncSalesForStore(org, store, today, today)`: inline when
today has no cache row, in `after()` when stale. Loaded in parallel, both call
`POST /v2/orders/search` for the same store-day. BUG-7's guarded write keeps the
data correct — the older fetch is discarded — and the
`[sales-sync] … discarded 1 superseded by a newer fetch` line is that discard
being logged. On a first-ever load for a day, **both** inline syncs sit in the
response path. This is the likeliest share of the "first loads ~1 s" figure.

A single-flight claim for that would need a claim token for the sales sync —
`SalesPeriodCache.syncedAt` records the READ instant, not a "started" instant,
so it is not obviously reusable the way `lastSyncStartedAt` is. It may need a
column. Not planned here.

## F. Triage

- FIX NOW (Phase 2, on Gary's go): § D.
- RULING NOW: tier (below); fixture depth (§ D item 6); whether § E is in scope.
- ROW: § E if not taken now — a duplicated Square orders fetch on every parallel
  dashboard load, BUG-7-guarded, likely in first-load latency.

### Tier

The change is to code that **writes rows on the Square sync path** (the claim
row is inserted). CLAUDE.md § Session Tiers lists both "Square sync" and
"anything that writes rows" under TIER 3, and ambiguity resolves upward. No
migration either way. The prompt's own process (audit artifact, STOP before
code) already matches TIER 3 apart from the migration STOP, so the only
practical difference is naming it.
