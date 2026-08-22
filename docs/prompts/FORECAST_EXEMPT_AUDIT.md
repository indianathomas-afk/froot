# forecastExempt — the blocking question, answered

**Session:** TIER 3, 2026-08-21. Audit only; nothing was built.
**Ruling ratified first:** `docs/DECISIONS.md`, "Forecast participation is a
property of the person, not of an hours value" (commit `cbab6b7`).
**Branch/commit of the code read:** `staging` at `f28558e`, working tree clean.

---

## THE ANSWER

**Individuals never enter the forecast arithmetic. The model is entirely
position-based.** A `forecastExempt` flag on `StaffMember` would suppress a
number that is never counted — it would appear to work and change nothing.

Per the instruction, this audit STOPS HERE. Items 1–6 of the plan (schema, the
unmapped gap, the two surfaces, the surface enumeration, the shared-manager
limitation, the WK HRS interaction) are **not** designed, because designing
around this finding is what the instruction forbids. The real question is what
to do about `LaborPosition`, and that is Gary's ruling.

---

## 1 · What `weeklyHoursOverride` actually feeds

**Nothing that reaches a forecast. Nothing that reaches any calculation at all.**

The complete set of touch points in `src/` (measured by grepping the column name
across `src` and `prisma`, excluding `src/generated`):

| # | Site | What it does |
|---|---|---|
| 1 | `prisma/schema.prisma:2606` | the column, `Int?` |
| 2 | `src/lib/labor-roster.ts:230` | the sync's `DO UPDATE` **deliberately omits it** |
| 3 | `src/lib/labor-roster.ts:370` | `getStoreRoster` returns it on the row |
| 4 | `src/app/api/square/labor/roster/[id]/route.ts:65` | the PATCH writes it |
| 5 | `src/app/(app)/settings/labor/labor-settings-client.tsx:711,722,750,768,1028` | the card renders and edits it |

`getStoreRoster` has exactly **one** caller —
`src/app/api/square/labor/roster/route.ts:54` — which serves the settings card
and nothing else. There is no sixth site. No engine, no route, no page, no cron
reads this column for arithmetic.

This is not an oversight; it is recorded as deliberate in three places already:
`prisma/schema.prisma:2600-2603` ("KNOWN AND LABELLED: NOTHING READS THEM YET"),
the route header, and the card's own footnote. Gary's Q9 ruling of 2026-08-19
built the editors ahead of a consumer on purpose.

---

## 2 · What `salariedHours` feeds, and where `LaborPosition` rows come from

**`budget.salariedHours` is produced at `src/lib/labor-budget.ts:74-77`:**

```
for (const p of active) {
  if (p.payType === "SALARIED" && p.impliedWeeklyHours && p.impliedWeeklyHours > 0) {
    salariedCostCents += toCents(p.defaultHourlyRate) * p.impliedWeeklyHours
    salariedHours += p.impliedWeeklyHours
```

`computeWeeklyLaborBudget` has **one production call site**:
`src/lib/labor-plan.ts:173`. Its `positions` argument is built at
`src/lib/labor-plan.ts:175` from the query at **`src/lib/labor-plan.ts:161`**:

```
prisma.laborPosition.findMany({ where: { organizationId, active: true } })
```

**`LaborPosition` is org-wide, not per-store.** `prisma/schema.prisma` shows the
model carries `organizationId` and **no `storeId`**, and **no relation to
`StaffMember`**. It is a *rate legend* — a table of role archetypes — not a
table of people. Its provenance is both seeded and user-maintained:

- **Seeded** on module enable from `src/lib/labor-positions.ts:9-13`, five rows,
  of which exactly one is salaried: `{ name: "General Manager", payType:
  "SALARIED", defaultHourlyRate: "20.00", impliedWeeklyHours: 40 }`.
- **User-maintained** through `/api/labor/positions` and
  `/api/labor/positions/[id]`, edited on the "Rate legend" tab of the same card
  that carries the roster.

Because the query is org-scoped and `getWeeklyDayPlan` runs **per store**, that
single org-wide "General Manager @ 40" row contributes **40 salaried hours to
every store's plan, independently** — nine-plus times across the estate, from one
row that names no one.

---

## 3 · Is there ANY path from a named person to a forecast figure?

**No.** `getWeeklyDayPlan` (`src/lib/labor-plan.ts:150`) is the single engine
behind the day-card hours, Schedulable, Suggested, the coverage curve and the
Rebalancer. Every database read it makes is enumerated at
`src/lib/labor-plan.ts:159-167`:

| Table | Carries a person? |
|---|---|
| `salesHourlyCache` (`:65`, `:309`, `:312`) | no |
| `salesPeriodCache` (`:101`) | no |
| `store` (`:156`) | no |
| **`laborPosition` (`:161`)** | **no — archetypes, no `storeId`, no staff relation** |
| `laborDaySplit` (`:163`) | no |
| `laborDayAdjustment` (`:164`) | no |
| `weeklyDayHours` (`:165`) | no |
| `storeHours` (`:166`) | no |

There is no `staffMember`, no `squareTeamMemberWage` and no `squareTimecard`
read anywhere in the file. Every field of `DayPlan` and `WeeklyPlan`
(`src/lib/labor-plan.ts:115-146`) derives from that list — including `hasGm`
(`:179`, `positions.some(p => p.payType === "SALARIED")`) and `gmCreditHours`,
whose 40-hour cap traces back to `impliedWeeklyHours` and to nothing else.

The three core engines are **pure — they contain no `prisma` reference at all**:
`labor-budget.ts`, `labor-coverage.ts`, `labor-daily.ts`. They cannot read a
person even in principle; they only receive what `labor-plan.ts` hands them.

The import wall holds: none of `labor-plan.ts`, `labor-budget.ts`,
`labor-coverage.ts`, `labor-daily.ts` imports `labor-schedule.ts`,
`labor-actuals.ts`, `labor-roster.ts` or `labor-inspector.ts`.

### Where individuals DO appear — and why none of it is a forecast

This is the distinction that decides the question, so it is stated explicitly
rather than left implied:

1. **The ACTUAL labor percentage** — `src/lib/labor-actuals.ts:262,339,553` reads
   `squareTimecard`, which is per-person. This is *what happened*, measured from
   clock-ins. It is not a forecast, and `weeklyHoursOverride` plays no part in it.
2. **The SCHEDULED half of the OVL-S4 comparison** —
   `src/app/(app)/labor/weekly-plan-client.tsx:347` says it outright: the
   suggested half is "the coverage engine's own output, summed; the scheduled
   half is Square's mirrored" shifts. Per-person, but it is the *observed* column
   sitting beside the forecast, never an input to it.
3. **Pay display** — `getPayForStaff` on `/staff` and `/staff/[id]`. Display only.

So people are visible all over the labor surfaces, and in exactly zero places do
they feed a forecast number.

---

## 4 · Why a flag on `StaffMember` would be decoration

Gary's ruling is that forecast participation is a property of the person. The
codebase currently has no place where a person's forecast participation is
consulted, because no person is consulted. Setting `forecastExempt = true` on
Kelton Thomas would change: the value of one boolean column. Day-card hours,
Schedulable, Suggested, the coverage curve, the forecast labor percentage and
the Rebalancer would all return byte-identical numbers, because none of them has
ever asked who Kelton is.

**That is the failure mode the instruction named — a flag that appears to work
and changes nothing — and it would be worse than no flag**, because the roster
would then carry a visible "Exempt" marker asserting an effect that does not
exist, and the next person to audit the labor numbers would trust it.

---

## 5 · The real question, handed back unanswered

The 165 "phantom" salaried hours Gary has been chasing at Las Brisas are not in
`SquareTeamMemberWage` at all. What is actually in the arithmetic is **one
org-wide row** — `General Manager`, `SALARIED`, `impliedWeeklyHours: 40` — which
contributes 40 hours to **each** store's plan.

The shapes that question could take are listed here as *inputs to Gary's ruling*,
deliberately without a recommendation, because choosing between them is the
ruling:

- Make `LaborPosition` per-store, or give it a per-store override, so a store
  with no resident GM can carry a different implied figure. (Schema change.)
- Keep it org-wide and change the seeded value or the seeding rule.
- Give the forecast a per-person input for the first time, at which point
  `forecastExempt` acquires something to suppress — this is the only branch in
  which the ratified ruling becomes implementable as written, and it is a much
  larger change than a boolean: it would put a Square-sourced, per-person input
  into a core engine, which **L-2 seam (b) currently forbids outright**
  (`docs/ROADMAP.yaml`, L-2; `docs/DECISIONS.md` 2026-08-05).
- Do nothing to the model and treat the GM's 40 as intentional, per the
  2026-08-21 ruling that scheduling hours count the whole crew, GM included.

**Note the collision in the third bullet.** Implementing Gary's ruling literally
requires crossing a seam another of Gary's rulings put there. That conflict is
real, it is not mine to resolve, and it is the single most important thing this
audit found after the blocking answer itself.

---

## 6 · Adjacent findings, recorded but not acted on

- **`StaffMember.isCorporate` already exists** (`prisma/schema.prisma`, `Boolean
  @default(false)`) and its comment already reasons about forecast leakage. If a
  person-level exemption is ever built, this is the neighbouring flag whose
  relationship to it must be settled — two booleans that both mean "not an
  ordinary store body" is how a model rots.
- **Shared managers remain unexpressible.** Kristie Connolly covers Las Brisas
  and UNR; she is *split*, and neither a boolean on her record nor the org-wide
  position row can say so. This is a property of the model, not of the proposed
  flag, and it survives every option in §5 except the per-person one. Not
  solved here, and not filed as work — it is folded into the pending ruling
  below, because the next step is a decision, not a task.
- **The unmapped "Not in Froot" rows** (four at Las Brisas, including Taylin and
  Karson at 45 and 40) have no `StaffMember` row for a flag to live on. This is
  moot under the finding — their hours reach nothing today — and is recorded
  only so that it is not rediscovered as new.

---

## 7 · Interaction with the WK HRS work (question 6, answered despite the stop)

**Independent.** Nothing in the exempt question depends on the WK HRS defects,
because the column those defects govern feeds no forecast either way.

The premise of the question is also out of date: the three defects it names
(Delete appears to restore 40, Enter does not save, 0 will not save) were
diagnosed and fixed **earlier in this same session** as BUG-12, commits
`2116965` and `f28558e`, which are local to `staging` and **not pushed**. Staging
still serves `3cfb99c`, which is why they were still observable when the prompt
was written.
