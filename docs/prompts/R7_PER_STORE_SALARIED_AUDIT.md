# R7 — per-store salaried archetypes · AUDIT AND PLAN

**Session:** TIER 3, 2026-08-22. **Audit and plan only. NOTHING WAS BUILT** —
no file outside `docs/` was touched, no schema was edited, no migration written.
**Ruling this answers:** `docs/DECISIONS.md` § "Salaried archetypes are a property
of the store, not of the organization — R7 ruled — 2026-08-22 (Gary)", ratified
in commit `9baaa55`.
**Branch/commit of the code read:** `staging` at `7ab8525` (fast-forwarded to
main at the start of the session, which is the level Gary's prompt asserted),
working tree clean; the ratification `9baaa55` sits on top of it and touches
`docs/DECISIONS.md` only.
**Deviations proposed:** S5-D18 onward, per instruction.

---

## 0 · The one-paragraph answer

The ruling is buildable, additively, without touching a core engine's
arithmetic — **but not in the shape its own sentence describes.**
`LaborPosition` is not the salaried table; it is the whole rate table, and the
weekly budget's **blended hourly rate is the unweighted mean of its active
HOURLY rows** (`src/lib/labor-budget.ts:88-91`). Give the *whole table* a
per-store dimension and every store's HOURLY hours move, not just its salaried
line. Give the *salaried declaration* a per-store dimension — a narrow layer
that carries hours and no rate — and the ruling lands exactly as worded, the
blast radius is one branch of one pure function, and the day-one invariant is
guaranteed by the layer being empty rather than by a test being green. That is
the lean in §5. Two things the ruling does not close are recorded plainly in §3
and §8: `WEEKLY_GM_CAP_HOURS` is only half-resolved, and Kristie Connolly's
split stays two unlinked numbers.

---

## 1 · BLAST RADIUS — what `LaborPosition` supplies besides salaried hours

### 1.1 The sharp question, answered first

**YES. The blended hourly rate derives from these rows.**

```
src/lib/labor-budget.ts:88   const hourlyRates = active.filter(p => p.payType === "HOURLY")
                                                       .map(p => toCents(p.defaultHourlyRate))
src/lib/labor-budget.ts:89-92  blendedHourlyRateCents = mean(hourlyRates)      ← UNWEIGHTED
src/lib/labor-budget.ts:96-97  hourlyHours = floor((hourlyDollars / blendedRate) * 2) / 2
```

The mean is over the **set of rows**, not over people. Change which rows are in
scope for a store and that store's blended rate changes; change the blended rate
and `hourlyHours` — the entire pool the daily split distributes — changes with
it. On the seeded legend the mean is `(18 + 15 + 13 + 12) / 4 = $14.50`, which is
the figure `labor-settings-client.tsx:397-402` already records as measured.

**Nothing shields the estate from this.** `LaborSettings.plannedBlendedRate`
(`labor-budget.ts:85-86`) would override the computed mean, and — measured below
in §4 — there are **zero `LaborSettings` rows of either kind** on the dev branch.
The computed mean is live at all nine stores.

**Therefore: making the table per-store OUTRIGHT changes rate math, not just
hours math, and it is a materially larger change than Gary ruled on.** The
question's premise is correct. This finding is the single most important input to
§5 and is why the lean there is the narrow layer.

### 1.2 Every consumer of `LaborPosition`

| # | Site | Kind | Fields read |
|---|---|---|---|
| 1 | `src/lib/labor-plan.ts:161` | **the only arithmetic consumer** | `payType`, `defaultHourlyRate`, `impliedWeeklyHours`, `active`, `isSupervisory` |
| 2 | `src/app/api/labor/positions/route.ts:37` (GET) | read → settings card | all |
| 3 | `src/app/api/labor/positions/route.ts:51` (POST) | write | all |
| 4 | `src/app/api/labor/positions/[id]/route.ts:23,39` (PATCH) | read + write | all |
| 5 | `src/app/api/labor/positions/[id]/route.ts:23,51` (DELETE) | read + **hard delete** | all |
| 6 | `src/app/(app)/settings/labor/page.tsx:66` | server read → initial render | all |
| 7 | `src/lib/labor-positions.ts:20` | `count()` for the idempotent seed | none |
| 8 | `src/lib/labor-positions.ts:22` / `src/app/api/labor/toggle/route.ts:47` | seed on module enable | writes all |

There is no ninth. `src/generated/roadmap.ts` mentions the name in prose only.
`labor-judgment.ts` and `labor-actuals.ts` name `computeWeeklyLaborBudget` in
**comments** and consume nothing.

### 1.3 Every field, and exactly what it decides

| Field | Reaches | Consequence |
|---|---|---|
| `payType` | `labor-budget.ts:74` (salaried branch), `:88` (blended-rate filter), `labor-plan.ts:179` (`hasGm`), `:180` (`hasHourlySupervisor`) | **four separate decisions** |
| `defaultHourlyRate` | `labor-budget.ts:75` (`salariedCost`, **money**) **and** `:88-91` (`blendedHourlyRate`, **money**) | the field that makes the table a rate table |
| `impliedWeeklyHours` | `labor-budget.ts:75` (`salariedCost`) **and** `:76` (`salariedHours`) | see §2 — it is **not** hours-only |
| `isSupervisory` | `labor-plan.ts:180` → `computeDayCoverage` → `labor-coverage.ts` supervisor rule | coverage shape |
| `active` | filtered at `labor-plan.ts:161` (query) **and again** at `labor-budget.ts:70` | belt and braces, already |
| `name`, `sortOrder` | settings card only | display |
| `organizationId` | scoping on every read | the dimension the ruling changes |

### 1.4 The engine consumer set, complete

`computeWeeklyLaborBudget` has **one production call site**
(`src/lib/labor-plan.ts:173`) plus the fixture `scripts/verify-labor-budget.ts`.
`getWeeklyDayPlan` has **exactly four**:

| Route | File |
|---|---|
| `/api/labor/weekly-plan` | `src/app/api/labor/weekly-plan/route.ts:~70` |
| `/api/labor/budget` | `src/app/api/labor/budget/route.ts:31` |
| `/api/labor/coverage` | `src/app/api/labor/coverage/route.ts:55` |
| `/api/labor/day-hours` | `src/app/api/labor/day-hours/route.ts:54` |

`/api/labor/day-split` derives weights only and calls neither. **Any per-store
resolution added inside `getWeeklyDayPlan` is inherited by all four for free** —
which is the reason the plan puts it there and nowhere else.

---

## 2 · Does `impliedWeeklyHours` feed anything other than `budget.salariedHours`?

**No — and yes. It feeds exactly one other thing, and that thing is money.**

```
src/lib/labor-budget.ts:74-77
  if (p.payType === "SALARIED" && p.impliedWeeklyHours && p.impliedWeeklyHours > 0) {
    salariedCostCents += toCents(p.defaultHourlyRate) * p.impliedWeeklyHours   ← DOLLARS
    salariedHours     += p.impliedWeeklyHours                                  ← HOURS
```

Two outputs, one loop. `salariedHours` is the hours line everyone talks about.
`salariedCost` is the one that matters more:

```
labor-budget.ts:81   hourlyDollarsCents = max(0, totalLaborBudget − salariedCost)
labor-budget.ts:97   hourlyHours        = floor((hourlyDollars / blendedRate) * 2) / 2
labor-budget.ts:115  floorExceedsBudget = salariedCost > totalLaborBudget
weekly-plan/route.ts:93   salariedShare  = salariedCost × (day forecast ÷ week forecast)
weekly-plan/route.ts:94   dayLaborCost   = d.hourlyHours × blendedRate + salariedShare
weekly-plan/route.ts:95   projectedLaborPct = dayLaborCost ÷ forecastSales × 100
```

**So `impliedWeeklyHours` is the subtrahend that sizes the hourly pool.** A store
declaring 0 salaried hours does not merely lose 40 from `Schedulable`; it gets
`salariedCost = $0`, so `hourlyDollars` rises by the full salaried cost and its
**hourly hours go UP**, and every day's `projectedLaborPct` recomposes because
`salariedShare` is now zero. That is correct behaviour under the ruling — "a
store with no GM is charged nothing" is a statement about dollars — but it must
be stated out loud, because "declare zero" reads like a subtraction and is
actually a redistribution.

The remaining 20 touch points of the field (§1.2 sites 2–6, plus the settings
card at `labor-settings-client.tsx:47,376,492,1151,1175` and the two Zod schemas)
are CRUD, validation and display. No third arithmetic consumer exists.

---

## 3 · `WEEKLY_GM_CAP_HOURS = 40` — dead, guard, or real?

**Real, and B makes it DERIVED rather than hardcoded. It resolves ONE of
S5-D10's two divergence cases and leaves the other open. D10 is narrowed, not
closed — and it cannot be closed here.**

### 3.1 What the constant actually does today

It is not a second copy of `salariedHours`. It is a **ceiling on how much of the
open-hours floor the GM is allowed to absorb** before hourly hours must cover it:

```
labor-plan.ts:29    const WEEKLY_GM_CAP_HOURS = 40
labor-plan.ts:218   gmCreditByDay = capGmFloorCredits(gmHoursByDay, WEEKLY_GM_CAP_HOURS)
labor-plan.ts:219   floorByDay    = openHours − gmCreditByDay
labor-daily.ts:52-57  scales proportionally when the week's raw GM hours exceed the cap;
                      RETURNS THE HOURS UNCHANGED when they are at or below it
```

`budget.salariedHours` is a **budget input** (hours and dollars).
`WEEKLY_GM_CAP_HOURS` is a **coverage-credit ceiling**. Different jobs. They
coincide at 40 by accident of the seed, which is precisely S5-D10's complaint.

### 3.2 What B does to it

Under B each store declares its own salaried hours, so the ceiling should be that
store's declaration, not a module constant:

```
capGmFloorCredits(gmHoursByDay, resolvedSalariedHoursForThisStore)
```

Three properties, and they are why this is the right resolution rather than a
convenient one:

1. **It is a NO-OP on today's data, provably.** Measured in §4: every store
   resolves to `salariedHours = 40`, and the constant is 40. Substituting one for
   the other changes no number at any of the nine stores.
2. **It fixes the case D10 named first.** An admin who sets the GM's implied
   weekly hours to 45 today gets `salariedHours = 45` against a cap of 40, so
   `Σ gmCreditHours ≤ 40 < 45` and `Σ day cards ≠ Schedulable`. Under the
   substitution the ceiling is 45 and the identity holds.
3. **A store declaring 0 needs no special case.** `hasGm` goes false, the GM
   window is never built (`labor-plan.ts:206`), `gmHoursByDay` is all zeros, and
   `capGmFloorCredits` returns zeros whatever the ceiling is (`labor-daily.ts:53`,
   `total <= 0`).

### 3.3 What it does NOT fix, stated plainly

D10's **second** divergence case survives untouched: a **short-hours store whose
GM window ∩ open sums to UNDER the ceiling for the week**. `capGmFloorCredits`
returns the hours unchanged below the cap (`labor-daily.ts:54`), so
`Σ gmCreditHours < salariedHours` and `Σ day cards ≠ Schedulable` again — the
same defect, quieter, at a different store. **No choice of ceiling fixes this**,
because it is not a ceiling problem: it is that the GM's *credited floor
coverage* and the GM's *budgeted hours* are two different quantities that the
identity assumes are equal. Closing it means either scaling credits UP to meet
the declaration (asserting floor coverage the GM does not provide — wrong) or
accepting that the identity is conditional and saying so on screen. **That is a
ruling, not an implementation detail, and it is not answered by B.**

So: the constant is **not dead**, it **becomes a per-store guard**, and it
**still caps something real**. See **S5-D19**.

---

## 4 · Current data

**Branch: `dev` (`ep-late-water-a6k53nv2`, Neon branch `br-broad-wave-a6vpjdw0`)**,
read 2026-08-22 via a temporary `npx tsx` script against `DATABASE_URL` from the
local `.env`. The script was deleted after the read; the working tree is clean.
No deployed-environment credential was pulled, written to disk, or used
(CLAUDE.md § Environment Variables).

```
dev  ORG Keva Juice (cf888f2d-f234-48c7-8097-fd5b44b5b3dd)  modules=["inventory","labor","hr"]  activeStores=9  positions=5
dev     [0] General Manager          | SALARIED | rate=$20 | impliedWeeklyHours=40   | sup=true  | active=true
dev     [1] Assistant Store Manager  | HOURLY   | rate=$18 | impliedWeeklyHours=null | sup=true  | active=true
dev     [2] Lead Supervisor          | HOURLY   | rate=$15 | impliedWeeklyHours=null | sup=true  | active=true
dev     [3] Supervisor               | HOURLY   | rate=$13 | impliedWeeklyHours=null | sup=true  | active=true
dev     [4] Team Member              | HOURLY   | rate=$12 | impliedWeeklyHours=null | sup=false | active=true
dev  ORG Keva Juice (cmqvpe2bf000004l1gwxafqk4)  modules=["hr","labor"]  activeStores=0  positions=5   ← fossil org, same five seeded rows
dev  ORG Keva Smoothie Company (cmr595zt9…)      modules=[]              activeStores=0  positions=0
dev  ORG Microsoft (cmr431pps…)                  modules=[]              activeStores=0  positions=0   ← HR test org
dev  LaborPosition rows total: 10   SALARIED total: 2   SALARIED+active: 2
dev  LaborSettings rows (storeId not null): 0    LaborSettings rows (org default): 0
dev  LaborDaypart org-default rows: 6            LaborDaypart per-store rows: 0
dev  SalesForecast rows: 0
dev  Stores on cf888f2d… — all 9 ACTIVE, all Square-linked:
dev     Carson · Las Brisas · Meadowood Mall · South Reno · Southgate ·
dev     Spanish Springs · Sparks · UNR · University Village
```

**What this says.**

- **Five rows on the live org, exactly one SALARIED**: `General Manager`,
  `$20.00/hr`, `impliedWeeklyHours = 40`. **All five are the untouched seed
  defaults** (`src/lib/labor-positions.ts:9-13`) — nobody has ever edited the
  legend. Gary's nine stores share one legend, and that legend is the factory
  setting.
- **Nine stores × one row = 40 salaried hours charged nine times, from a row that
  names nobody.** `9 × 40 = 360` salaried hours and `9 × $800 = $7,200/wk` of
  salaried cost across the estate, asserted by a single seeded row.
- **`LaborSettings` is completely empty.** Every store resolves
  `source: "default"` (`labor-settings.ts:32`) — target 20%, rounding $1,000,
  `FLOOR_FIRST`, no GM window, **and no `plannedBlendedRate`**, which is what
  leaves the computed mean of §1.1 live everywhere. The existing org-default/
  per-store override precedent is **entirely unexercised in data**.
- **`LaborDaypart` shows the same pattern**: 6 org-default rows, 0 per-store.

### 4.1 The limit on this measurement, and how to close it

This is the **dev** branch, forked from production and diverged since. It is
strong evidence about the SHAPE (five seeded rows, one salaried, nothing edited,
overrides unused) and it is **not** authority on what staging or production hold
today. If Gary wants the estate figure confirmed before a build, this is the read,
in the **Neon console** on `preview/staging` (`ep-odd-rain-a6gr4xmm`) and on
`production` (`ep-green-smoke-a6xthq4r`) — no credential leaves the console:

```sql
SELECT o.name AS org, p.name, p."payType", p."defaultHourlyRate",
       p."impliedWeeklyHours", p."isSupervisory", p.active
FROM "LaborPosition" p
JOIN "Organization" o ON o.id = p."organizationId"
ORDER BY o.name, p."sortOrder";

SELECT count(*) FILTER (WHERE "storeId" IS NULL)     AS org_default_rows,
       count(*) FILTER (WHERE "storeId" IS NOT NULL) AS per_store_rows
FROM "LaborSettings";
```

**The plan does not depend on the answer.** Every store resolving to the same
seeded 40 is the case the invariant must protect, and any *other* answer only
adds rows the same resolution rule already covers.

---

## 5 · Schema shape — proposal, with a lean

### 5.1 Option (a) — `LaborPosition` gains a REQUIRED `storeId`

**REJECTED, and it is rejected on the additive-only law rather than on taste.**

Three independent failures, any one of which is disqualifying:

1. **It is not additive.** `ALTER TABLE "LaborPosition" ADD COLUMN "storeId" TEXT
   NOT NULL` fails outright against a non-empty table, and there is no sensible
   `DEFAULT` — there is no default store. Making it work needs a backfill that
   **fans 5 org rows into 45** (9 stores × 5) and then retires the originals,
   which is a delete in everything but name. Additive-only is a rule that does
   not tier down (CLAUDE.md § What does NOT tier down).
2. **It drags the rate into the per-store dimension.** §1.1: the blended rate is
   the mean over the rows in scope. Per-store rows outright means per-store
   blended rates, which is rate math the ruling did not ask to change.
3. **It multiplies the maintenance surface by nine** for a legend nobody has ever
   edited (§4). Correcting Team Member's rate becomes nine edits, and a legend
   that drifts between stores by neglect is a worse model than one shared legend.

### 5.2 Option (b) — org-wide rows stay the default, plus a per-store layer

**This is the deliverable option. It has two shapes and they are not equivalent.**

#### (b1) — `LaborPosition` gains `storeId String?` (null = org default)

Mirrors `LaborSettings` (`schema.prisma:2272`) and `LaborDaypart` (`:2350`)
exactly. Additive: one nullable column; existing rows become `NULL` = org
default = today's behaviour; the migration touches **zero rows**.

**But it inherits §1.1 whole.** A resolution rule has to say what a store's own
rows do to the *set*, and every answer is bad:

- **Row-wins** (the `LaborSettings` pattern, `labor-settings.ts:24`): one
  per-store row **replaces the entire legend** for that store, so the blended
  rate becomes that single row's rate. Catastrophic, and silent.
- **Union**: a store's rows are added to the org set, so declaring a GM's hours
  changes the store's blended *mean*. Wrong for a different reason and just as
  silent.
- **Salaried-only resolution** — resolve per-store for the salaried branch,
  read `storeId IS NULL` only for the blended-rate branch. Expressible, and it
  means **one table with two different scoping rules for two of its columns**,
  which is how a model rots. Named here so the option is visibly considered, not
  recommended.

**A separate, real hazard for (b1):** `DELETE /api/labor/positions/[id]`
(`route.ts:43-53`) is a **hard delete** scoped only by `organizationId`. Under
(b1) that endpoint can delete another store's declaration, and there is nothing
in its scoping to stop it.

#### (b2) — a narrow per-store salaried declaration layer ◀ **THE LEAN**

```prisma
/// R7 (Gary, 2026-08-22): salaried archetypes are a property of the STORE.
/// One row = "this store carries N weekly hours of this archetype". ABSENT
/// MEANS INHERIT the org-wide LaborPosition.impliedWeeklyHours — absence is
/// the default, so an empty table reproduces today's numbers exactly.
/// IT CARRIES NO RATE, DELIBERATELY. The blended hourly rate is the mean of
/// LaborPosition's active HOURLY rows (labor-budget.ts:88-91); a rate here
/// would put per-store rate math into the ruling, which the ruling did not ask
/// for. The cost stays defaultHourlyRate x declaredHours.
model LaborPositionStoreHours {
  id                 String   @id @default(cuid())
  organizationId     String
  storeId            String
  laborPositionId    String
  weeklyHours        Int      // 0 IS A VALUE: this store carries none of this archetype
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  organization  Organization  @relation(fields: [organizationId], references: [id])
  store         Store         @relation(fields: [storeId],        references: [id], onDelete: Cascade)
  laborPosition LaborPosition @relation(fields: [laborPositionId],references: [id], onDelete: Cascade)

  @@unique([storeId, laborPositionId])
  @@index([organizationId, storeId])
}
```

**Why this and not (b1).**

| | (b1) nullable `storeId` | (b2) narrow layer |
|---|---|---|
| Additive | yes (one nullable column) | yes (**new table, zero rows**) |
| Can move the blended rate | **yes** — resolution rule decides | **no — structurally.** No rate column exists |
| Day-one invariant | held by a resolution rule being right | held by **the table being empty** |
| Resolution rule | must answer "replace or union the set" | one lookup: declaration ?? org row |
| Delete endpoint hazard | present (see above) | absent — a different table, own route |
| Faithful to "gains a per-store dimension" | literal (a column) | structural (a dimension via a layer) |

The one honest cost: it is a **join table rather than a column**, so the ruling's
sentence is satisfied in substance rather than in letter. Recorded so Gary can
overrule it knowingly. Everything else favours it, and the decisive item is row
two — **(b2) cannot move the blended rate because it has no rate to move.**

`0 IS A VALUE, NOT AN ABSENCE` is deliberately the same law BUG-12 established
for `weeklyHoursOverride` (`labor-roster-hours.ts:21-35`). Absent = inherit the
org row. `0` = this store carries none of this archetype. `if (row.weeklyHours)`
is the bug; write `!= null` on the row lookup. **The two states must never
collapse** — that is the whole of "a store with no GM is charged nothing" versus
"nobody has said yet".

### 5.3 What the migration does to existing rows

**Nothing. Zero rows are read, written, or moved.**

```sql
-- generated, not hand-typed:
--   npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma \
--     --script -o prisma/migrations/<ts>_labor_position_store_hours/migration.sql
CREATE TABLE "LaborPositionStoreHours" ( ... );
CREATE UNIQUE INDEX ON "LaborPositionStoreHours"("storeId","laborPositionId");
CREATE INDEX        ON "LaborPositionStoreHours"("organizationId","storeId");
ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ...;
```

One `CREATE TABLE`, two indexes, three foreign keys. **No `ALTER` on
`LaborPosition`. No `UPDATE`. No backfill. No seed.** Deliberately no seed: a
seeded declaration per store would be nine rows asserting a number nobody typed,
which is exactly the failure that produced R7 in the first place. The procedure
is `docs/MIGRATIONS.md` § 3 unchanged — `migrate diff` locally against dev,
`db execute`, `migrate resolve --applied`, `generate`, commit the folder **with**
the code, and `migrate deploy` runs in the Vercel build. See **S5-D18**.

### 5.4 The resolution rule, in one function

```ts
// src/lib/labor-position-hours.ts  (new; PURE resolution over data the caller fetched)
//
// ABSENT MEANS INHERIT. A store with no declaration row for a position gets that
// position's org-wide impliedWeeklyHours — byte-identical to labor-budget.ts:74-77
// as it stands today, which is what makes an empty table a no-op.
export function resolveSalariedHours(
  position: { id: string; impliedWeeklyHours: number | null },
  declarations: Map<string, number>      // laborPositionId -> weeklyHours, THIS STORE ONLY
): number | null {
  const declared = declarations.get(position.id)
  return declared != null ? declared : position.impliedWeeklyHours   // NOT `declared || ...`
}
```

Wired in **one place** — `getWeeklyDayPlan` — so all four routes inherit it:

- `labor-plan.ts:159-167` gains a ninth read: the store's declaration rows.
- `labor-plan.ts:175` maps `impliedWeeklyHours: resolveSalariedHours(p, decls)`.
- `labor-plan.ts:179` `hasGm` becomes *resolved salaried hours > 0*, not
  *a SALARIED row exists* — otherwise a store declaring `0` still draws a GM band.
- `labor-plan.ts:218` ceiling becomes the resolved figure (§3.2).

**`labor-budget.ts` gets a ZERO DIFF.** It already receives
`impliedWeeklyHours` as a plain number per position; it never learns that the
number was resolved. `labor-coverage.ts` and `labor-daily.ts` likewise. **The
seam holds: no Square-sourced input, no person, enters any engine.**

---

## 6 · THE INVARIANT THAT GATES THIS

> On the day this promotes, every store's plan must produce exactly the number it
> produces today, until someone deliberately changes that store's declaration.

**How the design guarantees it — four independent mechanisms, not one.**

1. **The table is empty on promotion.** No seed, no backfill (§5.3). Every
   `declarations.get(id)` returns `undefined`, so `resolveSalariedHours` returns
   `position.impliedWeeklyHours` — *the same expression `labor-budget.ts:76`
   evaluates today.* The invariant is a property of the **data**, not of a code
   path being correct.
2. **The rate is structurally out of scope.** `LaborPositionStoreHours` has no
   rate column, so `blendedHourlyRate` cannot move. This is **grep-provable**,
   not argued: the new table's name appears in no expression feeding
   `labor-budget.ts:88-91`.
3. **The ceiling substitution is a measured no-op.** §4: `salariedHours = 40` at
   every store, `WEEKLY_GM_CAP_HOURS = 40`. Substituting changes nothing on
   present data — and §4 names the branch the measurement came from.
4. **Absence and zero stay distinct** (§5.2). The only way a store's number moves
   is a row someone wrote.

**The failure mode the invariant is protecting against, named:** `hasGm`. If it
were left as `positions.some(payType === "SALARIED")` while the hours resolved
per-store, a store declaring `0` would still get a GM band, still get GM floor
credits, and its hourly split would change while its salaried line read zero.
That is the one place a careless build moves a number without a declaration, and
it is why the change to `hasGm` is listed as required rather than tidy.

### 6.1 How a fixture proves it

Two fixtures, following `scripts/verify-labor-budget.ts` (pure, no DB, the
existing pattern for exactly this engine):

**`scripts/verify-labor-position-hours.ts` — the resolution rule.**
- absent declaration → org `impliedWeeklyHours` (**the invariant case**)
- declaration `0` → `0`, and **not** the org figure (the `||`-vs-`!= null` trap)
- declaration `20` → `20`
- `null` org hours + no declaration → `null` (hourly positions unaffected)
- a declaration for a **different** store's id is not visible (map is store-scoped)

**`scripts/verify-labor-budget.ts` — extended, snapshot equality.**
- **Case A, the gate.** The five seeded positions, an empty declaration map, and
  the locked acceptance forecast: assert the FULL `LaborBudgetResult`
  **field-for-field** equal to the values already locked in that fixture
  (`conservativeSales 14000`, `salariedCost`, `salariedHours`, `hourlyDollars`,
  `hourlyHours`, `totalSchedulableHours`, `projectedLaborPct`,
  `floorExceedsBudget`). Not just `salariedHours` — **every field**, because
  §1.1 is the risk and only `blendedHourlyRate` and `hourlyHours` would catch it.
- **Case B, the deliberate change.** One store declares `0`: assert
  `salariedHours = 0`, `salariedCost = 0`, and — the part worth asserting
  explicitly — `hourlyHours` **RISES** by the freed salaried dollars ÷ blended
  rate (§2). Proves the change is a redistribution, not a subtraction.
- **Case C, the share.** A declaration of `20` yields exactly half the salaried
  cost and half the hours of the inherited `40`.
- **Case D, the ceiling.** `capGmFloorCredits(gm, 40)` and
  `capGmFloorCredits(gm, resolved)` agree when `resolved === 40`; and with
  `resolved = 45` the credits scale to 45, closing §3.2's first divergence.

**What a fixture CANNOT prove, stated so nobody mistakes green for proof.** A
pure fixture proves the ENGINE is invariant. It cannot prove the deployed
estate's numbers are unchanged, because those depend on live forecast and sales
rows. The only proof of that is a **pre/post read of `/api/labor/budget` for all
nine stores at the same `weekStart`**, taken on staging before and after the
deploy — which needs the staging-SHA precondition satisfied on both reads and is
Gary's to run. See **S5-D20**.

---

## 7 · UI — how the store dimension appears

Copy is Gary's call; these are shapes, with a lean.

**Precedent that already exists on this very card:** the roster tab carries its
own store picker (`labor-settings-client.tsx:601`,
`useState(stores[0]?.id ?? "")`), and the `stores` list is already passed into
`PositionsCard` (`page.tsx:70-74,94`) **and already scoped by role** — an admin
sees all stores, a manager sees only their assignments (`page.tsx:71`). Any of
these options is wired into props that exist.

### Option 1 — a store picker on the legend tab, mirroring the roster tab
Pick a store; the salaried rows show `Inherits from organization — 40 hrs/wk`
with an override control; org-wide editing continues under an "Organization"
selection. Most consistent with what is already there. **Cost: one store at a
time, so the estate total is never on screen** — and the estate total is the
number that produced R7.

### Option 2 — a "Salaried hours by store" table ◀ **THE LEAN**
A sub-card under the legend. Rows = the stores this viewer may see; columns = the
SALARIED positions (today: exactly one). Each cell is either `Inherits · 40` or a
declared number, with a footer total.

```
Salaried hours by store                          General Manager      (archetype: 40 hrs/wk)
  Carson                                         Inherits · 40
  Las Brisas                                     20                   ← declared
  Meadowood Mall                                 Inherits · 40
  …
  UNR                                            20                   ← declared
  ─────────────────────────────────────────────────────────────────────────────────
  Estate total                                   320 hrs/wk           (9 stores)
```

**Why this one.** The defect Gary is chasing is an **estate-level** fact — one
seeded row charged nine times, `9 x 40 = 360` hours nobody typed. A picker shows
one store and therefore can never show that. A nine-row table shows it on first
load, shows which stores have been touched and which are still inheriting, and
puts the sum where a human can compare it against how many salaried people
actually exist. It also keeps the legend card **byte-unchanged**, which mirrors
the plan's structural story: archetypes live in the legend, per-store carriage
lives in the new table.

Notes it must carry (as behaviour, not as final copy):
- **`Inherits` and `0` must read differently.** `0` renders as a declared zero
  with the store's name beside it, never as a blank or a dash — the UI half of
  §5.2's law.
- **The total is advisory and must say so** (§8) — it is not checked against
  anything.
- The table renders only when at least one SALARIED position exists; with none,
  it says so rather than rendering an empty grid.

### Option 3 — per-store, on `/stores/[id]`
Right place conceptually; wrong place practically. It scatters one decision
across nine pages and makes the estate total unreachable. Recorded as considered.

See **S5-D21**.

---

## 8 · What B does NOT solve — recorded explicitly

**Kristie Connolly's split is expressible only as two independent numbers, and
nothing links them.** Las Brisas declares its share; UNR declares its own. That
is the whole of it. Specifically:

- **Nothing checks they sum to one person's week.** Las Brisas `20` + UNR `20` is
  indistinguishable, to the model, from Las Brisas `30` + UNR `30`. The second
  charges the estate 60 hours for a 40-hour person and **nothing anywhere
  notices**.
- **Nothing links them.** Change one and the other does not move, is not
  flagged, and is not shown next to it. The drift is silent and permanent.
- **There is no person in the model to check against — by design.** That is the
  ruling's own sentence: "the forecast still names nobody." The check would need
  a per-person input in a core engine, which is option (c) of R7 and collides
  with **L-2 seam (b)** (`DECISIONS.md`, 2026-08-05). **B does not close the
  split problem. B makes the split *expressible* and leaves it *unverified*.**
- **The most B can offer is advisory**: the estate total in §7's footer, which a
  human compares against known salaried headcount. That is a display aid, not a
  constraint, and it must be labelled as one. An advisory total that looks like a
  validation is worse than no total.

**Also not solved, recorded so none of it is rediscovered as new:**

- **The four unmapped "Not in Froot" rows at Las Brisas** (including Taylin and
  Karson at 45 and 40 hrs). Still moot — their hours reach nothing, before or
  after B.
- **`StaffMember.isCorporate`.** Still exists, still reasons about forecast
  leakage in its own comment, still consulted by nothing in the forecast. B does
  not touch it. If a person-level flag is ever built, the two-booleans question
  R7's `recommendation` raised is still owed.
- **The original hourly motivation for `forecastExempt`** — owners' family,
  volunteers, corporate staff on the roster. B does nothing for them because
  nothing needed doing: they never reached the forecast. That is closed by the
  audit in `041bfaa`, not by B.
- **§3.3's short-hours store.** `Σ gmCreditHours < salariedHours` when the GM
  window is small. Survives B untouched.

---

## 9 · Interaction with the GM-hours whole-crew ruling (`c17466e`)

Ratified, unbuilt, thirteen surfaces, audit at
`docs/prompts/Labor_S5_Q1_GM_HOURS_AUDIT.md`, deviations S5-D9..D13.
**They touch the same arithmetic in exactly one place, and the answer is: shape
unchanged, surface count unchanged, §5 constraint unchanged and its stakes
raised.**

### 9.1 Shape — unchanged
That build's Option 1 (S5-D9) is a display-additive field on the day payload,
`hourlyHours + gmCreditHours`, computed from `DayPlan.gmCreditHours` which
already exists. B changes what `salariedHours` and the credit ceiling **are** for
a given store; it does not change the **formula**, does not add an engine input,
and does not make the field non-additive. Build it exactly as audited.

### 9.2 Surface count — thirteen, unchanged
B adds **no computed hours figure to any surface**. It adds a settings *input*
(§7) — a declared number, the same category as row 13 of that audit's table
(the split editor, "percentages, not hours"). Stated in both halves so neither is
overclaimed: **the thirteen surfaces carrying a computed hours figure are
untouched; one settings surface carrying a declared number is added.**

### 9.3 §5's constraint — unchanged, and its stakes go UP
§5 requires the GM-inclusive figure to be a **NEW field**, never a mutation of
`d.hourlyHours`, because `weekly-plan/route.ts:94` costs
`d.hourlyHours x blendedRate` and adds `salariedShare` separately — a mutation
would double-count the GM and cost salaried hours at the hourly rate.

**B makes `salariedCost` per-store, so `salariedShare` becomes per-store too.**
Under a mutation the double-count would then be **variable across the estate**: a
store declaring `0` double-counts nothing, a store declaring `40` double-counts
40. Same defect, unevenly distributed, and therefore **harder to catch by
comparing stores** — which is exactly how someone would notice it today. The
constraint holds and is now load-bearing on more.

### 9.4 The one real coupling, and the recommendation
Both land on S5-D10's guard, `Σ gmCreditHours == budget.salariedHours`.

- **B first (or the ceiling substitution shipped with B):** the guard is true by
  construction in the over-cap case, and the GM build inherits it.
- **GM build first with the hardcoded 40:** the guard is written against a
  constant and must be rewritten when B lands.

**Recommendation: B first if the two are close together.** If Gary wants the
cheap visible win first — reasonable, since the GM build is display-only and B is
a migration — then **the GM build must read the ceiling from a single named
helper rather than from the module constant**, so B is a one-line change later
rather than a re-argued guard. That is a cheap seam and it should be taken
whichever order is chosen. See **S5-D22**.

### 9.5 Two consequences at a zero-declaration store
Worth having before either is built, because both are the shape of defect that
has already bitten this module once:

- **The ADMIN GM-excluded toggle (S5-D12) renders two identical numbers** at a
  store declaring `0` — GM-inclusive equals GM-excluded, because there is no GM.
  Not a bug; the toggle must not imply a difference where there is none.
- **`hasGm` false means the coverage curve loses the GM body** (`headcount =
  hourly + (gm ? 1 : 0)`, `labor-coverage.ts:98`) and `Suggested` drops. The GM
  audit's row 5 records that Suggested "counts the GM on floor"
  (`weekly-plan-client.tsx:457`). **At a zero-declaration store that sentence is
  false.** A sentence that renders unconditionally and is wrong at one store is
  the mirror image of S5-A13, where a sentence that should have rendered never
  did. It must be conditional on `hasGm`.

---

## 10 · Deviations proposed

Numbered from **S5-D18** per instruction. (`S5-D15`–`S5-D17` are not recorded
anywhere in this repository; the gap is Gary's and is not closed here.)
**All are proposals. Nothing below is built or approved.**

- **S5-D18** — **Shape: option (b2)**, a narrow `LaborPositionStoreHours` layer
  carrying `weeklyHours` and **no rate**, not a `storeId` column on
  `LaborPosition`. Additive by construction: one `CREATE TABLE`, zero rows
  touched, no seed, no backfill. The rate exclusion is the load-bearing part —
  it is what keeps §1.1's blended-rate exposure out of the ruling's scope.
- **S5-D19** — **`WEEKLY_GM_CAP_HOURS` becomes the store's resolved salaried
  hours**, with the module constant retained as the fallback when nothing
  resolves. A measured no-op today (§4), and it closes S5-D10's **first**
  divergence case. **It does NOT close the second** (short-hours store, credits
  below the ceiling); D10 is **narrowed, not resolved**, and closing it is a
  ruling about whether the identity may be conditional.
- **S5-D20** — **The invariant is fixture-gated in two files** (§6.1), asserting
  the FULL `LaborBudgetResult` field-for-field under an empty declaration map —
  not `salariedHours` alone, since only `blendedHourlyRate`/`hourlyHours` would
  catch a §1.1 regression. **Plus the honest limit:** a pure fixture proves the
  engine, never the estate. The estate proof is a pre/post `/api/labor/budget`
  read for all nine stores at one `weekStart` on staging, under the staging-SHA
  precondition, and it is Gary's to run.
- **S5-D21** — **UI is a "Salaried hours by store" table (§7 option 2)**, not a
  picker, because the defect is estate-level and a picker cannot show an estate
  total. `Inherits · 40` and a declared `0` must render distinguishably. The
  total is **advisory and labelled as such** (§8). Copy is Gary's call.
- **S5-D22** — **Ordering with the GM-hours build.** B first, or the ceiling
  substitution ships with B. If the GM build goes first, it reads the ceiling
  from a single named helper rather than the module constant. Independently:
  `hasGm` must gate the "counts the GM on floor" sentence
  (`weekly-plan-client.tsx:457`), which is false at a zero-declaration store.
- **S5-D23** — **`hasGm` becomes *resolved salaried hours > 0*** rather than *a
  SALARIED row exists* (`labor-plan.ts:179`). Listed separately because it is the
  single place a careless build moves a store's numbers without a declaration
  (§6), and because it is easy to miss while reading only the budget path.

---

## 11 · What this audit does NOT establish

- **Nothing was built.** No file outside `docs/` was touched. No schema edit, no
  migration, no fixture, no UI. The Prisma block in §5.2 and the function in §5.4
  are *proposals written out*, not code in the tree.
- **No deployed environment was queried.** §4 is the **dev** branch, named on
  every line. Staging and production hold whatever they hold; §4.1 carries the
  paste-ready Neon-console SQL, and §4 states why the plan does not depend on the
  answer.
- **No number in §7's mock-up is real.** `Las Brisas 20` / `UNR 20` illustrates
  Kristie Connolly's split as §8 describes it; nobody has declared anything, and
  the split figures are Gary's to set.
- **The estate arithmetic in §4 is derived, not measured end-to-end.**
  `9 x 40 = 360` hours and `9 x $800 = $7,200/wk` follow from one seeded row and
  nine active stores; no store's rendered budget was read to confirm it, because
  that read is a deployed-environment read.
- **S5-D10 is narrowed, not closed** (§3.3), and the split problem is not closed
  (§8). Neither is a gap in the plan; both are stated because a plan that implies
  it closes them would be the more dangerous document.
