# COMP-1 — Phase A audit

Compensation confidentiality + per-user Labor page access.
TIER 3. Audit only — **no file in `src/` or `prisma/` was edited and nothing was
committed.** This file is the session's own artifact per CLAUDE.md § Where
documents live, written before the report.

Read at `HEAD = bd99d98` on branch `staging`, 2026-08-28.
Prompt of record: `docs/prompts/COMP-1_comp_confidentiality.md`.

---

## 0. Two things about this session, up front

### 0.1 The session was launched in the WRONG REPOSITORY

The prompt says "You are working in the Froot repo." The session's declared
working directory is
`~/Claude_Projects/bloomnet/.claude/worktrees/comp-1-confidentiality-prompt-06726b`
— a git worktree of the **Bloomnet** project, on branch
`claude/comp-1-confidentiality-prompt-06726b`. The worktree's branch name matches
COMP-1, so the launcher appears to have picked the wrong project.

`docs/prompts/COMP-1_comp_confidentiality.md` does not exist in Bloomnet, and
Bloomnet has no labor module, no permissions registry and no `LaborPosition`. The
audit was therefore performed by granting read access to
`~/Claude_Projects/Froot/froot` and reading it directly. Everything below is
about Froot.

**This is fine for Phase A and NOT fine for Phase B.** Phase A writes one
untracked artifact and commits nothing. Phase B commits on `staging` and adds a
migration, and a session whose git worktree points at another repository must
not be the one doing that. Gary should relaunch Phase B from a session rooted in
`~/Claude_Projects/Froot/froot`.

### 0.2 `COMP-1` is free

`grep -n "COMP-" docs/ROADMAP.yaml` → no matches. The ID is unused, as the prompt
expected. Highest recorded deviations seen while grepping: `S5-D68`
(ROADMAP.yaml:9144) and `R7-D/2` (ROADMAP.yaml:9074). No deviation number is
assigned by this audit.

---

## 1. Every API route that returns pay or compensation numbers

Three distinct carriers of person-level money exist. They are **separate tables
with separate guards**, and the prompt's mental model ("the Positions roster")
covers only the first.

### 1.1 The carriers

| # | Table | Money columns | Person key | Joins to `StaffMember`? |
|---|---|---|---|---|
| A | `SquareTeamMemberWage` (schema.prisma:2752) | `hourlyRate` :2781, `annualRate` :2784 | `squareTeamMemberId` :2757 | Only by `StaffMember.squareTeamMemberId`, and **the join may miss** |
| B | `LaborSalariedPerson` (schema.prisma:2411) | `weeklyCost`, `squareAnnualRateSeen` | `squareTeamMemberId` | No relation at all |
| C | `LaborPosition` (schema.prisma:2307) | `defaultHourlyRate` :2312 | — **not a person**, an archetype | n/a |

`SquareTimecard.wageHourlyRate` is a fourth money column but is **never
per-person in a response** — see §2.3.

### 1.2 Routes, guards, and what leaves the server

| Route | Guard chain | Pay in the response |
|---|---|---|
| `GET /api/square/labor/roster` (`src/app/api/square/labor/roster/route.ts:30`) | `requireSquareLabor()` :31 → `canSeeWages(org, actor)` :34, 403 | **YES — carrier A, per person.** `hourlyRate`, `annualRate` per row (`labor-roster.ts:367-368`) |
| `PATCH /api/square/labor/roster/[id]` (`.../roster/[id]/route.ts:34`) | `requireSquareLabor()` :35 → `canSeeWages` :43, 403 | No — response is `squareTeamMemberId`, `weeklyHoursOverride`, `isSupervisory` only (:67). Deliberate, and commented as such (:70) |
| `GET /api/labor/salaried` (`src/app/api/labor/salaried/route.ts:43`) | `requireLaborContext()` :44 → `canSeeWages` :46, **404** | **YES — carrier B, per person.** `weeklyCost`, `squareAnnualRateSeen`, `displayName`, per-store `allocations` (:53-65) |
| `PUT /api/labor/salaried` (:68) | same, write | Echoes the person it wrote |
| `GET /api/labor/positions` (`src/app/api/labor/positions/route.ts:33`) | `requireLaborContext()` :34 — **NO `canSeeWages`** | **YES — carrier C.** `defaultHourlyRate` for every position (:20-30, `serializePosition`) |
| `PATCH`/`DELETE /api/labor/positions/[id]` | `requireLaborContext({write:true})` — **NO `canSeeWages`** | Echoes `defaultHourlyRate` |
| `GET /api/labor/budget` (`src/app/api/labor/budget/route.ts:16`) | `requireLaborView()` :18 — any role that can see the store | **AGGREGATE ONLY** — see §2.1 |
| `GET /api/labor/weekly-plan` | `requireLaborView()`, overlay behind `labor.schedule.view` :119 | Aggregate only |
| `GET /api/dashboard/rollup` | `loadTipBlocks(..., actor, ...)` :196, `canSeeTips` = `canSeeWages` | Store-average tips, not a person |
| `GET /api/square/labor/actuals` | `requireSquareLabor()` → `can(actor,"square.manage")` :43 | Aggregate cost/percent only |
| `GET /api/labor/day-inspector` | `requireSquareLabor()` → `can(actor,"labor.manage")` :43 | **No wages by ruling** — `labor-inspector.ts:44`, :860 ("THE SELECT LISTS ARE THE RULINGS") |
| `GET /api/labor/clocked-in-roster` | `requireLaborView()` → `can(actor,"labor.schedule.view")` :33 | No wages (`labor-inspector.ts:217`) |

**Server-rendered pages are a fourth exit and behave correctly already.**
`/staff` (`src/app/(app)/staff/page.tsx:69-81`) and `/staff/[id]` (:131) gate
`canSeeWages` **around the query**, not around the render — a denied viewer never
causes a wage to be selected, so nothing reaches props or the RSC flight payload.
That is precisely the shape COMP-1 Part 2 demands, and it is the pattern to copy.

### 1.3 Finding F1 — `/api/labor/positions` returns rates with no wage gate

`GET /api/labor/positions` hands `defaultHourlyRate` to **any ADMIN or MANAGER**
with no `canSeeWages` check, while `/api/square/labor/roster` and
`/api/labor/salaried` both require it. A MANAGER denied `labor.costs.view` today
still reads every position rate from this endpoint.

This is *arguably* out of COMP-1's scope: a `LaborPosition` is an archetype
("Shift Lead", "GM"), not a person, so no individual's confidentiality is
breached by it. But `LaborPosition.payType = SALARIED` rows carry
`defaultHourlyRate` × `impliedWeeklyHours`, which at a store with one GM is that
GM's salary in two columns. **Recorded as a finding, not fixed inline**, per the
prompt's out-of-scope rule. It needs a ruling before Part 2 can claim "no
confidential number in any payload" honestly.

---

## 2. Where the client computes budget math from row-level pay

### 2.1 The weekly budget is ALREADY server-side. Part 2's "move that math" is a no-op.

`computeWeeklyLaborBudget()` (`src/lib/labor-budget.ts:57`) is a **pure function
run on the server** inside `getWeeklyDayPlan()` (`src/lib/labor-plan.ts:250`).
The per-person salaried rows are collapsed into **one synthetic position** before
the engine ever sees them (`labor-plan.ts:238-248`), and the route returns only
the aggregate `budget` object (`budget/route.ts:47`). No per-person cost is in
that payload.

The estate-level table takes the same path — `getSalariedSummaries()`
(`src/lib/labor-salaried-summary.ts:56`) composes the same
`computeWeeklyLaborBudget` server-side and returns `salariedCost`,
`totalLaborBudget`, `salariedPctOfBudget` per store.

**So Option B is already structurally true for the weekly budget: masking
row-level numbers cannot move it.** This is the single largest reduction in
COMP-1's cost versus what the prompt anticipated, and the plan should not spend
a line on relocating math that is already where it needs to be.

### 2.2 Finding F2 — ONE genuine client-side aggregate, and masking breaks it

`src/app/(app)/settings/labor/labor-settings-client.tsx:186`

```
const estateWeekly = allocated.reduce((t, p) => t + (p.weeklyCost ?? 0), 0)
```

rendered at :318 as "N allocated people · $X/wk across …". This sums
`weeklyCost` **in the browser** from `GET /api/labor/salaried`'s per-person rows.
If Part 2 nulls `weeklyCost` for a confidential person, `?? 0` silently drops
them and the estate total **falls by exactly that person's pay** — which is worse
than a leak: it is a wrong number that looks right, and the drop itself is the
subtraction attack ruling 3 accepted, handed to the manager for free.

Three further client derivations read the same per-person `weeklyCost` and are
**fine to mask** (they are that one person's number, so "—" is the correct
render): :273 (per-allocation cost), :301 (unallocated remainder), :488 (the
editor's live preview).

**`estateWeekly` must be computed server-side and returned as a total by
`GET /api/labor/salaried`.** That is the one piece of math this project genuinely
has to move, and it is about ten lines.

### 2.3 The actuals path is already Option-B-shaped

`SquareTimecard.wageHourlyRate` is selected (`labor-actuals.ts:264`, :345) and
folded into `computeLaborActuals` **server-side** (:151-158) into a cost and a
percent. It never leaves as a per-person figure. Nothing to do.

---

## 3. The model that carries the flag — and the "Not in Froot" hole

### 3.1 The Positions roster is NOT backed by the Froot staff record

The prompt's default lean ("likely the Froot staff record") **does not hold.**
`getStoreRoster()` (`src/lib/labor-roster.ts:325`) reads
`SquareTeamMemberWage` as the row source (:330), then **left-joins**
`StaffMember` for the display name only (:348-355):

```
staffMemberId: match?.id ?? null      // :361
displayName:   match?.displayName ?? null   // :362
```

`RosterRow.staffMemberId === null` is the documented "Square knows this person
and Froot has not imported them" state (`labor-roster.ts:64-66`), counted as
`unmatchedCount` (:384) and **never dropped**. The pay columns are on the
`SquareTeamMemberWage` row, so an unmatched row still carries a wage.

**Therefore: a flag on `StaffMember` cannot cover the roster.** Every unmatched
row would be permanently non-confidential with no admin control, and the flag
would be unsettable for exactly the people whose records Froot knows least about.

### 3.2 Recommendation — the flag belongs on `SquareTeamMemberWage`

It is the row that carries the number, it exists for every roster row including
unmatched ones, and there is **already a precedent for Froot-owned columns on
this sync mirror**: `weeklyHoursOverride` and `isSupervisory` (schema.prisma:2808,
:2813) are documented as "FROOT-OWNED. THE SYNC'S DO UPDATE NEVER TOUCHES THESE
TWO" (:2799).

**The sync needs no change, and that must be verified rather than assumed.**
`writeRoster()` (`labor-roster.ts:236`) uses an explicit INSERT column list
(:277-284) and an explicit `DO UPDATE SET` list (:287-303). A new column absent
from both gets its DB default on insert and is preserved on resync — which is
the behaviour we want. The comment at :230 warns that adding such a column to the
DO UPDATE list erases every human-set value on the next sync; the new flag must
carry the same warning.

Carrier B (`LaborSalariedPerson`) is a **second** row keyed by the same
`squareTeamMemberId` and carrying `weeklyCost`. It needs no second flag — it
should read the flag through `squareTeamMemberId`, so one admin toggle governs
both surfaces. A second flag on a second table is two sources of truth for one
fact and will disagree.

### 3.3 STOP CONDITION — cannot be cleared from dev. Gary must answer it.

The prompt: *"if the audit finds salaried comp on a not-in-Froot row, STOP and
flag it; that is a hole the per-person flag cannot cover."*

Measured on dev, branch `br-broad-wave-a6vpjdw0` (`current_setting('neon.branch_id')`,
`current_database()` = `neondb`):

```
br-broad-wave-a6vpjdw0  wage_rows_by_paytype   []
br-broad-wave-a6vpjdw0  SALARY_rows            []
br-broad-wave-a6vpjdw0  unmatched_overall      [{"total":0,"not_in_froot":0}]
br-broad-wave-a6vpjdw0  salaried_people_counts [{"people":0,...}]
br-broad-wave-a6vpjdw0  allocations            [{"allocations":0,"stores":0}]
br-broad-wave-a6vpjdw0  org_count              [{"orgs":4,"square_labor_on":0}]
br-broad-wave-a6vpjdw0  positions_counts       [{"payType":"HOURLY","n":8,"active":8},{"payType":"SALARIED","n":2,"active":2}]
br-broad-wave-a6vpjdw0  users_by_role          [{"role":"ADMIN","n":4},{"role":"MANAGER","n":2},{"role":"STAFF","n":1}]
br-broad-wave-a6vpjdw0  staff_counts           [{"staff":6,"with_square_id":4}]
```

**Dev has zero `SquareTeamMemberWage` rows, zero `LaborSalariedPerson` rows, and
zero orgs with `squareLaborEnabled`.** The entire Square-labor surface is dark on
dev: `canSeeWages()` (`labor-dashboard.ts:102`) requires `laborOverlayOn(org)`,
so on dev it is false for everyone including admins, and the roster and salaried
routes 403/404 for all callers.

Three consequences, all load-bearing:

1. **The STOP condition is unanswerable here.** The 99 members / 5 salaried
   figures in the schema comments (:2770, :2783, :2810) were measured on the real
   Keva account 2026-08-19, not on dev. Whether any of those five salaried people
   lacks a `StaffMember` row can only be read on staging (`br-square-feather`) or
   production (`br-sparkling-block`), and per the prompt those reads go through
   Gary in the Neon console. **The query Gary should run is in §7.1.**
2. **The migration's backfill will seed ZERO rows on dev**, so a green migration
   here proves the DDL and proves nothing about the seed. Say so rather than
   letting `applied_steps_count` stand in for it.
3. **Parts 1 and 2 are not testable on dev at all.** Every acceptance test in the
   prompt — including the mandatory Network-tab test — has to run on staging.

What a failure would have looked like for these queries: a non-empty
`SALARY_rows` result with `not_in_froot = true` on any row is the hole. An empty
result here is **not** a pass — it is an absence of data, and I am reporting it
as such rather than as evidence.

### 3.4 The default lean is right, once the flag is on the right table

With the flag on `SquareTeamMemberWage`, "absent means not confidential" is
consistent with `@default(false)` and the house rule — and no row is uncovered,
because every roster row has a `SquareTeamMemberWage` row by construction. The
`StaffMember`-shaped hole disappears entirely. This is the reason to prefer that
table over the staff record, independent of what §7.1 returns.

---

## 4. The permissions registry and the Edit User modal — Part 3

### 4.1 The modal picks up a new capability with no bespoke UI. Confirmed.

`src/app/(app)/users/user-actions.tsx` renders the grid straight off the
registry: `ENFORCED_CAPABILITY_AREAS.map(...)` :364, then
`ENFORCED_CAPABILITIES.filter(e => e.area === area)` :369. `ENFORCED_CAPABILITY_AREAS`
is itself derived from the list (`permissions.ts:645-647`) precisely so a new
area cannot be added and silently fail to render. Storage is
`User.deniedCapabilities: String[]`, written by `PATCH /api/users/[id]`
(`route.ts:88-104`, :251).

**A one-line append to `ENFORCED_CAPABILITIES` is the whole UI job.** Part 3's
PERM-5 assumption holds.

### 4.2 Admin-only write on overrides. Confirmed, and the self-lockout test passes.

`PATCH /api/users/[id]` is behind `requireUsersManage()` (:44) and
`"users.manage": ADMIN_ONLY` (`permissions.ts:168`). Self-change is refused
outright before any write, and the route's own comment (:120-124) records that
this early return **is** the override guard: "An admin can never deny
THEMSELVES. This early return refuses the whole request when caller === target,
before any write — including the deniedCapabilities write."

So the prompt's test 3 first clause — *a manager cannot un-gate themselves* —
is already true twice over: a MANAGER cannot call the route at all, and even an
ADMIN cannot target themselves.

### 4.3 FINDING F3 — the capability Part 3 wants already exists, and is INERT

`"labor.view": ALL` (`permissions.ts:248`) is described in its own comment
(:245-247, and again at :126-128) as gating "the Labor nav entry, the /labor page
and every /api/labor route".

**It gates exactly one of those three.** A full sweep of `can()` call sites on
labor capabilities:

```
(app)/labor/inspector/page.tsx:47        labor.manage
(app)/labor/page.tsx:58                  labor.manage
(app)/settings/labor/page.tsx:45         labor.manage
api/labor/clocked-in-roster/route.ts:33  labor.schedule.view
api/labor/coverage/route.ts:72           labor.schedule.view
api/labor/day-inspector/route.ts:43      labor.manage
api/labor/weekly-plan/route.ts:119       labor.schedule.view
lib/labor-dashboard.ts:103               labor.costs.view
lib/labor-dashboard.ts:117               labor.manage
lib/labor-dashboard.ts:81                labor.actuals.view
```

`labor.view` appears **nowhere**. Its only consumer is the data-driven sidebar
filter — `can(actor, item.capability)` at `sidebar.tsx:141`, over the nav entry
declared at `sidebar.tsx:69`. `requireLaborView()` (`labor-access.ts:25`) checks
`laborModuleAvailable` and `org.activeModules`, and **never calls `can()`**;
`requireLaborContext()` (:60) then tests the **role string** directly
(`ctx.dbUser?.role === "MANAGER"`, :65) rather than a capability.

**Adding `labor.view` to `ENFORCED_CAPABILITIES` as-is would produce exactly the
defect the prompt names: the sidebar link disappears and every page and route
keeps answering.** The registry's own founding rule forbids it — "A toggle that
does nothing is WORSE than no toggle" (`permissions.ts:353-357`).

Part 3 is therefore **not** a registry append. It is: append a capability **and**
add the enforcement that makes it real, in `labor-access.ts` and in the two page
guards.

### 4.4 FINDING F4 — Part 3 IS the deferred "Labor governance" ruling

`src/app/(app)/settings/labor/page.tsx:44-46` records why `labor.manage` was held
out of the grid:

> labor.manage stays OUT of the override grid: Labor governance is its own
> ruling (ruling 5), and `/api/labor/*` still enforces inline, so a denial would
> hide this page while those endpoints answered.

`PATCH /api/users/[id]:63-77` names `labor.manage` in the same held-out list, and
`permissions.ts:610-612` says the Labor area is "deliberately the ONLY one" row.

**COMP-1 Part 3 is the ruling PERM-5C deferred.** The blocker named there —
`/api/labor/*` enforces inline — is the work, and it is the same work as §4.3.
This should be said in the DECISIONS.md entry: COMP-1 ruling 4 closes PERM-5C
ruling 5.

### 4.5 The "Labor page" surface — enumerated

The sidebar entry **labelled "Labor"** is `/settings/labor` (`sidebar.tsx:72`).
`/labor` is labelled "Weekly Plan" (:69). The prompt's §Why names
`/settings/labor` as the leak site and test 3 says "a direct API call to a labor
settings route", so **"the Labor page" = `/settings/labor`**. Gary should confirm
whether `/labor` (Weekly Plan) travels with it — it is read-only, carries no pay,
and is deliberately visible to STAFF, so my lean is **no**.

Pages:
- `src/app/(app)/settings/labor/page.tsx` — guard at :45, `redirect("/dashboard")`
- (if included) `src/app/(app)/labor/page.tsx` — no capability guard at all today
- (if included) `src/app/(app)/labor/inspector/page.tsx` — `labor.manage` at :47

The 26 labor API routes and their current guards, complete:

| Route | Guard | Verbs |
|---|---|---|
| `labor/settings` | `requireLaborContext` | GET PUT DELETE |
| `labor/positions` | `requireLaborContext` | GET POST |
| `labor/positions/[id]` | `requireLaborContext` | PATCH DELETE |
| `labor/salaried` | `requireLaborContext` + `canSeeWages` | GET PUT DELETE |
| `labor/forecast` | `requireLaborContext` | GET PUT DELETE |
| `labor/job-colors` | `requireLaborContext` | GET PUT DELETE |
| `labor/day-hours` | `requireLaborContext` | PUT DELETE |
| `labor/daypart` | `requireLaborView` | GET POST |
| `labor/daypart/[id]` | `requireLaborContext` | PATCH DELETE |
| `labor/day-adjustment` | `requireLaborView` | GET PUT DELETE |
| `labor/day-split` | `requireLaborView` | GET PUT DELETE |
| `labor/budget` | `requireLaborView` | GET |
| `labor/coverage` | `requireLaborView` + `labor.schedule.view` | GET |
| `labor/weekly-plan` | `requireLaborView` + `labor.schedule.view` | GET |
| `labor/clocked-in-roster` | `requireLaborView` + `labor.schedule.view` | GET |
| `labor/day-inspector` | `requireSquareLabor` + `labor.manage` | GET |
| `labor/toggle` | `requireAdmin()` (:25) | POST |
| `labor/_retired_position_store_hours` | `requireLaborContext` | GET PUT |
| `square/labor/roster` | `requireSquareLabor` + `canSeeWages` | GET |
| `square/labor/roster/[id]` | `requireSquareLabor` + `canSeeWages` | PATCH |
| `square/labor/roster/sync` | `requireSquareLabor` + `square.manage` | POST |
| `square/labor/sync` | `requireSquareLabor` + `square.manage` | POST |
| `square/labor/actuals` | `requireSquareLabor` + `square.manage` | GET |
| `square/labor/verify` | `square.manage` | GET |
| `square/labor/toggle` | `requireAdmin()` | POST |
| `cron/labor-timecards`, `cron/labor-scheduled-shifts` | cron secret | — |

**`requireLaborContext()` is the single choke point for the write routes.** Every
`/settings/labor` mutation passes through it. One `can()` insertion there covers
settings, positions, salaried, forecast, job-colors, day-hours and daypart writes
at once — which is why this is a small change despite touching a permission.

### 4.6 A naming note

House style is `area.thing` / `area.thing.verb` and the existing labor entries are
`labor.view`, `labor.actuals.view`, `labor.schedule.view`, `labor.costs.view`,
`labor.manage`, `labor.toggle`. `labor.access` would be the **only** `.access`
entry in the Labor area — though `hr.access` and `my.access` establish `.access`
as the house word for a module's front door (`permissions.ts:107`, :121). Two
coherent options for Gary:

- **(a) Give `labor.view` its enforcement and add it to the grid.** No new
  capability. Matches its existing name and its existing sidebar consumer. But
  `labor.view` is `ALL`, and Part 3 wants "default ON for ADMIN and MANAGER" —
  denying a STORE user would be a new restriction on STAFF/STORE, which is a
  widening of scope, not a narrowing.
- **(b) A new `labor.access`, `MANAGE` tier.** Matches Part 3's stated default
  exactly, leaves `labor.view`'s `ALL` read-only viewer untouched, and matches
  `hr.access`. **My recommendation.**

This is a ruling, not an implementation choice — flagged for Gary.

---

## 5. The Prisma nullable-boolean trap

**The new flag is safe. Two things near it are not.**

`compConfidential Boolean @default(false)` is NON-NULL, so `not: true`,
`equals: false` and `NOT: { ... }` all behave. No explicit OR is needed **for the
flag itself**.

But this codebase has already been bitten, and the record is worth quoting
because it is the exact trap the prompt asks about
(`src/lib/labor-salaried.ts:104-121`):

> It was `exempt: { not: true }`, which is WRONG on a nullable column … Prisma
> emits `exempt <> true`, and in SQL `NULL <> true` is NULL rather than TRUE, so
> every NOT-REVIEWED person was silently dropped.

Measured on dev 2026-08-22 and recorded at :114-118: `{ not: true }`,
`NOT: { exempt: true }` and `NOT: { person: { exempt: true } }` **all** return
only `[false]`; only `OR: [{exempt: null},{exempt: false}]` returns
`[false, null]`. The live query keeps the explicit OR (:130).

Two live hazards for COMP-1:

- **H1 — the plan query.** Any COMP-1 query that filters the salaried set will
  sit next to `person: { OR: [{ exempt: null }, { exempt: false }] }`
  (`labor-salaried.ts:130`). Adding `compConfidential` to that `where` is safe;
  **"tidying" the OR into a NOT while touching the line reintroduces the defect**
  and the fixtures are the only thing that would say so. The plan must not
  restructure that predicate.
- **H2 — the migration backfill.** "Seed ON for salaried people" has to identify
  them, and the columns available are nullable:
  `SquareTeamMemberWage.payType` is `String?` (:2778) and `annualRate` is
  `Decimal?` (:2784). The backfill must use positive tests
  (`"payType" = 'SALARY' OR "annualRate" IS NOT NULL`) and never a negation over
  a nullable column. `LaborSalariedPerson.exempt` is `Boolean?` (:2428) — if the
  backfill consults it, same rule.

Other nullable booleans in range, for the record: `SquareTeamMemberWage.isSupervisory`
(:2813), `.isOvertimeExempt` (:2793), `SquareTimecard.wageTipEligible` (:2671).
None is filtered on anywhere in `src/` today — I grepped.

---

## 6. Build plan

### Part 1 — the flag

1. `prisma/schema.prisma` — add to `SquareTeamMemberWage`, in the FROOT-OWNED
   block beside `weeklyHoursOverride` / `isSupervisory` (:2806-2814):
   `compConfidential Boolean @default(false)`, with the same "the sync's DO
   UPDATE never touches this" warning the neighbours carry.
2. `src/lib/labor-roster.ts:277-303` — **no change**, and a comment saying why:
   the column is absent from the INSERT list (so new rows take the default) and
   absent from `DO UPDATE SET` (so a resync preserves it). Adding it to either
   erases every admin's setting on the next sync.
3. Migration `<ts>_comp_confidential`, generated by `prisma migrate diff` per
   MIGRATIONS.md §3 (the prompt's Phase B block matches it), then the backfill
   appended to the same file:
   ```sql
   UPDATE "SquareTeamMemberWage"
      SET "compConfidential" = true
    WHERE "payType" = 'SALARY' OR "annualRate" IS NOT NULL;

   UPDATE "SquareTeamMemberWage" w
      SET "compConfidential" = true
     FROM "StaffMember" s
     JOIN "User" u ON u.id = s."userId"          -- ⚠ join column UNVERIFIED, see §7.3
    WHERE s."squareTeamMemberId" = w."squareTeamMemberId"
      AND s."organizationId"     = w."organizationId"
      AND u.role = 'ADMIN';
   ```
   Both statements are positive tests over nullable columns per §5/H2.
   **This backfill touches zero rows on dev** (§3.3) — the evidence for it is a
   staging row count after deploy, not a local run.
4. Admin-only write path. `PATCH /api/square/labor/roster/[id]` is the natural
   home, but it is gated at `canSeeWages` (MANAGE), not ADMIN. Ruling 2 says
   Admin only, so: extend `rosterRowPatchSchema` (`src/lib/labor-roster-hours.ts`)
   with the key and add an explicit `ctx.isAdmin` check **for that key only**,
   leaving WK HRS / SUP at MANAGE. A second route would duplicate the org-scoped
   composite lookup at :57-62 for no gain.

### Part 2 — server-side redaction

The rule, from the existing house pattern (`staff/page.tsx:66-70`, and
`permissions.ts:621-623`): **the field is ABSENT from the payload, never hidden
in the markup.**

One helper, so the answer exists once:

```ts
// src/lib/labor-roster.ts
export function compVisible(actor: PermissionUser, row: { compConfidential: boolean }) {
  return !row.compConfidential || actor.role === "ADMIN"
}
```

Applied at four sites:

| Site | Change |
|---|---|
| `labor-roster.ts:357-374` (`getStoreRoster`) | take the viewer; null `hourlyRate`, `annualRate`, `payType` on confidential rows for non-ADMIN. Return `compConfidential` itself so the UI can draw the lock. |
| `labor-roster.ts:398` (`getPayForStaff`) | same — this is `/staff` and `/staff/[id]` |
| `api/labor/salaried/route.ts:53-65` | null `weeklyCost`, `squareAnnualRateSeen`, and the per-allocation costs |
| `api/labor/salaried/route.ts` GET | **add** `estateWeeklyTotal`, computed server-side over the REAL values (§2.2) |

The engines are untouched: `resolveStoreSalariedFor` (`labor-salaried.ts:123`),
`getWeeklyDayPlan` and `computeWeeklyLaborBudget` keep reading real values, which
is ruling 3's "masked numbers still feed the budget" — and it is already true, so
the plan's job is to **not break it**, not to build it.

UI: `payText()` (`labor-settings-client.tsx:1335`) and `formatPay()`
(`labor-costs.ts:31`) both render pay and are documented as needing to agree.
Both gain the "—" + lock branch, keyed on `compConfidential`, with
`title="Confidential — visible to admins only"`.

### Part 3 — the Labor page capability

1. `permissions.ts` — add `"labor.access"` to `Capability`, `MANAGE` in `GRANTS`,
   and one `ENFORCED_CAPABILITIES` entry in the existing `Labor` area
   (`label: "Access the Labor page"`, `removes:` naming the page **and** the
   routes). No `PATCH /api/users/[id]` change: `DENIABLE` derives from the list
   (`route.ts:13`).
2. `labor-access.ts` — `requireLaborContext()` gains
   `if (!can(ctx.actor, "labor.access")) return 403` **beside** the existing role
   test at :64-67, never replacing it. This is the choke point for every
   `/settings/labor` write route (§4.5).
3. `settings/labor/page.tsx:45` — AND the new capability into the existing
   `labor.manage` guard. AND-ing only subtracts, which is the discipline
   `staff/page.tsx:61` already records.
4. `sidebar.tsx:72` — point the "Labor" entry's `capability` at `labor.access`.
5. Leave `labor.manage` held out of the grid. COMP-1 answers PERM-5C ruling 5
   with a **new** capability rather than by promoting `labor.manage`, so the
   held-out list and its reasoning stay true (§4.4).

### Gates and commits

`next build` must pass. Two commits on `staging` — work commit (including the
`DECISIONS.md` entry, per the prompt), then the roadmap recorder commit. No push.

---

## 7. What I need from Gary before Phase B

### 7.1 THE STOP QUESTION — run this in the Neon console on `br-square-feather`

```sql
SELECT current_setting('neon.branch_id') AS branch,
       w."squareTeamMemberId", w."jobTitle", w."payType",
       (w."annualRate" IS NOT NULL) AS has_annual,
       (s.id IS NULL)               AS not_in_froot
  FROM "SquareTeamMemberWage" w
  LEFT JOIN "StaffMember" s
         ON s."squareTeamMemberId" = w."squareTeamMemberId"
        AND s."organizationId"     = w."organizationId"
 WHERE w."payType" = 'SALARY' OR w."annualRate" IS NOT NULL;
```

Any row with `not_in_froot = true` is the hole the prompt says to stop on — and
it is the hole **only if the flag goes on `StaffMember`.** With the flag on
`SquareTeamMemberWage` (§3.2) the hole does not exist, which is the strongest
argument for that table. I am reporting the question rather than assuming the
answer.

### 7.2 Rulings needed

1. **Table.** Confirm `SquareTeamMemberWage`, not `StaffMember` (§3.1–3.2).
2. **Name and tier.** `labor.access` at `MANAGE` — option (b) in §4.6.
3. **Surface.** "The Labor page" = `/settings/labor` only? Or does `/labor`
   (Weekly Plan) travel with it? (§4.5 — my lean: `/settings/labor` only.)
4. **`estateWeekly`.** Confirm it moves server-side rather than being allowed to
   drop (§2.2). Ruling 3 says budget totals stay visible; this is a total.
5. **F1 — `/api/labor/positions`.** Out of scope and recorded, or in? (§1.3)
6. **DECISIONS.md.** The prompt requires confirming the entry text is what Gary
   approved in chat. I have not seen that chat. **I will not write words into
   DECISIONS.md that I cannot source** — Gary pastes the approved text, or
   confirms the four rulings as written in the prompt are verbatim.

### 7.3 One thing I could not verify

The `StaffMember → User` join used in the ADMIN half of the backfill (§6, marked
⚠) is written from the shape of the schema, not from a read of it. I did not
confirm the column name. It gets verified against `prisma/schema.prisma` before
any SQL is generated. A wrong join here fails loudly at `db execute` rather than
silently mis-seeding, but it should be right the first time.

### 7.4 Test-principal naming

Per CLAUDE.md § Name every test principal, any staging fixture this work creates
must carry `COMP-1` in its name. The prompt's test 2 asks which staging login
carries MANAGER — that is Gary's to name, and once named it should be an
existing account rather than a new fixture, so nothing needs cleaning up after.

---

## 8. Scope kept out, as text

Per the prompt's out-of-scope rule, recorded and **not** fixed:

- **F1** — `GET /api/labor/positions` returns `defaultHourlyRate` with no
  `canSeeWages` gate (§1.3).
- **F3** — `labor.view` is an inert registry entry whose own comment
  (`permissions.ts:126-128`, :245-247) overstates what it gates (§4.3). COMP-1
  does not repair that comment unless it touches the line.
- DOC-4's visibility-floor question, the global labor toggle in `/settings`, and
  all Square-side pay behaviour: untouched, per the prompt.

---

## 9. What a failure would have looked like

Per CLAUDE.md — a green result from an instrument that cannot detect the failure
is not evidence.

| Check | What a failure would have looked like | Result |
|---|---|---|
| `COMP-` free in ROADMAP.yaml | any `COMP-` match | no matches — **free** |
| Registry drives the modal | a hardcoded capability list in `user-actions.tsx` | `.map` over `ENFORCED_CAPABILITY_AREAS` :364 — **confirmed** |
| Admin-only override write | `requireUsersManage` at a MANAGE tier, or no self-guard | `ADMIN_ONLY` :168 + self-guard :120 — **confirmed** |
| Budget math server-side | `computeWeeklyLaborBudget` imported by a `"use client"` file | imported only by `labor-plan.ts`, `labor-salaried-summary.ts` — **confirmed** |
| Client aggregates over pay | none found | **one found** — `labor-settings-client.tsx:186` |
| `labor.view` enforcement | a `can(_, "labor.view")` call site | **zero** outside the sidebar's data-driven filter |
| Roster backed by `StaffMember` | `getStoreRoster` reading `staffMember.findMany` as its row source | reads `squareTeamMemberWage` :330, left-joins staff :348 — **the lean was wrong** |
| Salaried-comp hole on dev | a `SALARY` row with `not_in_froot` | **inconclusive — dev holds no rows at all**, not a pass |
