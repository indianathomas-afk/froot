# Advanced Labor

The build that L-2 became. Gary lifted the L-2 deferral on 2026-08-18
(`DECISIONS.md` § "The L-2 deferral is lifted — Advanced Labor is the build")
and the lift named a vision that **did not exist anywhere in the repo** — the
SQ-VER-1 session recorded that `grep -rli "advanced labor"` over `docs/` and
`froot_docs/` returned nothing the same day. This file is that gap closed.

**Status: PHASE 2 BUILT — 2026-08-19 (AL-2 Phase B, work commits `8a28f61` and
`f47e3bd`), staged, NOT promoted.** Prepended per preserve-and-mark; nothing below this
block is edited. The dashboard now renders the number Phase 1 made trustworthy:
labor % on the Sales Performance card, MTD labor % on the Monthly Goal card, and
a labor % card, a per-store column and a date-range picker on All Locations
(vision items 1, 3, 4, 6, 7). Phase 3 — items 2, 5 and 10 — has not started.

**What Phase 2 added.** `src/lib/labor-judgment.ts` (the comparator, the payload
shape and the honesty lines), `src/lib/labor-dashboard.ts` (the five gates, the
target lookup and the freshness policy, written once for three routes),
`src/app/(app)/dashboard/labor-pct.tsx` (every render rule in one component) and
`src/app/(app)/dashboard/date-range-picker.tsx` (the Sales Performance card's
picker, EXTRACTED so All Locations can share it rather than copy it). Labor
blocks on `/api/dashboard/sales`, `/summary` and `/rollup`; range parameters on
`/rollup`; one new capability, `labor.actuals.view`. **No migration, no schema
change, no cron registration, no webhook change, no write to Square.**

**The coverage fix is the load-bearing change, not the cards.** MTD labor % over
a partly-synced month divided N days of cost by M days of sales — three synced
days in a nineteen-day month read ~3.2% against a 20% target, which is green,
precise and wrong. `getLaborActuals` now derives the store-local days that carry
timecards from rows it has already loaded and restricts **both** sides to them,
returning `daysCovered` / `daysInWindow` so every surface can say "N of M days
synced". AL-1's verified 33.7% was a single-day query, where covered and window
are the same day by construction, so the defect could not surface there.

**Gary's rulings at the AL-2 hard stop, 2026-08-19** — all seven, each enforced
at its site in `8a28f61`:

| # | Ruling |
|---|---|
| **Q-V** | Labor % visible to ADMIN, MANAGER and STORE alike, and **deniable per user from the /users grid**. Dollars stay MANAGE. No wages, no per-person data, anywhere. |
| **R1** | The 2026-08-05 ruling wins: a disconnect renders **stale with a last-synced stamp, never absent**. "Renders exactly as today" binds the toggle and env gates only. |
| **R2** | Judged against `laborTargetPct` **as set**, never the tier-floored effective rate. |
| **R3** | Reuse the existing three-zone scale (`zone()` in `labor-budget-card.tsx`). **SUPERSEDED the same day — see the boundary ruling below.** |
| **R4** | The projection divides by the **existing goal-weighted month-end sales figure**, labelled. |
| **R5** | No graph recolour; a slim labor meter in the metric row. |
| **R6** | The picker drives the **ranking table**; the three summary cards stay month-anchored. |
| **Q2 rider** | The one-line "Advanced Labor: On/Off" badge on `/labor` ships with this phase, discharging AL-1 Q2's promise. |

**The Q-V ruling could not be wired to `labor.view`, and the reason is recorded
rather than worked around.** Gary asked for `labor.view` *if that capability
supports per-user overrides*. It does not: an override is only expressible for a
capability in `ENFORCED_CAPABILITIES`, `labor.view` is not one, and it cannot be
added cheaply because it gates the Labor nav entry, the `/labor` page and every
`/api/labor` route — denying it to hide one percentage would take the whole
module with it. (`labor.manage` is held out of the grid for the related reason
PERM-5C recorded: "Labor governance is its own ruling.") The smallest change that
puts the **percentage, and only the percentage**, in the grid is a new
capability: `labor.actuals.view`, tier OPERATIONAL, with a grid row. It has no
prior call sites, so **no role's baseline moved**. This is the presented
alternative the ruling asked for; it is live in `8a28f61` and Gary's staging pass
is where it is confirmed or reversed.

**The boundary ruling — meeting budget is GREEN (Gary, 2026-08-19, work commit
`f47e3bd`).** R3 originally said to reuse `zone()`'s scale verbatim, which put
amber one point *below* target and therefore showed a warning colour to an
operator who came in at 19.5% against a 20% target — and again at exactly 20.0%.
Gary flipped it for actuals:

| Actual | Verdict |
|---|---|
| `pct <= target` | **green** |
| `target < pct <= target + 1` | **amber** — over budget, inside the grace band |
| `pct > target + 1` | **red** |

Amber moved sides rather than disappearing: a store a tenth of a point over is not
in the same condition as one three points over, and collapsing both to red would
throw away the only signal between them. Vision item 3's "green if meets/exceeds"
is now literal.

**This diverges from `zone()` on purpose, and the divergence is fenced by a
fixture check.** The Labor Budget card still judges the PLANNED percentage on the
old convention, because a plan cutting it fine is worth a nudge while an actual
landing under target is not. The visible consequence: on one dashboard a store at
19.5% against a 20% target shows **amber on the Labor Budget card and green on
every labor % readout**. If a later session "harmonises" the two scales, the named
check in `scripts/verify-labor-actuals.ts` is what fails.

**Known limits carried forward, all unchanged by this phase:** overtime is still
deferred and labelled (`otApplied: false`); the salaried GM who never clocks in
is still unmeasured (Phase 3's roster work); a timecard deleted in Square still
persists as a stale row; and the cron is still unregistered, so freshness rests on
the debounced sync-on-load this phase added.

---

**Status: PHASE 1 BUILT — 2026-08-18 (AL-1 Phase B), staged, NOT promoted.**
Gary ruled on every open question at the AL-1 hard stop and the build followed
those rulings; each is recorded inline in § Open questions below, marked
**RULED**. Phase 2 has not started, and nothing here has reached production.

What exists after Phase B: the `squareLaborEnabled` column and the two tables
(migration `20260818223900_al1_advanced_labor_phase1`), `src/lib/labor-actuals.ts`,
the toggle inside the Square Integration card, three routes under
`/api/square/labor/` (`toggle`, `sync`, `actuals`), an unregistered cron at
`/api/cron/labor-timecards`, and the acceptance fixture
`scripts/verify-labor-actuals.ts`. No dashboard card, no `/staff` surface, no
Positions change.

**This file does not supersede the seam.** `docs/ROADMAP.yaml` L-2 seams (a)
through (d) remain authoritative for the toggle, the data boundary, the
failure posture, and the scope/version gates. Where the AL-1 prompt and the
seam disagree, the disagreement is recorded in § Open questions rather than
resolved here.

---

## Gary's vision, verbatim

Recorded 2026-08-18. **These are Gary's words and are not edited.** One
bracketed annotation appears in item 8, marked inline, because the original
sentence was superseded by the read-only ruling of the same day.

1. /dashboard Sales Performance card: real-time labor % alongside gross
   sales / transactions / average sale; green bar in the sales graph when
   within budget (meets or exceeds goal), red bar when not.
2. /staff page shows pay rate for all staff — Manager/Admin access only.
3. /dashboard Monthly Goal card: MTD labor % vs budget — green if
   meets/exceeds, bold red if over.
4. /dashboard All Locations: card showing MTD labor % across
   [Today · All Locations], [to Date], [Projected Month End].
5. /dashboard All Locations: Tips column — average hourly tip payout per
   location MTD.
6. /dashboard All Locations: selectable date ranges (daily, weekly,
   monthly, custom) matching the Sales Performance card.
7. /dashboard All Locations: MTD labor % column — green within budget, red
   out of budget.
8. /labor page: "Advanced Labor" option — sync labor from Square (READ
   ONLY; "sync to Square" in the original vision is superseded by the
   read-only ruling — Gary confirmed reporting data only).
9. /labor Budget settings: unchanged.
10. /labor Positions (rate legend): with Advanced Labor enabled, lists the
    store's team members from Square with pay and current positions;
    positions may vary per Square; WK HRS and SUP stay Froot-adjustable.
11. /labor Weekly → daily split: unchanged.
12. /labor Shift blocks (min staffing): unchanged.

---

## Phase map

| Phase | Scope | Vision items |
|---|---|---|
| **Phase 1** (AL-1, this design) | Toggle + timecard ingest + labor % foundation. **No dashboard UI.** Makes the labor number exist and be trustworthy. | 8 (the toggle half) |
| **Phase 2** (AL-2, BUILT 2026-08-19, `8a28f61`, **staging**) | Dashboard cards. | 1, 3, 4, 6, 7 |
| **Phase 3** | /staff pay rates, Positions roster from Square, tips. | 2, 5, 10 |
| **Explicit non-changes** | Budget settings, weekly→daily split, shift blocks. Named here so a later session cannot read silence as permission. | 9, 11, 12 |

Phase 1 deliberately builds no card. The reason is the seam's own boundary
test: a Phase that ships a number *and* a surface in the same commit cannot
tell a wrong number from a wrong render. Phase 1 ends with one ADMIN-gated
JSON route, so the number is verifiable on its own before anything depends
on it.

---

## Phase 1 design

### 1. The toggle

Per L-2 seam (a), which this design follows unchanged except where § Open
questions Q1 and Q2 record a conflict with the AL-1 prompt.

- **Availability gate** — `SQUARE_LABOR_AVAILABLE` env plus
  `SQUARE_LABOR_INTERNAL_ORG_IDS`, the exact shape of `laborModuleAvailable()`
  / `hrModuleAvailable()` (`src/lib/auth.ts:35,53`). Server-side only, never
  `NEXT_PUBLIC_`.
- **Per-org column** — `Organization.squareLaborEnabled Boolean @default(false)`,
  a dedicated column like `instagramEnabled` (`prisma/schema.prisma:28`), **not**
  a fifth entry in `activeModules`. The seam's reason stands: `activeModules` is
  the billable add-on list driving the module cards at
  `src/app/(app)/settings/page.tsx:63-70`; "Weekly Labor Model" is the product
  the org buys, and a Square connection is a *data source* for a module they
  already pay for. An `activeModules` entry would advertise it as a separate
  purchase and would permit the incoherent state square-labor-without-labor.
- **Enforcement** — `requireSquareLabor()` in `src/lib/labor-access.ts`, layered
  over `requireLaborView()`: both labor gates first, then the two Square gates,
  each failing to **404** so an org without the feature cannot probe it.
- **Flip route** — `POST /api/square/labor/toggle`, ADMIN-only, mirroring
  `/api/labor/toggle` and `/api/instagram/toggle`.
- **A disconnect does not turn it off** (Gary, 2026-08-05). The column stays
  `true` through `/api/square/disconnect`; the overlay drops to ON BUT
  UNHEALTHY and a reconnect restores the feature with no second admin action.

### 2. Schema

Additive only: one new column, and two new tables (§ Open questions Q3 records
that AL-1 scope A specified one).

#### `Organization.squareLaborEnabled`

```prisma
squareLaborEnabled  Boolean  @default(false)
```

#### `SquareTimecard`

Every field is justified against a vision item below. Nothing rides in
unjustified; three candidate fields were **rejected** and are listed after the
table.

```prisma
/// L-2 seam (b): Square-sourced labor lives in prefixed storage that no core
/// labor engine reads. labor-budget.ts / labor-plan.ts / labor-coverage.ts /
/// labor-forecast.ts must never import anything that reads this table.
///
/// ALL DateTime COLUMNS ARE UTC (TIMESTAMP(3), no time zone — the whole file
/// is). Square sends `start_at` / `end_at` as RFC 3339 already shifted to the
/// LOCATION's offset; the sync parses that offset and stores the UTC instant.
/// Display-local conversion is the reader's job and uses `Store.timezone`,
/// falling back to `Organization.timezone` (DEBT-70a's chain). `timezone`
/// below is Square's own answer for the location, kept so a value can be
/// re-rendered local without trusting our copy of the store record.
model SquareTimecard {
  id                  String    @id @default(cuid())
  organizationId      String
  storeId             String
  squareTimecardId    String
  squareTeamMemberId  String
  squareLocationId    String
  startAt             DateTime
  endAt               DateTime?
  status              String
  squareVersion       Int
  squareCreatedAt     DateTime
  squareUpdatedAt     DateTime
  breakPaidMinutes    Int       @default(0)
  breakUnpaidMinutes  Int       @default(0)
  wageTitle           String?
  wageJobId           String?
  wageHourlyRate      Decimal?  @db.Decimal(10, 2)
  wageTipEligible     Boolean?
  declaredCashTips    Decimal?  @db.Decimal(10, 2)
  timezone            String?
  syncedAt            DateTime
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id])
  store        Store        @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@unique([organizationId, squareTimecardId])
  @@index([storeId, startAt])
  @@index([organizationId, syncedAt])
}
```

| Field | Square source | Justified by |
|---|---|---|
| `organizationId` | — | Org scoping; every table in this schema has it. Also half the upsert key, which makes a cross-tenant id collision unrepresentable rather than merely unlikely. |
| `storeId` | resolved from `location_id` → `Store.squareLocationId` | The join key every read uses (1, 3, 4, 7). **Not** a DEBT-9 attribution: per-store labor comes from Square's own `location_id`, never from `StaffMember.primaryStore` — confirmed 2026-08-02, do not re-derive. |
| `squareTimecardId` | `id` | The upsert key. Poll-based ingest re-reads windows; without this the sync is not idempotent. |
| `squareTeamMemberId` | `team_member_id` | Per-person hours for the Positions roster (10) and per-person tip payout (5). **Never leaves the server in Phase 1** — see § 5. |
| `squareLocationId` | `location_id` | Kept beside `storeId` so an unmapped or re-mapped location is auditable rather than silently mis-attributed. A timecard for a Square location Froot has no `Store` for is a *skip with a reason*, not a crash. |
| `startAt` / `endAt` | `start_at` / `end_at` | Hours, the numerator's first half (1, 3, 4, 7). `endAt` is **nullable on purpose**: an OPEN timecard is someone currently on the clock, and item 1 says *real-time* labor %. |
| `status` | `status` (`OPEN`/`CLOSED`) | Distinguishes "still on the clock" (cost is projected and will grow) from "never clocked out" (a data problem). Without it a null `endAt` means both. |
| `squareVersion` | `version` | **The idempotency guard.** See § 3 — this is the source's own monotonic counter and is strictly better than our read clock. |
| `squareCreatedAt` / `squareUpdatedAt` | `created_at` / `updated_at` | `updated_at` is the manager-correction signal the seam's ingest question is about ("timecards are edited after the fact"). Also the audit trail for a number that moved. |
| `breakPaidMinutes` / `breakUnpaidMinutes` | summed from `breaks[]` (`is_paid`) | Paid breaks are compensable time and stay in the cost; unpaid breaks must come out of it. Getting this wrong overstates labor % on every store, every day. |
| `wageHourlyRate` | `wage.hourly_rate` (Money, cents → dollars) | The numerator's second half. **Nullable**, and null is load-bearing: Square carries a rate only where team-member wage settings are configured, and the seam requires the integration WARN on that gap rather than render a silent zero. Dollars as `Decimal(10,2)` per `docs/LABOR.md` § Money convention. |
| `wageTitle` / `wageJobId` | `wage.title` / `wage.job_id` | Item 10 — "lists the store's team members from Square with pay and **current positions**; positions may vary per Square". `job_id` is the stable key; `title` is what a person retypes. |
| `wageTipEligible` | `wage.tip_eligible` | Item 5 — an average hourly tip payout is meaningless if it divides by hours worked by staff who cannot receive tips. |
| `declaredCashTips` | `declared_cash_tip_money` | Item 5. Not a labor cost (see § 4 Q6) — reported as its own column, which is exactly how item 5 frames it. |
| `timezone` | `timezone` | Square's own zone for the location. Lets a UTC instant be rendered store-local without depending on `Store.timezone` being correct, which is a second opinion worth 20 bytes on a column the UTC/local trap has already burned three sessions. |
| `syncedAt` | — | Seam (b) requires it per table. Row-level provenance; **not** the health signal — see § 3. |

**Rejected, and why** — so a later session does not read their absence as an
oversight:

- **A `SquareTimecardBreak` child table.** Phase 1 needs *minutes*, and two
  `Int` columns answer every question items 1–7 and 10 ask. A break-by-break
  audit trail is a compliance feature nobody has asked for; it is additive
  later if one is.
- **`SquareScheduledShift`.** That is the scheduled-vs-recommended half of the
  comparison layer, and it belongs to Phase 2/3. Naming is pre-committed by
  L-2 DON'T #2 — never a bare `Shift`.
- **Annual / salaried wage fields.** Square's `TimecardWage` carries only
  `hourly_rate`, documented as either a custom hourly wage *or* "the calculated
  effective hourly wage based on annual wage and weekly hours". There is
  nothing further in the payload to store, so a salaried column would hold a
  number Froot invented.

An index on `(storeId, squareTeamMemberId, startAt)` is **deferred to Phase 3**.
Phase 1 computes no per-person figure, so it would be an index on a query that
does not exist.

#### `SquareLaborSyncState`

```prisma
/// Per-store sync provenance. SEPARATE FROM SquareTimecard.syncedAt ON PURPOSE
/// — see docs/ADVANCED_LABOR.md § 3. A store that synced successfully and holds
/// zero timecards has no row in SquareTimecard to stamp, and that is exactly the
/// case seam (c) forbids rendering as "0 hours". This table is what lets
/// "not synced" and "synced, nobody worked" be different sentences.
model SquareLaborSyncState {
  id             String    @id @default(cuid())
  organizationId String
  storeId        String    @unique
  lastSyncStartedAt DateTime?
  lastSyncOkAt      DateTime?
  lastWindowStart   DateTime? @db.Date
  lastWindowEnd     DateTime? @db.Date
  lastTimecardCount Int       @default(0)
  lastError         String?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id])
  store        Store        @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@index([organizationId])
}
```

#### Storage growth estimate (AL-1 hard rule 7)

Neon's Free plan is **0.5 GB per project**, 10 branches, and *child* branches
are billed on the minimum of their accumulated delta or their logical size —
so staging and dev, both forked from production, pay for divergence only
(neon.com/docs/introduction/plans, read 2026-08-18). The handoff of 2026-08-17
put the project at **~82%**, i.e. roughly **90 MB of headroom**.

Measured against real tables on the **local dev database** — the endpoint
`ep-late-water-a6k53nv2` that `DATABASE_URL` points at, read 2026-08-18 — which
is where the per-row constants below come from rather than from arithmetic:

| Table | Rows | Total bytes | Bytes/row |
|---|---|---|---|
| `SalesPeriodCache` | 2,440 | 1,302,528 | **534** |
| `SalesHourlyCache` | 31,894 | 12,648,448 | **397** |
| `SalesLineCache` | 254,087 | 115,990,528 | **456** |

Dev database total: **138.8 MB**.

`SquareTimecard` is a wider row than any of these (six string columns plus
three `Decimal`s), and carries three indexes. **~600 bytes/row all-in** is the
working figure.

Volume, at the nine-store production estate: DEBT-10 measured **138 team
members** in the production Square payload, ≈15 per store. At ~4.5 worked
shifts per person per week that is **~9.6 timecards per store per day**, or
**~86 rows/day** across nine stores — which lands between the two sales caches
already in the database and close to `SalesHourlyCache`'s rate.

| Horizon | Rows | Bytes |
|---|---|---|
| Per day | ~86 | ~52 KB |
| Per month | ~2,600 | ~1.5 MB |
| **Per year** | **~31,400** | **~19 MB** |

**Verdict: not material, and not the binding constraint.** ~19 MB/year on the
production root is ~3.8% of the Free allowance annually. Staging syncs the same
real Square account (staging's Square app is separate, the merchant account is
not), so a fully-synced staging branch adds a similar delta; three branches at
full rate is a **~50 MB/year ceiling** against ~90 MB of headroom — real, but a
year of runway, and Phase 1's default sync window is a trailing few days rather
than a full-history backfill.

**What is actually consuming the headroom is `SalesLineCache`**: 116 MB, **84%
of the entire dev database**, at 254,087 rows over 590 days ≈ **72 MB/year**.
It is nearly four times `SquareTimecard`'s projected rate and it is already
running. Surfaced, not acted on — a Neon plan decision and a `SalesLineCache`
retention policy are both Gary's, and neither is AL-1's to make.

### 3. Sync design

**Poll, not webhook** — mandated by AL-1 scope B, and independently the right
call for a reason LABOR-0B measured: `src/app/api/webhooks/square/route.ts:71-73`
returns HTTP 200 with **no log line** for any event type outside the four it
handles, and Square does not retry a 200. A `labor.timecard.*` subscription
added before the handler learns the type is silently swallowed with no trace.
DEBT-69's measured ~55 discarded syncs per 2.5 hours is the second argument:
webhook-driven syncs multiply, and this one has no correctness need to.

**Module**: `src/lib/labor-actuals.ts`, per seam (b)'s naming. Nothing in
`labor-budget.ts`, `labor-plan.ts`, `labor-coverage.ts` or `labor-forecast.ts`
imports it, in either direction.

**Read path**: `getSquareClient(org)` only. The personal-token fallback helpers
(`fetchSquareTeamMembers` and siblings) are forbidden here — a sync that
silently ran on `SQUARE_ACCESS_TOKEN` would repeat the exact defect SQ-WB-1
removed, and would prove nothing about the merchant's grant.

**Endpoint**: `POST /v2/labor/timecards/search`, `limit` 200 (Square's max),
cursor-paginated to exhaustion. Stores processed **serially**, matching
`sales-reconcile`'s stated reason: Square publishes no rate limits, so we stay
polite.

**Date-window strategy — `workday`, not `start`.** The filter is:

```json
{ "query": { "filter": {
    "location_ids": ["<square location id>"],
    "workday": {
      "date_range": { "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD" },
      "match_timecards_by": "START_AT",
      "default_timezone": "<Store.timezone>"
    } } },
  "limit": 200 }
```

`start` is an absolute-instant range and would slice a store-local business day
at the wrong boundary for any store outside the server's zone. `workday` is
what an operator means by "Tuesday", and it is the same thing
`sales-reconcile` already does with `localDateStr(new Date(), store.timezone)`.
Using two different notions of "a day" for the numerator and the denominator of
one percentage is a defect waiting for a multi-timezone org.

**Upsert key**: `(organizationId, squareTimecardId)`.

**Idempotency — the guard is Square's `version`, not our clock.** BUG-7's
lesson applies directly: the fix is a single `INSERT … ON CONFLICT … DO UPDATE
… WHERE`, never check-then-act, so two concurrent writers take the row lock and
the second re-evaluates against the committed value with no window to insert
into. The difference from `sales-sync.ts` is the guard column:

```sql
ON CONFLICT ("organizationId", "squareTimecardId") DO UPDATE SET
  … ,
  "syncedAt" = EXCLUDED."syncedAt"
WHERE "SquareTimecard"."squareVersion" <= EXCLUDED."squareVersion"
```

`sales-sync` guards on `syncedAt` (the instant *we* read Square) because
Square's orders carry no version we can trust for this. Timecards do:
`version` is incremented by Square on every update, so a slow sync that read
version 3 cannot clobber a fast sync that read version 4 **regardless of commit
order** — the ordering is the source's, not ours. `<=` rather than `<` is
deliberate: an equal version means identical content, and letting the write
through refreshes `syncedAt` instead of leaving a row looking older than the
sync that confirmed it.

Rows are sorted by `squareTimecardId` before the multi-row `INSERT` so every
writer takes its locks in the same order — `sales-sync.ts:154-157`'s deadlock
argument, unchanged.

**Re-running a window is safe by construction.** The window is a filter, not a
delete: no `deleteMany` precedes the insert, so a re-run with a wider or
narrower window can only add or refresh rows. A timecard *deleted* in Square
therefore persists in Froot as a stale row — recorded here as a **known limit**
of Phase 1, not a silent one; a reconciliation pass belongs to a later phase
and needs Gary's call on whether a deleted timecard should vanish or be
tombstoned.

**Health / staleness — and why it needs its own table.** Seam (c) forbids
rendering absent data as `0`: *"absent data reads 'not synced', which is a
different sentence from '0 hours'."* Row-level `syncedAt` cannot express that
sentence. A store that synced perfectly and had nobody clocked in has **no
rows** — so `max(syncedAt)` over an empty set is null, indistinguishable from
"never synced", and a store whose timecards simply have not been edited would
read stale even though the sync ran minutes ago. `SquareLaborSyncState`
records the *attempt*, which is the fact the badge is about:

| `health` | Condition |
|---|---|
| `never` | No `SquareLaborSyncState` row for the store. Renders "not synced". |
| `error` | `lastError` set and `lastSyncOkAt` older than the staleness threshold. |
| `stale` | `lastSyncOkAt` older than the staleness threshold. |
| `fresh` | Otherwise. |

Proposed threshold: **90 minutes** for an hourly cadence, or 26 hours for a
daily one — one interval plus a margin, so a single missed run does not cry
wolf. Q7 asks Gary to pick the cadence; the threshold follows from it.

**A sync failure never throws into a labor surface.** It writes `lastError` and
returns; existing rows are untouched and read as stale. This is seam (c)'s ON
BUT UNHEALTHY and DON'T #5 — the integration error is caught at its own
boundary, logged with the real cause, and never dressed as a 401.

**Cadence recommendation.**

- **On demand**: `POST /api/square/labor/sync` (ADMIN, store + range). This is
  what Gary triggers in the after-session steps.
- **Cron**: a new `GET /api/cron/labor-timecards` on the `sales-reconcile`
  pattern (`CRON_SECRET` bearer check, `maxDuration = 300`, serial stores,
  per-store outcome log), re-pulling a trailing **3 days** — the same
  `RECONCILE_DAYS = 3` sales uses, deliberately the same number so the two
  never disagree about how far back "recent" reaches.
- **Phase 1 writes the route but does NOT register it in `vercel.json`.** AL-1
  says "cron-ready", and adding the entry would activate the schedule on
  staging *and* production at the next deploy — and "cron schedule activation
  on production" is explicitly named as not this session's decision. Offsetting
  it (`30 11 * * *`, half an hour after `sales-reconcile`) is the suggested
  entry when Gary activates it.
- **Manager corrections can land later than three days.** Recorded as a known
  limit; a weekly deeper sweep is the obvious answer and is not built here.

### 4. Labor % calculation

A **pure function** in `labor-actuals.ts` — no DB, unit-testable by a
`scripts/verify-labor-actuals.ts` in the shape of `verify-labor-budget.ts`.
Dollars in and out, **integer cents internally**, per `docs/LABOR.md` § Money
convention.

```ts
computeLaborActuals({ timecards, netSales, now, staleAfterMinutes, syncState })
  → {
      laborPct: number | null
      laborCost: number          // dollars
      laborHours: number
      sales: number              // dollars
      health: "fresh" | "stale" | "error" | "never"
      timecardCount: number
      openTimecardCount: number
      wageMissingCount: number
      costComplete: boolean
      otApplied: false
      lastSyncOkAt: string | null
    }
```

Per timecard:

```
effectiveEnd  = endAt ?? min(now, windowEnd)      // OPEN cards, for item 1's "real-time"
grossMinutes  = effectiveEnd − startAt
paidMinutes   = grossMinutes − breakUnpaidMinutes  // paid breaks stay in; unpaid come out
hours         = paidMinutes / 60
costCents     = round(hours × wageHourlyRateCents)
```

Then:

```
laborCost = Σ costCents  → dollars
sales     = Σ SalesPeriodCache.netSales over (storeId, date range)
laborPct  = sales > 0 ? (laborCost / sales) × 100 : null
```

**`laborPct` is `null`, never `0`, when sales are zero.** Cost with no sales is
"no sales yet", which is a different sentence from "0% labor" — seam (c)'s rule
applied to the numerator's own denominator.

**Two honesty flags, both required, both consequences of the seam's wage rule.**

- `wageMissingCount` — timecards whose `wageHourlyRate` is null because Square
  has no wage configured for that team member. `costComplete` is
  `wageMissingCount === 0`. **When it is false, `laborCost` is a floor, not a
  total**, and every surface must say so. The seam names the affordance to
  reuse: the `staff/[id]` "No store assigned" warning.
- `openTimecardCount` — people currently on the clock, whose cost is projected
  to `now` and will grow. A number that moves needs to be labelled as one.

**`otApplied: false` is returned as a field, not assumed.** Phase 1 computes
**straight time only**, so wherever overtime occurred `laborCost` is an
understatement. Returning the flag means a Phase 2 card cannot render the
number as if OT were handled; it also means the day OT lands, nothing needs to
guess whether an old response included it.

**The boundary test** (seam (b), and it is a real test, not a note): drop
`SquareTimecard` and `SquareLaborSyncState` and every existing labor surface
must render byte-identically. Phase 1 passes by construction — `labor-actuals.ts`
is imported by exactly one route and by nothing in the core engines — and the
test is run before the Phase B commit rather than asserted.

### 5. The read surface (verification only)

`GET /api/square/labor/actuals?storeId=…&start=…&end=…`

- Behind `requireSquareLabor()` → 404 when either Square-labor gate is off.
- **ADMIN-gated on `can(actor, "square.manage")`**, the same capability and the
  same reasoning as `labor/verify`: `stores.manage` is in
  `ENFORCED_CAPABILITIES` and is deniable per-user, so an unrelated store
  override could 403 this route for a reason that has nothing to do with
  Square. `square.manage` is `ADMIN_ONLY` and not deniable, so its 403 means
  exactly one thing.
- **Aggregates only. No per-person payload exists in the response at all** —
  no `squareTeamMemberId`, no names, no per-person hours, no per-person wage.
  This is the strongest available answer to hard rule 3 and to DEBT-10: a
  STORE account cannot receive per-person data from a route that never
  assembles any. The per-person surfaces are Phase 3's, and they arrive with
  `labor.costs.view` (§ Open questions Q5).
- Returns the `computeLaborActuals` object above, verbatim and documented.
- No dashboard card, no nav entry, no page. Phase 1's only human-facing
  addition is the toggle.

---

## Open questions — ALL RULED at the AL-1 hard stop, 2026-08-18

The leans are preserved as written so the reasoning that produced each ruling
stays readable; Gary's answer is marked **RULED** on each.

**Q1 — The toggle column's name.** AL-1 § Phase 1 scope A says
`advancedLaborEnabled`. The seam says `squareLaborEnabled`, and that name is
already written into `DECISIONS.md:149`, `ROADMAP.yaml:7068, 7190, 7496, 7507`
(including L-4's row, which inherits it) and `docs/prompts/L-2_square_labor_seam.md:59`.
A third name for one column is how a codebase acquires two.
**RULED `squareLaborEnabled`** (Gary, 2026-08-18) — the existing citations are load-bearing
and the feature *is* the Square data source — "Advanced Labor" is the product
name the operator sees, which is a label, not a column.

**Q2 — Where the toggle control lives.** AL-1 says `/settings/labor` (or
`/labor`); the seam says *inside the existing Square Integration card on
`/settings`*, the way `InstagramActions` sits inside the Instagram card.
Vision item 8, though, says "/labor page: 'Advanced Labor' option".
**RULED: the seam's placement** (Gary, 2026-08-18) — Square card now, `/labor` indication in Phase 2. Both, and they are not in conflict — the ADMIN flip lives in the
Square Integration card per the seam (it is a Square connection setting), and
`/labor` gains a read-only "Advanced Labor: On/Off" indication in Phase 2 when
there is something for it to gate. Phase 1 builds only the seam's control.

**Q3 — Two tables instead of one.** AL-1 hard rule 1 says "new table + new
column", singular. This design proposes `SquareTimecard` **and**
`SquareLaborSyncState`. The argument is in § 3: without the second table,
"synced and nobody worked" is indistinguishable from "never synced", which is
the precise thing seam (c) forbids. **RULED: approved, both tables** (Gary, 2026-08-18). The
alternative — deriving health from `max(SquareTimecard.syncedAt)` — is the
zero-as-a-measurement defect with extra steps.

**Q4 — The denominator: net or gross sales.** `SalesPeriodCache` carries both.
Net (gross − tax − tips) is the industry-standard labor denominator and the one
that makes the number comparable between stores with different tax rates.
Item 1 puts labor % beside *gross* sales on the card, which is a display
adjacency, not a formula. Complication worth flagging now rather than at
Phase 2: the forecast side's `SalesForecast.projectedStoreSales` is a
hand-entered figure whose gross/net meaning is **not defined anywhere**, so
actual-vs-budget will compare two things that may not be the same thing.
**RULED: net sales** (Gary, 2026-08-18), and settle the forecast side's meaning before
Phase 2 renders them side by side.

**Q5 — Overtime.** The original L-2 title said "Nevada OT warning", so the
target rule set is Nevada's, which has a daily component as well as the federal
weekly one. Phase 1 computes straight time and returns `otApplied: false`.
**RULED: deferred, and labelled** (Gary, 2026-08-18). A silent approximation of OT is worse than a
labelled absence of it — an understated labor % that looks precise will be
acted on. OT deserves its own phase, its own ruling on the rule set, and its
own verification fixture.

**Q6 — Salaried allocation and tips in labor cost.** Two halves:
- *Salaried*: Square's `hourly_rate` is already "the calculated effective
  hourly wage" for salaried staff, so a salaried GM **who clocks in** is
  costed correctly with no extra work. One who **never clocks in** contributes
  zero, understating labor %. That is L-2's second unruled open question
  ("whether owner/admin accounts who never clock in should appear in labor
  surfaces") arriving in a new place. **RULED as leaned** (Gary, 2026-08-18) — Square's effective rate
  as-is, no salaried allocation, gap surfaced. **What Phase B actually
  surfaces is the WAGE gap** — `wageMissingCount` / `costComplete`, for people
  who did clock in but whom Square carries no rate for. **The never-clocks-in
  gap is NOT measured in Phase 1** and is recorded here as a known limit: it
  needs a Square team-member read to establish the denominator, which is
  Phase 3's roster work (item 10).
- *Tips*: declared cash tips are employee income, not employer labor cost, and
  card tips pass through. **RULED: tips are NOT in `laborCost`** (Gary, 2026-08-18). Item 5 asks
  for tips as their own column, which is the same answer.

**Q7 — Cron cadence, and whether Phase 1 registers it.** Options: hourly during
business hours (fresh enough for item 1's "real-time" once Phase 2 exists),
or nightly at 3 days trailing (cheap, matches sales). The staleness threshold
follows from the answer. **RULED: build the route, register no cron** (Gary, 2026-08-18), and pick the schedule when Phase 2 gives the number
a surface that has to be fresh.

**Q8 — Neon storage.** § 2 puts `SquareTimecard` at ~19 MB/year against ~90 MB
of headroom, and puts `SalesLineCache` at 116 MB today growing ~72 MB/year.
**RULED: agreed** (Gary, 2026-08-18) — `SalesLineCache` growth is filed as its own DEBT row citing this measurement; not this phase's problem. Nothing here needs a decision to proceed with Phase 1.

---

## Corrections applied — all three approved by Gary, 2026-08-18

Not rulings — house rules that the AL-1 prompt states differently, recorded so
the deviation is visible rather than quiet.

1. **The migration procedure.** AL-1 § B1 says `npx prisma migrate dev` against
   staging. `CLAUDE.md` § Database says `migrate dev` is **broken** (the
   baseline squash was never done; shadow-DB replay fails P3018) and that
   staging and production apply migrations via `prisma migrate deploy` in the
   Vercel build — *"never run migrations against those branches by hand"*.
   Phase B will follow the house flow: `migrate diff` against the local dev DB
   → review the SQL → `db execute` → `migrate resolve --applied` → `generate`,
   with the migration folder committed alongside the code.
2. **`labor.costs.view` does not exist yet.** AL-1 hard rule 3 requires wage
   surfaces to ride it; `grep` finds it only in a comment in
   `labor/verify/route.ts`. It is PERM-4 (c)'s to introduce. Phase 1 needs no
   workaround because its one route exposes no per-person pay at all; the
   capability arrives with the Phase 3 surfaces that actually need it.
3. **`staging` is two commits behind `main`** (`90a8eca` promote, `27ae79a`
   deploy log) and is a strict ancestor, so the catch-up is a fast-forward.
   Phase B should take it before committing, so the build does not sit on a
   branch missing its own promotion record.

---

## Rider carried by Phase B

`src/lib/permissions.ts:190` still reads *"Nothing calls
can(_, "square.manage")"*. `src/app/api/square/labor/verify/route.ts:39`
has called it since `b846e32`. One-line correction, authorized by Gary, landing
in Phase B's work commit.

---

## What Phase 1 does not touch

Named explicitly, because a build session reads silence as permission:

- No dashboard card, no `/staff` surface, no Positions change (items 1–7, 10).
- No change to Budget settings, the weekly→daily split, or Shift blocks
  (items 9, 11, 12).
- No webhook subscription change and no new webhook event type.
- No write to Square, of any kind, ever. `getSquareClient(org)` only.
- No core labor engine gains a Square-sourced input. `labor-budget.ts`,
  `labor-plan.ts`, `labor-coverage.ts` and `labor-forecast.ts` are not edited.
