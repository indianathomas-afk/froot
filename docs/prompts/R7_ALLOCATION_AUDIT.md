# Per-person salaried allocation + exempt · AUDIT AND PLAN

**Session:** TIER 3, 2026-08-22. **Audit and plan only. NOTHING WAS BUILT** —
no schema, migration, route, UI or fixture. No file outside `docs/` was touched.
**Rulings ratified first:** `docs/DECISIONS.md` § "Per-person salaried
allocation — the four build rulings" (`99b9c85`).
**Code read at:** `staging` `da61750` (+ the ratification, docs only).
**Deviations: S5-D48 onward — NOT S5-D41.** The prompt says "from S5-D41
onward" and correctly notes D36–D40 are taken by the R7-B row. **D41–D47 are
also taken** — by the previous session's `R7_EXEMPT_AUDIT.md` §7, cited in
`docs/ROADMAP.yaml:7990`. Continuing from **S5-D48** and flagging rather than
silently colliding. **This is the third numbering collision in four sessions**
(the drift audit's D28, then D36, now D41); see S5-D56. `S5-D15..D17` remain
unrecorded and are not closed here.

---

## 0 · The answer in one paragraph

**Kristie's salary must be RE-ENTERED as a Froot-owned figure, not read from the
Square mirror** — using `annualRate` would put a synced value into a core engine,
which the seam amendment explicitly does not admit, and would let a Square wage
edit move two stores' labor budgets with nothing on screen saying why. Seeding it
from Square once and tracking the divergence is the existing house pattern
(`fullName`/`squareFullName`). That decision then **resolves the boundary-test
debt outright rather than by restatement**: if the person record is a NEW
Froot-owned table instead of columns on `SquareTeamMemberWage`, dropping every
Square-labor table leaves salary, hours, exempt and allocations intact and the
original test — *"drop every Square-labor table and every labor surface renders
byte-identically"* — **passes verbatim, unamended**. That same choice supersedes
both `LaborPositionStoreHours` and `weeklyHoursOverride`. The 100% invariant is
enforced **at write, on the whole person atomically**, because the unit of write
is the person and not the (person, store) pair — which makes "someone edited one
side" structurally impossible rather than merely validated against. And `hasGm`
is **no longer the hazard**; the new one is the GM on-floor *window*, which stays
per-store and can draw Kristie's band at two stores on the same day.

---

## 1 · Where a person's salary and weekly hours live, and where they could

### 1.1 Today

**Pay exists in exactly one place: `SquareTeamMemberWage`** — the roster mirror.

| Field | `prisma/schema.prisma` | Owner | Reaches labor arithmetic? |
|---|---|---|---|
| `annualRate Decimal?(12,2)` | `:2622` | **Square** (sync writes it) | no |
| `hourlyRate Decimal?(10,2)` | `:2620` | **Square** | no |
| `squareWeeklyHours Int?` | `:2626` | **Square** | no |
| `weeklyHoursOverride Int?` | `:2648` | **FROOT** — `DO UPDATE` omits it (`labor-roster.ts:230-233`) | **no — inert since AL-3** |
| `isSupervisory Boolean?` | `:2654` | **FROOT** — same omission | `hasHourlySupervisor` only |

**`StaffMember` carries no pay field of any kind** (`schema.prisma:283-336`) —
identity, status, signing cycle, `isCorporate`, and nothing financial.

**The only salary figure any engine sees today is
`LaborPosition.defaultHourlyRate`** — an archetype rate on a table of roles, not
of people (`labor-budget.ts:75,88-91`).

### 1.2 Candidate homes, and the cost of each

| # | Home | Reaches unmapped people? | Boundary test | Verdict |
|---|---|---|---|---|
| (a) `StaffMember` + new pay columns | **NO** — Karson and Taylin have no row | survives | **Rejected** on §1.3 |
| (b) New columns on `SquareTeamMemberWage` (the predecessor's exempt proposal) | yes — keyed by `squareTeamMemberId` | **FAILS** — dropping the mirror drops the Froot data, so numbers move | **Rejected**, see §2.4 |
| (c) Reuse `weeklyHoursOverride` for the hours | yes | **FAILS**, same reason | **Rejected**, and it is superseded — §5.3 |
| (d) **NEW Froot-owned table keyed by `squareTeamMemberId`** | **yes** | **SURVIVES VERBATIM** | **THE LEAN** |

### 1.3 Does the unmapped gap constrain ALLOCATION as it constrains exempt?

**Not by the same force, and the honest answer is that it constrains it less —
but the design should not exploit that.**

- **Exempt is HARD-constrained.** Its three subjects are Kelton, Karson and
  Taylin; **two of the three have no `StaffMember` row**, so a column there could
  not express the exemption for most of its own use case. Established by the
  predecessor (`R7_EXEMPT_AUDIT.md` §2) and unchanged.
- **Allocation is NOT hard-constrained today**, because its only subject is
  Kristie Connolly — **and she has no `StaffMember` row on dev either** (measured
  below). Whether she has one on staging or production is unmeasured; the
  predecessor's dev read found no row for Kristie, Karson or Taylin.

**So allocation is soft-constrained on today's data and hard-constrained the
moment a second allocable person is unmapped.** Since exempt and allocation ship
together by ruling, and exempt is hard-constrained, **both must key on
`squareTeamMemberId`.** Splitting the key — allocation on `StaffMember`, exempt
on the Square id — would put one person's facts in two keyspaces and is exactly
the rot the `isCorporate` finding warned about.

**Branch `dev` (`ep-late-water-a6k53nv2`, `br-broad-wave-a6vpjdw0`), measured
2026-08-22 by the predecessor and unchanged:** `SquareTeamMemberWage` rows = 0
(the wage sync has never run on dev); `StaffMember` rows = 5; **Kristie, Karson
and Taylin have no `StaffMember` row**; Kelton does
(`cmqxfyjt1000004jtbfzj9jmz`). The estate-wide counts still need the Neon-console
SQL in `R7_EXEMPT_AUDIT.md` §2.1.

---

## 2 · Salary is Square-sourced — does using it cross the amended seam?

### 2.1 **YES. It crosses. The amount must be re-entered as a Froot-owned figure.**

The amendment's own words (`DECISIONS.md`, `856bd46`):

> *"The seam stood on the premise that person-level data is Square-sourced and
> unstable; allocation and exemption are Froot's own facts about the business,
> **entered deliberately by an admin, not synced**."*

`annualRate` is **written by the sync** — it is in `writeRoster`'s `DO UPDATE`
list, unlike `weeklyHoursOverride` and `isSupervisory`, which are deliberately
omitted (`labor-roster.ts:230-233`). It is Square-sourced by the schema's own
definition, and the amendment admits **admin-entered facts, not synced values**.
The original prohibition — *"the core engines NEVER gain a Square-sourced
input"* (`ROADMAP.yaml`, L-2 § SEAM (b)) — is untouched for synced columns.

### 2.2 Why this is not legalism — the concrete failure

Feeding `annualRate` into `computeWeeklyLaborBudget` means **a wage edit made in
Square silently moves Las Brisas's and UNR's labor budgets on the next roster
sync**, with no Froot-side action, no audit trail, and nothing on screen
explaining the change. That is the Meadowood drift failure with an external
writer attached: numbers moving for a reason no surface names
(`MEADOWOOD_DRIFT_AUDIT.md`). It is also the direction Gary already closed once —
AL-3 measured that swapping Square rates for legend rates moves the blended rate
~15%, and the answer was no.

### 2.3 The house pattern already exists, twice

**Seed from Square once, own it in Froot, surface the divergence.**

- `StaffMember.fullName` / `fullNameLocked` / `squareFullName`
  (`schema.prisma:293-298`): Froot-confirmed legal name, *"a Square resync must
  not clobber it"*, and `squareFullName` tracks the last Square value **"to
  surface a lock/Square divergence."**
- `DECISIONS.md`, 2026-07-27: *"Device login email is SEEDED from Square once,
  never live-synced."*

So the person record carries `weeklySalary` (Froot-owned, admin-entered, seeded
from `annualRate ÷ 52` on first create) **plus** `squareAnnualRateSeen`, a
mirror of what Square said when it was seeded, so the settings card can render
*"Square now says $54,000 — update?"* without ever acting on it. **Nothing
auto-updates.** See **S5-D49**.

### 2.4 The boundary-test debt — RESOLVED, and not by restating the test

The predecessor recorded that the test needed restating against Square-**owned
columns** rather than tables wholesale, because a Froot-owned column on the
mirror row would be dropped with it (`856bd46`, L-2 seam mark).

**That debt exists only under home (b). Choose home (d) and it evaporates.**

| Home | Drop `SquareTimecard`, `SquareScheduledShift`, `SquareTeamMemberWage` → | Test |
|---|---|---|
| (b) columns on the mirror | salary, hours, exempt, allocations all vanish → `salariedCost` and `salariedHours` go to 0 → **every allocated store's numbers move** | **fails** — needs restating |
| **(d) new Froot table** | the Froot table survives with every row → `salariedCost` and `salariedHours` unchanged → **core numbers byte-identical** | **passes VERBATIM** |

**Resolution: the debt is discharged by design rather than by amendment. The
2026-08-05 boundary test stands exactly as written and needs no restatement.**
That is a strictly better outcome than the amendment the predecessor owed, and
it is the single strongest argument for (d) over (b).

**One honest qualifier, stated rather than smoothed.** With the mirror dropped,
the person's **NAME** is unresolvable — the Froot table keys on
`squareTeamMemberId` and holds no name. The **allocation settings card** would
render ids. **No labor NUMBER moves and no labor surface changes**, which is what
the test asserts; but the claim is "every labor surface renders byte-identically",
not "every settings surface stays legible". Recorded as **S5-D50** so the next
person running the test is not surprised by it.

---

## 3 · The 100% invariant — where it is enforced

### 3.1 The existing precedent is the WRONG shape, and that is the finding

`LaborDaySplit.weightBps` is the closest thing in the codebase — seven weights,
basis points, morally summing to 10000. **It is enforced NOWHERE.**

- **Write** (`api/labor/day-split/route.ts:30-33`): `putSchema` checks each
  weight is `0..10000` and that there are exactly 7. **No sum check.**
- **Read** (`labor-plan.ts:226-232` → `labor-daily.ts:97-107`): the split
  **normalises** — `extra = remainder × (weight / poolBps)` — so any set produces
  a valid answer.

For a day split that is harmless: the pool is fixed and merely redistributed.
**For a person it is the exact failure Gary named.** Normalising 50/40 makes
Kristie behave as 55.6/44.4 — **inventing allocation nobody typed and hiding that
10% was forgotten.** Not normalising charges $500 + $400 = $900 of a $1,000
person, leaving $100/wk of real cost uncharged, so both stores believe they have
more hourly budget than they do. **Both directions are bad; one is bad and
silent.**

### 3.2 Proposal — enforce at WRITE, assert at READ, and never normalise

**THE UNIT OF WRITE IS THE PERSON, NOT THE (PERSON, STORE) PAIR.** This is the
structural half and it matters more than the validation: a single
`PUT /api/labor/salaried/[personId]/allocations` takes the **complete** set of
store percentages and replaces them in one transaction. **There is no endpoint
that can edit one side**, so "someone edited one side and now it doesn't sum" is
not a state the API can produce. Rejecting a bad total is then a validation on a
body, not a race to lose.

- **Write:** reject unless `Σ allocationBps === 10000` **exactly**. Integer basis
  points, so exactness is available — no float tolerance, and none should be
  offered. An empty set is legal and means *not allocated anywhere*.
- **Read:** assert, **do not normalise**. If a stored set does not sum to 10000
  (hand SQL, a restore, a future bug), allocate **exactly what is stored** —
  never invent a percentage — and raise a visible flag.
- **The flag is a leaf**, the same shape as `floorExceedsBudget`: a boolean on
  the payload that renders a banner and **feeds no arithmetic**. Under-allocation
  is the financially unsafe direction (§3.1), so it must be loud on every
  affected store's surface, not just in the settings card where the mistake was
  made.

**Why not block the plan entirely:** a store whose labor page refuses to render
because a person elsewhere is 90% allocated is a bigger outage than a wrong
number with a red banner on it. **Why not normalise:** Gary's ruling — nothing
derived is ever typed by hand, and a normalised percentage is a figure the system
invented. See **S5-D51**.

---

## 4 · Every consumer that must respect a per-person allocation

| # | Consumer | `file:line` | Change |
|---|---|---|---|
| 1 | `salariedCost` | `labor-budget.ts:75` | Σ over allocated people of `weeklySalary × bps/10000` |
| 2 | `salariedHours` | `labor-budget.ts:76` | Σ over allocated people of `weeklyHours × bps/10000` |
| 3 | `hourlyDollars` | `labor-budget.ts:81` | unchanged expression, moved input |
| 4 | `floorExceedsBudget` | `labor-budget.ts:115` | unchanged expression (`>=`, D28), moved input |
| 5 | `hasGm` | `labor-plan.ts:214` | "this store has an allocated salaried person with hours > 0" |
| 6 | GM on-floor **window** | `labor-plan.ts:206-215` | **unchanged — and that is finding §4.2** |
| 7 | GM floor-credit ceiling | `labor-plan.ts:257` | already reads resolved `salariedHours` via `resolveGmCeilingHours` — **no change needed** |
| 8 | `adjustedTotalSchedulableHours` | `labor-plan.ts:320` | unchanged expression |
| 9 | Estate card | `labor-salaried-summary.ts` (whole file) | rewritten around people, not archetypes |
| 10 | Capture script field sets | `capture-labor-budget.ts:60-90` | **NO CHANGE** — same fields, same exclusions; only values move |
| 11 | `blendedHourlyRate` | `labor-budget.ts:88-91` | **MUST NOT CHANGE.** Filters `payType === "HOURLY"` over `LaborPosition`; no person is HOURLY here |
| 12 | `hasHourlySupervisor` | `labor-plan.ts:220` | **no change** — reads `isSupervisory` + `payType` on archetypes |

**One resolution point again.** All of 1–8 flow from a single per-store figure
pair computed once in `getWeeklyDayPlan` — the R7-B shape, with the source
swapped from declarations to people. `computeWeeklyLaborBudget`'s **signature
need not change**: a person's allocation synthesises one `LaborBudgetPosition`
with `impliedWeeklyHours = weeklyHours × bps/10000` and
`defaultHourlyRate = (weeklySalary × bps/10000) ÷ that hours figure`, so cost
comes out exact by construction. **Verified arithmetically in §8.**

### 4.1 Is `hasGm` still the hazard? **No — and the reason matters**

Under R7-B, `hasGm` was the one place a store's number could move **with no
declaration present**, which is why it was resolved rather than counted
(S5-D23). Under per-person:

- A store with **no allocation** → `hasGm` false → no GM band → floor is the full
  open window → hourly must cover it. **That is not a hazard, that is the ruling
  working**; it is precisely the re-baseline Gary ordered for ten stores.
- A store **with** an allocation derives everything from the person. Nothing is
  inherited, so there is no fallback to get wrong.

**`hasGm` stops being a hazard because the fallback it guarded no longer
exists.** The check that replaces it is §3's sum assertion — the new place a
number can be wrong without anyone typing it.

### 4.2 THE NEW HAZARD — the GM on-floor window is per-STORE and unallocated

`labor-plan.ts:206-215` builds the GM band from
`settings.gmOnFloorStartMinutes` / `gmOnFloorEndMinutes` — **`LaborSettings`,
which is per-store, not per-person** (`schema.prisma:2300-2302`).

So with Kristie at 50/50, **Las Brisas and UNR each draw a GM on-floor band from
their own settings, on the same days, for the same person.** The model has no way
to know she cannot be in two places at once, and the weekly *credit* ceiling does
not help: `resolveGmCeilingHours` caps each store at **its own** 20 hours
independently, so both caps are satisfied while the person is double-booked
across the estate.

**The hours arithmetic is correct** — 20 + 20 = her 40. What is wrong is the
*coverage shape*: both stores may believe she is on the floor 7a–3p Monday.
**This is the assignment layer (L-4) by construction — which specific days and
hours a named person works is exactly what L-4 exists to decide** — and it is
**not solved here and not solvable here.** It gets a ROADMAP row. See
**S5-D52**.

---

## 5 · The archetype's fate, and two supersessions

### 5.1 The SALARIED `LaborPosition` row becomes DEAD for arithmetic

Once salaried cost and hours come from people, the seeded
`General Manager / SALARIED / $20.00 / 40` row drives **nothing**:

- `salariedCost` / `salariedHours` — replaced by the person sum (§4).
- `hasGm` — replaced (§4).
- `blendedHourlyRate` — **never touched it**; the mean filters
  `payType === "HOURLY"` (`labor-budget.ts:88`).
- `hasHourlySupervisor` — **never touched it**; filters HOURLY (`labor-plan.ts:220`).

**DO NOT REMOVE IT.** Additive-only does not tier down, and there is a live
foreign key: `LaborPositionStoreHours.laborPositionId` has
`onDelete: Cascade` (`schema.prisma`, R7-B), so deleting the archetype would
silently cascade-delete every declaration row.

**What removing it WOULD affect:** the legend list on `/settings/labor`; the
seed for new orgs (`labor-positions.ts:9`); the R7-B estate card's "organisation
figure" column; and the cascade above. **What it would NOT affect:** the blended
rate, hourly hours, the coverage curve, `hasHourlySupervisor`, or any store's
labor budget once allocation is live. **Recommendation: leave it, mark it
inert-for-arithmetic in its own comment, and keep it as the HOURLY legend's
companion.** See **S5-D53**.

### 5.2 `LaborPositionStoreHours` is SUPERSEDED — R7-B, four days old

Gary's ruling: *"Both the dollars and the hours at each store derive from the
person — nothing derived is ever typed by hand."* **A per-store salaried hours
declaration is a hand-typed derived figure.** Two sources for one number is how a
model rots, and the ruling picks the person.

**Preserved, not dropped.** The table, its migration, its route and its UI stay;
`getWeeklyDayPlan` stops reading it. **This is a real cost, stated plainly: a
table, a migration, a resolution helper, an API route, an estate card and a
fixture, built and verified on staging four days ago, are retired by the ruling
that followed them.** The rejected alternative — a fallback chain of *person
allocations, else store declaration, else zero* — reintroduces exactly the
two-source ambiguity "absent means zero" was ruled to remove.

### 5.3 `weeklyHoursOverride` is SUPERSEDED — and it was built for this

`SquareTeamMemberWage.weeklyHoursOverride` was ruled into existence 2026-08-19
(Q9) as *"the storage a later salaried-allocation phase needs"*
(`schema.prisma:2644-2648`). **This is that phase**, and it does not use it —
because §2.4's boundary test puts the person record on a Froot table, and salary
and hours belong to the same record. Preserved and marked, never read, never
dropped. See **S5-D54**.

---

## 6 · Exempt, now that it gates something

**The predecessor's proposal is CONFIRMED in substance and MOVED in location.**

| | Predecessor (`R7_EXEMPT_AUDIT.md` §5) | This audit |
|---|---|---|
| Type | `Boolean?`, NULL = not reviewed | **same — confirmed** |
| Key | `squareTeamMemberId` | **same — confirmed** |
| Table | `SquareTeamMemberWage` | **moved to the new Froot table** (§2.4) |

**Why the move, and it is the only change:** exempt on the mirror fails the
boundary test for the same reason salary would (§2.4), and it separates a
person's exemption from that person's allocation record by one table for no gain.
Everything else in the predecessor's reasoning stands — three distinct states,
`!= null` never truthiness, and `isCorporate` not reused because it has no write
path and drives the store stamped on signed PDFs (`hr.ts:97`).

**What exempt gates, now that it is not inert:** an exempt person is **excluded
from the allocation UI's candidate list and rejected by the allocation write
endpoint**. They are *outside the system*, not allocated 0% — which matters
arithmetically, because 0% would have to sum to 100% with something and there is
nothing to sum with. **A person with `exempt = true` and any allocation row is a
contradiction the write path must refuse.** See **S5-D55**.

**Kelton, Karson and Taylin get `exempt = true`.** All three keyed by
`squareTeamMemberId`, so the two with no `StaffMember` row are covered
identically — which is the whole reason for the key.

---

## 7 · Schema — additive only

```prisma
/// R7 allocation (Gary, 2026-08-22). ONE ROW PER SALARIED PERSON THE BUSINESS
/// CARRIES. Keyed by squareTeamMemberId and NOT by StaffMember, because Karson
/// and Taylin have no StaffMember row and importing them was rejected — it
/// manufactures HR obligations to solve a labor problem.
///
/// A FROOT-OWNED TABLE, NOT COLUMNS ON THE SQUARE MIRROR, AND THAT IS LOAD-
/// BEARING. It is what keeps L-2's boundary test true verbatim: drop every
/// Square-labor table and this survives, so no labor NUMBER moves. Columns on
/// SquareTeamMemberWage would have been dropped with it.
///
/// weeklySalary IS FROOT-OWNED AND NEVER SYNCED. Square's annualRate is
/// Square-sourced (writeRoster's DO UPDATE writes it, labor-roster.ts:230-233),
/// and the amended seam admits admin-entered facts, NOT synced values. It is
/// SEEDED from annualRate/52 at create and never again — the fullName /
/// squareFullName pattern. squareAnnualRateSeen records what Square said at
/// seeding so a divergence can be SHOWN and never acted on.
model LaborSalariedPerson {
  id                   String   @id @default(cuid())
  organizationId       String
  squareTeamMemberId   String
  /// Dollars per week, Froot-owned. $52,000/yr -> 1000.00
  weeklySalary         Decimal  @db.Decimal(10, 2)
  /// The person's required weekly hours — 40 for Kristie. Froot-owned.
  weeklyHours          Int
  /// NULL = not reviewed · true = outside allocation entirely · false =
  /// explicitly included. Three states; `if (p.exempt)` collapses two of them.
  /// Write `!= null`.
  exempt               Boolean?
  /// What Square's annualRate said when weeklySalary was seeded. DISPLAY ONLY —
  /// nothing reads it for arithmetic, ever.
  squareAnnualRateSeen Decimal? @db.Decimal(12, 2)
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  organization Organization               @relation(fields: [organizationId], references: [id])
  allocations  LaborSalariedAllocation[]

  @@unique([organizationId, squareTeamMemberId])
  @@index([organizationId])
}

/// One person's share of one store. THE SET FOR A PERSON MUST SUM TO 10000 bps
/// AND IS WRITTEN ATOMICALLY — there is no endpoint that edits one row, which is
/// what makes "someone edited one side" unreachable rather than merely validated.
/// Basis points, not percent: integers make the sum EXACTLY 10000 with no float
/// tolerance. Same unit as LaborDaySplit.weightBps — and unlike that table, the
/// sum here is enforced (see the audit's §3).
model LaborSalariedAllocation {
  id             String   @id @default(cuid())
  organizationId String
  personId       String
  storeId        String
  allocationBps  Int      // 0–10000; the person's set sums to exactly 10000
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization Organization        @relation(fields: [organizationId], references: [id])
  person       LaborSalariedPerson @relation(fields: [personId], references: [id], onDelete: Cascade)
  store        Store               @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@unique([personId, storeId])
  @@index([organizationId, storeId])
}
```

**Two `CREATE TABLE`s. No `ALTER` on any existing table. No drop, no backfill, no
seed.** Both ship empty; both existing superseded columns keep their data.

**Defaults:** `exempt` NULL, `squareAnnualRateSeen` NULL, timestamps standard.
`weeklySalary` and `weeklyHours` are **required** — a person record with no
salary is not a person record.

---

## 8 · The promotion manifest, recomputed WITH allocation

**Kristie Connolly, $52,000/yr = $1,000.00/wk, 40 hrs/wk, Las Brisas 50% / UNR
50%.** Derived from the committed BEFORE capture and the pure engine; **no
deployment was involved.**

```
staging BEFORE (br-square-feather, week 2026-08-10)  ->  PREDICTED

store                | salariedHrs | salariedCost | hourlyHours     | totalSched      | blended | carries
---------------------|-------------|--------------|-----------------|-----------------|---------|-------------
Carson               | 40 ->  0    |  800 ->   0  | 137.5 -> 193.0  | 177.5 -> 193.0  | 14.5    | nobody
Las Brisas           | 40 -> 20    |  800 -> 500  | 193.0 -> 213.5  | 233.0 -> 233.5  | 14.5    | Kristie 50%
Meadowood Mall       | 40 ->  0    |  800 ->   0  | 137.5 -> 193.0  | 177.5 -> 193.0  | 14.5    | nobody
South Reno           | 40 ->  0    |  800 ->   0  | 165.5 -> 220.5  | 205.5 -> 220.5  | 14.5    | nobody
UNR                  | 40 -> 20    |  800 -> 500  |  13.5 ->  34.0  |  53.5 ->  54.0  | 14.5    | Kristie 50%
Default Test Account | no forecast — budget:null, UNCHANGED
Southgate            | no forecast — budget:null, UNCHANGED
Spanish Springs      | no forecast — budget:null, UNCHANGED
Sparks               | no forecast — budget:null, UNCHANGED
Tahoe Lemonade       | no forecast — budget:null, UNCHANGED
The Palomino Club    | no forecast — budget:null, UNCHANGED
University Village   | no forecast — budget:null, UNCHANGED

5 budgeted stores move · 7 null stores unchanged · 12 lines
blendedHourlyRate 14.5 EVERYWHERE — D24's rate canary is untouched by this ruling
Kristie: 10000 bps = 100% · $1,000 of $1,000 charged · 40.0 of 40 hours placed
```

**Read the two Kristie rows against the predecessor's "absent means zero" alone
manifest — that is what this ruling buys.** Under the re-baseline by itself UNR
went `13.5 → 68.5` hourly hours, because a real manager vanished from a real
store. With allocation it goes `13.5 → 34.0`, and the store still carries half of
her. **UNR's total schedulable barely moves (53.5 → 54.0) while its composition
changes completely** — 40 archetype hours nobody works become 20 real hours
Kristie does.

### 8.1 Hours must be FRACTIONAL, not rounded to Int

Gary's own third-store example exposes it:

```
33.33% / 33.33% / 33.34%   exact 13.33 + 13.33 + 13.34 = 40.00
                         rounded    13 +    13 +    13 = 39   <-- LOSES AN HOUR
33.00% / 33.00% / 34.00%   exact 13.20 + 13.20 + 13.60 = 40.00
                         rounded    13 +    13 +    14 = 40   (survives by luck)
```

`LaborBudgetPosition.impliedWeeklyHours` is typed `number | null`
(`labor-budget.ts:16`), **not Int**, and `salariedHours` accumulates it as a
number (`:76`) — so **fractional hours need no engine change.** The `Int` is only
on `LaborPosition.impliedWeeklyHours`, which is an archetype and not a derived
figure. **Derive exactly, round only for display.** See **S5-D48**.

### 8.2 What must be captured against PRODUCTION, and exactly how

**Staging cannot demonstrate this promotion.** Only 5 of 12 staging stores carry
a forecast; the other 7 are `budget:null` and cannot move. **Forecast goals are
per-environment stored data** — `GoalPlan` rows per Neon branch, which a code
deploy does not carry — so production will move stores staging cannot show, and a
staging sign-off would understate the estate.

**The sequence, in order, before any promotion:**

1. **Capture production BEFORE.** `/api/labor/budget?storeId=<id>&weekStart=<Monday>`
   for **every** production store — not only budgeted ones (S5-D26) — then
   `capture-labor-budget.ts normalize --out docs/prompts/r7_budget_BEFORE_production_<date>.jsonl
   --branch production --week <Monday> --tip <sha>`. **Same week for BEFORE and
   AFTER**, and ideally the same Pacific day so `adjustedTotalSchedulableHours`
   can be promoted into the strict diff (S5-D34).
2. **Enter the data on production first.** Kristie's person record and her 50/50
   allocation; `exempt = true` on Kelton, Karson and Taylin. **This is data entry,
   not deployment, and it must precede the code** — otherwise promotion runs the
   window in which Las Brisas and UNR carry nothing, which is the sequencing
   hazard Gary's first ruling exists to prevent.
3. **Predict + manifest.** `predict --rule person-allocation` then `manifest`,
   producing the per-store table above against production's own numbers.
4. **Gary signs the manifest line by line.** Every moving store, before deploy.
5. **Deploy, then capture production AFTER, then `diff --expect <predicted>`.**
   An empty strict diff then means *"the estate moved exactly as predicted and
   signed"*.

**The capture script's strict field sets do not change** — same fields, same
exclusions, same `totalSchedulableHours` / `adjustedTotalSchedulableHours`
separation. Only `predict`'s rule is new (S5-D47 already proposed `predict`,
`manifest` and `diff --expect`; this ruling adds the `person-allocation` rule to
it).

**Step 2 is the one that cannot be automated and cannot be skipped**, and it is
the reason Gary's promotion-order ruling exists.

---

## 9 · Deviations proposed

Numbered from **S5-D48** — see the header. **All are proposals. Nothing is
built.**

- **S5-D48** — **Per-store hours are FRACTIONAL, derived exactly, rounded only
  for display.** Rounding to Int loses an hour at 33.33/33.33/33.34. No engine
  change is needed; `LaborBudgetPosition.impliedWeeklyHours` is already `number`.
- **S5-D49** — **`weeklySalary` is Froot-owned, SEEDED once from Square's
  `annualRate ÷ 52`, never live-synced**, with `squareAnnualRateSeen` recording
  what Square said so a divergence can be shown and never acted on. Using
  `annualRate` directly crosses the seam as amended and would let a Square wage
  edit move two stores' budgets silently.
- **S5-D50** — **The person record is a NEW Froot table, not columns on
  `SquareTeamMemberWage`.** This discharges the boundary-test debt **by design**:
  the 2026-08-05 test passes verbatim and needs no restatement. Qualifier: with
  the mirror dropped the settings card renders ids instead of names — no labor
  number moves, but the claim is about labor surfaces, not settings legibility.
- **S5-D51** — **The 100% invariant is enforced at WRITE, on the whole person
  atomically; READ asserts and never normalises.** The unit of write is the
  person, so one-sided edits are unreachable rather than validated against. A
  non-summing stored set allocates exactly what is stored and raises a leaf
  boolean that renders a banner on every affected store and feeds no arithmetic.
- **S5-D52** — **The GM on-floor WINDOW stays per-store and is the new hazard.**
  Two stores can draw the same person's band on the same day. Hours are correct;
  coverage shape is not. **L-4 by construction, not solvable here** — gets a row.
- **S5-D53** — **The SALARIED archetype row becomes inert for arithmetic and is
  NOT removed.** A live `onDelete: Cascade` from `LaborPositionStoreHours` means
  deleting it would silently cascade-delete every declaration row.
- **S5-D54** — **`LaborPositionStoreHours` and `weeklyHoursOverride` are
  SUPERSEDED, preserved and marked, never dropped and never read.** The rejected
  alternative — person, else store declaration, else zero — reintroduces the
  two-source ambiguity "absent means zero" was ruled to remove.
- **S5-D55** — **Exempt moves to the person table; everything else about the
  predecessor's proposal is confirmed.** An exempt person is *outside* allocation,
  not allocated 0%; a person with `exempt = true` and any allocation row is a
  contradiction the write path refuses.
- **S5-D56** — **Deviation numbers should be allocated from `ROADMAP.yaml`, not
  from the session prompt.** Three collisions in four sessions (D28, D36, D41),
  each caught only because the previous session's numbers were still in view.
  A one-line "next free deviation number" on the R7-B row would end it.

---

## 10 · What this audit does NOT establish

- **Nothing was built.** No schema, migration, route, UI or fixture. §7's Prisma
  and §8.2's commands are proposals written out.
- **§8's manifest is STAGING's**, week 2026-08-10, arithmetic over the committed
  BEFORE capture and the pure engine. **It is not an observation of a deployed
  system**, and **production's manifest will differ and must be computed
  separately** (§8.2).
- **Kristie's percentages are Gary's stated 50/50, not a measurement.** Nothing
  in the database says how she is split; there is no `LaborSalariedPerson` row
  because the table does not exist.
- **The estate-wide unmapped count is still NOT measured.** Dev holds zero
  `SquareTeamMemberWage` rows. The Neon SQL remains in `R7_EXEMPT_AUDIT.md` §2.1.
- **Whether Kristie has a `StaffMember` row on staging or production is
  unmeasured.** She has none on dev. The design does not depend on it — the key
  is `squareTeamMemberId` either way — but the fact is unestablished.
- **§4.2's double-booked GM band is named, not solved**, and is L-4's.
- **Karissa Guerrero's guaranteed hours are out of scope by ruling** and get a
  row, not a design.
