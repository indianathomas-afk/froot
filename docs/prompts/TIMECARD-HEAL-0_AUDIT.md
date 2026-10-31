# TIMECARD-HEAL-0 — open-card investigation — AUDIT

Session: TIER 3, investigation only. Taken 2026-10-31 at `dbf0121` on `staging`
(tree clean except the prompt file). No code, schema or migration touched.
Written per CLAUDE.md § Where documents live ("an audit-only session must write
its findings to `docs/prompts/<NAME>_AUDIT.md` before it reports"). This file is a
claim wholesale; nothing in it is edited afterwards.

Database reads in this session: ONE, on dev only (A5). No staging or production
read. Prisma commands run: none.

---

## Phase A — read

### A1. The timecard sync

**One function does every timecard fetch:** `syncTimecardsForStore`,
`src/lib/labor-actuals.ts:660`. Three callers:

| Caller | Window | Where |
|---|---|---|
| Cron `/api/cron/labor-timecards` | store-local `today-2 .. today` (`RECONCILE_DAYS = 3`) | `src/app/api/cron/labor-timecards/route.ts:60`, `:91-94` |
| Dashboard trigger `scheduleLaborRefresh` | store-local **today only** | `src/lib/labor-dashboard.ts:213-214` |
| Manual `POST /api/square/labor/sync` | body `startDate..endDate`, default today | `src/app/api/square/labor/sync/route.ts:62-68` |

Correction to the prompt: `labor-dashboard.ts:302-319` is the **scheduled-shift**
refresh (`scheduleScheduledShiftRefresh`). The timecard trigger is
`scheduleLaborRefresh` at `labor-dashboard.ts:197-229`. It fires from
`api/dashboard/sales/route.ts:183` (only when `end === today`),
`api/dashboard/rollup/route.ts:207` and `api/dashboard/summary/route.ts:160`.
It has a 15-minute per-store cooldown (`:59`) and a cap of 3 stores per load (`:67`).

The manual route has **no UI caller.** `grep -rln "square/labor/sync" src` finds only
the route itself and the unrelated roster-sync route. It can only be called by hand.

The cron is registered (`vercel.json`, `"30 11 * * *"`). Vercel runs crons on
production deployments only, so **staging's only timecard sync is the
dashboard trigger, which fetches today only.**

**The Square query** (`labor-actuals.ts:678-695`): `POST /v2/labor/timecards/search`,

```
query.filter.location_ids = [store.squareLocationId]
query.filter.workday = { date_range: {start_date, end_date},
                         match_timecards_by: "START_AT",
                         default_timezone: store.timezone }
limit 200, cursor-paged
```

**What decides what is fetched: the START date** (store-local workday of
`start_at`). There's no updated-time filter, no status filter and no persisted
cursor. The cursor is only for paging within one request.

**The window:** the cron uses 3 store-local start-days, the dashboard 1 (today),
and the manual route whatever the caller passes.

**How an existing card is updated** (`writeTimecards`, `labor-actuals.ts:760-829`):
`INSERT … ON CONFLICT ("organizationId","squareTimecardId") DO UPDATE SET` every
mirrored column (store, member, location, `startAt`, `endAt`, `status`,
`squareVersion`, created/updated, breaks, wage fields, tips, timezone, `syncedAt`)
`WHERE "SquareTimecard"."squareVersion" <= EXCLUDED."squareVersion"` (`:818`). So
a card is updated only when it comes back in a fetch, and then only when Square's
version has not gone backwards. No delete precedes it (`:748-753`).

Sync state (`SquareLaborSyncState`, `prisma/schema.prisma:3506`) records the
attempt only: started, ok, window, count and error. It records nothing per card,
so nothing in it could drive a re-fetch.

### A2. Does anything ever re-fetch an open card outside the window?

**NO.** The only Square read is `syncTimecardsForStore`, and its only selector is
`workday.date_range` on START_AT (`labor-actuals.ts:684-688`). No code path reads
Froot's own open rows and asks Square about them. A card whose start date has
left every caller's window is never fetched again, whatever happens to it in
Square. The cron route records this limit about corrections
(`route.ts:42-44`), but the limit applies equally to clock-outs.

### A3. The Square side

**There are no installed SDK types.** `node_modules` has no `square` package, and
`package.json` does not list one, because Froot calls Square with raw `fetch`. The
prompt's source is unavailable. The substitute used here is the locally
installed `square` CLI (`0.3.34-dev…`), read **offline** with `--schema` and
`--print-operation`. No Square request was made. The CLI fronts Square's GraphQL
layer, so its field names are camelCase mirrors of the REST `TimecardFilter`.

- **Filter by `updated_at`: NO.** The filter's fields are `locationIds`, `status`,
  `start` (range), `end` (range), `workday` (`startDate`/`endDate`/
  `matchTimecardsBy` ∈ START_AT, END_AT, INTERSECTION), and `teamMemberIds`.
  `UPDATED_AT` appears only as a **sort** field (`field` ∈ START_AT, END_AT,
  CREATED_AT, UPDATED_AT).
- **Filter by status: YES** (`status` ∈ OPEN, CLOSED). It doesn't help heal,
  though: a card frozen open in Froot is CLOSED in Square, so asking Square for
  OPEN cards never returns it. Asking for CLOSED cards needs a date bound anyway.
- **Fetch by id: YES.** `square labor timecard get <id>` exists ("Returns a
  single Timecard specified by id"). The REST path (GET
  `/v2/labor/timecards/{id}`) comes from memory and was **not** verified from a
  local source. Confirm it against Square's REST reference at build time.
- **`end` time range: YES.** "Every card that ended between X and Y" is
  expressible, which catches a clock-out that lands after the last sync. It does
  **not** catch a manager correction that back-dates `end_at` to before X.

**Options that heal with the scopes Froot already holds** (`TIMECARDS_READ`, which
is live): (a) fetch by id for each card Froot holds as open; (b) a search on
`workday` START_AT covering the open cards' start dates, optionally narrowed by
`team_member_ids`; (c) a search on the `end` range since the last good sync.
Option (a) is the only one that also says "this card no longer exists" (a 404),
which matters for the deletion-blindness limit (`labor-actuals.ts:749-753`). None
of them needs a new scope.

### A4. The display side

**Inspector** (`src/lib/labor-inspector.ts`):

- **The read:** closed cards have a 7-day floor. **Open cards have no lower bound**
  (`endAt: null, startAt < dayEnd`, `:902-904`). That is deliberate (S5-A1,
  `:848-856`), so the page can see phantoms. It also means every frozen card
  since August is drawn on every later day.
- **"Open, stale"** (`:482-487`): `endAt === null && startDate < store-local
  today`. This is a date comparison, not a duration.
- **"Double"** (`:457-469`): two cards of one member overlap by at least
  `DOUBLE_MIN_OVERLAP_MINUTES = 1` (`:77`), each measured to
  `clockedEndMs(card, ceilingMs)`. Two frozen open cards for one person both run
  to the ceiling, so they always overlap. So does one frozen card and that day's
  real closed card. This is why "Double" rides along with "Open, stale".
- **The open bar's end** (`:379`): `ceilingMs = min(now, dayEnd)`. On a past
  day the bar runs to the end of that day, which is why the bars span the whole
  day.
- **Paid hours** (`:514`, label `:590`): `paidMinutesOf(tc, ceilingMs)` is
  **not clipped to `dayStart`**. A card opened 2026-08-01 and viewed on 10-29 is
  credited from Aug 1 to Oct 30 00:00, about 2,140 h. Alyssa's 7,787 h equals
  about 3.6 such spans, which fits several frozen cards per person. I did not
  verify this per person, because there was no staging read.

**Numbers outside the Inspector that read open cards:**

1. **Labor % / labor cost / labor hours.** `getLaborActuals`
   (`labor-actuals.ts:262-265`) and `getLaborActualsForStores` (`:339`) select by
   `startAt` in the window. An open card is costed to `min(now, windowEnd)`
   (`:141`, `paidMinutesOf :236-241`). A frozen card therefore inflates **any
   window that contains its start day**, by the time from its start to the end of
   the window. On a month-to-date window that is up to weeks of wage. Consumers:
   dashboard sales card (`api/dashboard/sales/route.ts:178`), summary
   (`summary/route.ts:159`, month-to-date), rollup per store and estate
   (`rollup/route.ts:178, :249-250`), and `/api/square/labor/actuals`. **On staging
   today, any month-to-date or range figure for October that covers a
   frozen card's start day is overstated.** Today-only windows are not affected
   once the start day has passed. Tips' hourly average (`getTipPayoutForStores`,
   `:553`) uses the same rule, so its divisor is inflated the same way.
2. **On-time % ("Scheduled vs actual" in practice).** The literal string
   "Scheduled vs actual" does not exist in `src/`. The schedule-against-clock
   comparison outside the Inspector is `attendance.ts`. It copies the
   Inspector's split, so **open cards have no lower bound** (`attendance.ts:334-343`)
   and run to `now` (`:180`). In `assembleOnTime` (`:183-190`) a frozen card
   pairs with **every** later scheduled shift of that person at that store. The
   "earliest paired card" is then the frozen one, whose start is weeks before the
   shift, so `isOnTime` is true. Result: **every shift after a frozen card counts
   as on time and can never be a no-show.** Consumers: `/staff` on-time badge,
   `/staff/[id]`, Milestones, `api/milestones/attendance`, `milestone-report`,
   and **raise eligibility** (`raise-eligibility.ts:9, :289-302`,
   `raiseMinOnTimePct`). A frozen card can therefore mark someone as meeting
   a raise's on-time criterion.
3. **Clocked-in coverage curve and roster** (`labor-schedule.ts:912-917`,
   `:1230-1236`) use a 24h lookback, so a frozen card affects them only for
   the day after its start. Raise-eligibility **hours** select closed cards only
   (`raise-eligibility.ts:503-509`) and are not affected.

**Could production get the same?** Yes, by the same code, whenever a card leaves
the cron's 3-start-day window still open in Froot. Concrete ways that can happen:
three consecutive failed cron runs for a store; an org gate off at cron time
(`route.ts:81-83` skips silently); or a forgotten clock-out that a manager fixes
4+ days later. That last case is the ordinary way a clock-out gets fixed.

### A5. Dev data

`br-broad-wave-a6vpjdw0` (dev), 2026-10-31 22:29:40 UTC (15:29 PDT), server-reported
branch id in the same row:
`open_total=0, open_older_24h=0, open_status_mismatch=0, all_cards=0, last_synced_utc=null`.

**Dev holds no timecards at all.** This matches the known dev Square grant, which
lacks the timecard scopes. Dev can neither prove nor disprove the theory, so the
fix phase's fixture must be synthetic.

### A6. SQL for Gary (Neon console, read-only; run on staging, then production)

```sql
SELECT current_setting('neon.branch_id', true)              AS branch_id,
       s.id                                                 AS store_id,
       s.name                                               AS store_name,
       count(*)                                             AS open_older_24h,
       count(*) FILTER (WHERE t.status <> 'OPEN')           AS status_says_closed,
       min(t."startAt")                                     AS oldest_start_utc,
       max(t."syncedAt")                                    AS newest_synced_utc,
       count(DISTINCT t."squareTeamMemberId")               AS people
FROM "SquareTimecard" t
JOIN "Store" s ON s.id = t."storeId"
WHERE t."endAt" IS NULL
  AND t."startAt" < (now() AT TIME ZONE 'UTC') - interval '24 hours'
GROUP BY s.id, s.name
ORDER BY open_older_24h DESC;
```

Columns are `TIMESTAMP(3)` without a zone, stored as UTC. That is why the
comparison uses `now() AT TIME ZONE 'UTC'`. Zero rows means zero such cards.
`newest_synced_utc` much older than `oldest_start_utc + 3 days` is the theory's
fingerprint: the row was last touched while still open, then never again.

---

## Phase B — findings and plan

### B1. Verdict: **RIGHT**, with one sharpening and one extension

In plain terms: Froot only ever asks Square about cards by the day they
**started**. Staging only asks about **today**, and only when someone loads a
dashboard. Any card that was open at the last dashboard load of its start day
is frozen open in Froot forever. Nothing ever asks Square about it again. That
is BUG-10's mechanism without the cron that fixed it, and staging has no cron.

- The sharpening: the window is by **start date**, not "a few days back" in general
  (`labor-actuals.ts:684-688`). On staging it is **one** day (`labor-dashboard.ts:214`).
- The extension: it is worse than an Inspector display problem. Frozen cards
  inflate labor % and cost on any range covering their start day, and they make
  on-time % pass every later shift, which feeds raise eligibility (A4 §1–2).
- Production is fine today because the cron re-fetches 3 start-days nightly. The
  gap is real there too (A4, last paragraph).
- Not proven: that every staging card is CLOSED in Square. A6 plus a Square-side
  spot check of two cards would close that. BUG-10 did exactly this check for two
  August cards and found both closed.

### B2. Fix options and lean

1. **Heal pass, by id.** Inside `syncTimecardsForStore`, after the window fetch,
   GET each card Froot holds as `endAt IS NULL` whose start precedes the window
   start, then upsert through the existing version guard. A cap per run, with a
   named "deferred N" log line, the same pattern as `MAX_SYNCS_PER_LOAD`. **Lean:
   YES.** It's precise, it's bounded by the number of phantoms rather than by
   days, and it rides every caller, including staging's dashboard trigger (the
   cron alone would never heal staging). A 404 is recorded and logged, **not acted
   on**, because deletion still needs the vanish-vs-tombstone ruling.
2. **A wider window: NO** as the fix. It only moves the cliff, and on staging the
   dashboard window would have to become weeks to matter.
3. **A display/count guard: YES, narrow.** An open card whose start is more than
   N hours before the ceiling stops accruing: zero paid minutes, labelled
   "unknown" and not counted as hours. It also **does not pair as attendance**.
   It must live in the shared helpers (`clockedEndMs` / `paidMinutesOf`, plus the
   attendance pairing), so labor %, tips, Inspector and on-time agree, per those
   helpers' own anti-drift docstrings. It's needed because the heal can lag: on
   staging until someone loads a dashboard, everywhere if a card is deleted in
   Square, and before the first heal run.

**Combination: 1 + 3.** The heal fixes the data. The guard stops whatever the heal
hasn't reached yet from turning into money, attendance or raise outcomes.

### B3. Tier, size, migration, fixture

- **TIER 3** (Square sync, money, attendance → raise). Medium: one sync function,
  two shared helpers, one attendance predicate, and the Inspector label.
- **No migration.** Every field needed exists: `endAt`, `status`, `startAt`,
  `squareVersion`, `squareTimecardId`.
- **Fixture:** synthetic, since dev has zero cards. (a) The heal's selection
  query picks open-and-before-window cards only, and respects the cap and the
  deferral count. (b) A mocked Square GET returning CLOSED v+1 closes the row,
  and v-1 is discarded by the guard. (c) A 404 leaves the row and logs it.
  (d) The guard: a stale open card adds 0 paid minutes to `computeLaborActuals`,
  `computeTipPayout` and the Inspector, and does not pair in `assembleOnTime`. A
  today-open card under N still accrues. The clock is injected in every case, as
  BUG-10's fixture did.

### B4. RULING NOW items

1. **N for the guard.** Lean **24 h**, which matches the coverage/roster lookback
   and its comment ("a card open longer than 24h is a data problem",
   `labor-schedule.ts:909-911`). Draft: *"An open timecard older than 24 hours
   is counted as unknown, never as paid time or attendance."*
2. **Is the guard in scope with the heal?** Lean **yes, same phase**. Draft:
   *"The heal and the guard ship together; the heal alone leaves staging and
   deletions wrong."*
3. **Heal method.** Lean **by id, capped per run**. Draft: *"Heal by fetching each
   stale open card by id, at most K per store per run."* (K: lean 25.)
4. **404 handling.** Lean **log only**, deferring to the existing
   vanish-vs-tombstone question. Draft: *"A 404 on heal is logged, not acted on,
   until the deletion ruling."*
5. **The Inspector's paid hours clipped to the viewed day?** Lean **yes, in the
   same phase**: it's the display half of the same defect, and otherwise a guarded
   card still shows its pre-guard day. Draft: *"Inspector paid hours count only
   the viewed day."*

### B5. Out-of-scope findings, classified

FIX NOW: not allowed (no code). Counts: FIX NOW 0 · RULING NOW 0 · COMMENT 2 · ROW 2.

- **ROW.** Inspector paid hours count whole cards, not the overlap with the
  viewed day, for closed midnight-spanning cards too (`labor-inspector.ts:514`).
  A 22:00→02:00 card shows its full hours on both days. It's separate from the
  phantom fix, unless B4 item 5 folds the open case in. The closed case still
  stands.
- **ROW.** The manual `/api/square/labor/sync` has no UI caller. Staging has no
  operator lever to re-pull a range. Low priority once the heal lands.
- **COMMENT.** The prompt cited `labor-dashboard.ts:302-319` as the timecard
  path. That is the schedule refresh. The timecard path is `:197-229`. It is
  recorded here so the fix row cites the right line.
- **COMMENT.** A3's named source (SDK types in `node_modules`) does not exist in
  this repo. The CLI schema stood in, and the REST by-id path still needs
  confirming at build time.
