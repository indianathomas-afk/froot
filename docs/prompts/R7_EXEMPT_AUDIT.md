# Exempt — marking a person as not counting toward store labor · AUDIT AND PLAN

**Session:** TIER 3, 2026-08-22. **Audit and plan only. NOTHING WAS BUILT** —
no schema, no migration, no route, no UI, no fixture. No file outside `docs/`
was touched.
**Rulings ratified first:** `docs/DECISIONS.md` § "Absent means zero, and L-2
seam (b) is amended" (`856bd46`).
**Code read at:** `staging` `1f3eba8` (+ the ratification `856bd46`, docs only),
working tree otherwise clean.
**Deviations: S5-D41 onward — NOT S5-D36.** The prompt says "from S5-D36
onward"; `S5-D36..S5-D40` are already recorded in `docs/ROADMAP.yaml` at
`1f3eba8` (the R7-B row). Reusing them would collide exactly the way the drift
audit's `D28` collided with Gary's `floorExceedsBudget` ruling. Continuing from
`S5-D41` and flagging it rather than silently renumbering. `S5-D15..D17` remain
unrecorded and are not closed here.

---

## 0 · The answer in one paragraph, and it is not the comfortable one

**`isCorporate` is NOT the flag, but not because it means the wrong thing — it
means very nearly the right thing and is wired into fifty HR consumers, three of
which decide what gets stamped into a signed legal record.** Setting a labor
fact through it would silently change document audiences, training assignment,
compliance denominators and PDF store stamps. It also has **no write path
anywhere in the codebase**, so "reuse it" was never the cheap option. The
correct home is a third Froot-owned column on `SquareTeamMemberWage`, beside
`weeklyHoursOverride` and `isSupervisory`, because that row **exists for every
Square team member including the ones with no `StaffMember`** — which is the
only shape that solves §2's unmapped gap at all. And the honest answer to
question 3 is the one Gary asked to hear twice: **under the two rulings just
ratified, exempt changes no number today and no number after "absent means
zero" lands.** It is a gate on a system that does not exist yet. It is
separable from allocation and this session does not merge them, but it should
ship with its inertness on its face — for which this repo already has a ruling
and a precedent.

---

## 1 · `isCorporate` — what it is, and why it must not carry this

### 1.1 What it means

`prisma/schema.prisma:319-335`, and the comment is unusually explicit:

> *"DEBT-9: this person's work location is the COMPANY, not a store."*

It exists because Square has no primary-location concept: corporate staff are
`ALL_CURRENT_AND_FUTURE_LOCATIONS`, the sync expands them to one
`StoreStaffAssignment` per store (`square.ts:265-268`), and `primaryStoreName()`
would otherwise stamp *whichever store sorts first alphabetically* into a signed
legal record. **It is a HOMING fact, invented for HR document provenance.**

The forecast-leakage reasoning the R7 audit noticed is real but is about a
different leak: `hr-compliance.ts:695,724` excludes corporate members from
store-scoped compliance rollups. That is HR's denominator, not labor's.

### 1.2 It is read in ~50 places and written in ZERO

Measured by grep across `src/` and `scripts/` at `1f3eba8`. Reads span
`hr-documents-access.ts`, `hr-compliance.ts`, `hr-signed-pdf.ts`, `hr.ts`, the
training bulk-assign path, the acknowledgment ceremony, `/staff`, `/staff/[id]`
and `/my/documents`.

**Writes: none.** `PATCH /api/staff/[id]`'s `patchSchema`
(`src/app/api/staff/[id]/route.ts:8-18`) admits `displayName`, `fullName`,
`lockFullName`, `email`, `storeIds`, `primaryStoreId` — **and not
`isCorporate`.** Neither does `POST /api/staff` (`route.ts:95`), the Square sync
(`sync-square/route.ts:72`), resync, reactivate, or the Clerk webhook. **The
column can only be set by hand-written SQL.**

Measured on **branch `dev` (`ep-late-water-a6k53nv2`,
`br-broad-wave-a6vpjdw0`)**: `StaffMember` rows = 5, **`isCorporate = true` on
0 of them.** Consistent with there being no way to set it.

So "reuse `isCorporate`" was never the small change — **it needs a write path
built either way.**

### 1.3 Why a second flag is NOT redundant here, and why reuse is DANGEROUS

The R7 audit's warning — *"two booleans that both mean 'not an ordinary store
body' is how a model rots"* — is the right instinct and it points the **other
way** once the consumers are read. Setting `isCorporate` on Kelton to fix labor
would, in the same write:

| Consumer | Effect of flipping `isCorporate` |
|---|---|
| `hr-documents-access.ts:118` | returns `false` — **removes them from every store-scoped document audience** |
| `hr-compliance.ts:695,724` | **drops them out of store compliance rollups**, moving other people's percentages |
| `hr.ts:97` | `primaryStoreName()` returns `CORPORATE_STORE_LABEL` — **changes the store stamped on newly minted signed PDFs** |
| `bulk/route.ts:187` | changes who a training bulk-assign reaches |
| `/staff/page.tsx:269` | moves them into the Corporate group |

**The third row is disqualifying on its own.** `docs/DECISIONS.md` F5b makes PDF
stamps court-defensibility material. **A labor decision must not change what a
legal record says.** These two facts are correlated in Gary's estate today and
are not the same fact, and the coupling runs in the direction where the cheap
reuse causes the expensive damage.

**Verdict: do not reuse.** The relationship is recorded instead — see S5-D43.

---

## 2 · The unmapped gap — and it decides the whole design

A "Not in Froot" roster row is a `SquareTeamMemberWage` row whose
`squareTeamMemberId` matches no `StaffMember`
(`labor-roster.ts:348-357,371`). **Such a person has no `StaffMember` row, so a
column on `StaffMember` has nowhere to live for them.**

**Gary reports Karson and Taylin among them at Las Brisas. That is two of the
three people in this feature.** A `StaffMember.laborExempt` column could not
express the exemption for two thirds of its own use case.

### 2.1 The estate-wide count is NOT measured, and dev cannot answer it

**Branch `dev` (`ep-late-water-a6k53nv2`): `SquareTeamMemberWage` rows = 0.**
The wage sync has never run on dev — consistent with the recorded fact that the
dev Square grant predates `SQ-SCOPE-1`. Also on dev: `StaffMember` rows = 5;
Kelton Thomas exists (`cmqxfyjt1000004jtbfzj9jmz`, `isCorporate=false`, no wage
row); **Kristie, Karson and Taylin have no `StaffMember` row at all.**

Dev is therefore evidence about SHAPE and not about COUNT. The count must come
from the **Neon console** on `preview/staging` (`ep-odd-rain-a6gr4xmm`) and on
`production` (`ep-green-smoke-a6xthq4r`):

```sql
-- How many people are unmapped, estate-wide?
SELECT count(*) FILTER (WHERE s.id IS NULL) AS unmapped,
       count(*)                              AS total_square_members
FROM "SquareTeamMemberWage" w
LEFT JOIN "StaffMember" s
       ON s."squareTeamMemberId" = w."squareTeamMemberId"
      AND s."organizationId"     = w."organizationId"
WHERE w."organizationId" = 'cf888f2d-f234-48c7-8097-fd5b44b5b3dd';

-- Who are the salaried, and which of them are unmapped?
SELECT COALESCE(s."displayName", s."fullName", '*** NOT IN FROOT ***') AS person,
       w."jobTitle", w."annualRate", w."allLocations",
       array_length(w."locationIds", 1) AS locs, w.status, s."isCorporate"
FROM "SquareTeamMemberWage" w
LEFT JOIN "StaffMember" s
       ON s."squareTeamMemberId" = w."squareTeamMemberId"
      AND s."organizationId"     = w."organizationId"
WHERE w."organizationId" = 'cf888f2d-f234-48c7-8097-fd5b44b5b3dd'
  AND (w."payType" = 'SALARY' OR w."annualRate" IS NOT NULL)
ORDER BY w."annualRate" DESC;

-- The 5 Square locations with no Froot store, named.
SELECT DISTINCT unnest(w."locationIds") AS square_location_id
FROM "SquareTeamMemberWage" w
WHERE w."organizationId" = 'cf888f2d-f234-48c7-8097-fd5b44b5b3dd'
EXCEPT
SELECT "squareLocationId" FROM "Store" WHERE "squareLocationId" IS NOT NULL;
```

**The design below does not depend on the answer** — it works for 2 unmapped
people or 40 — but the count belongs on the record before anyone builds.

### 2.2 The options, and importing is NOT assumed

| Option | Covers unmapped? | Cost | Verdict |
|---|---|---|---|
| **(a) Import them as `StaffMember`** | yes, after the import | Creates HR *people* — they enter document audiences, training assignment and compliance denominators, and become subject to signing ceremonies. **Solving a labor problem by manufacturing HR obligations.** | **Rejected** |
| **(b) A Froot-owned column on `SquareTeamMemberWage`** | **yes, immediately** — the row exists for every Square member | one nullable column, existing route, existing card | **THE LEAN** |
| **(c) A separate exclusion table keyed by `squareTeamMemberId`** | yes | a new table + new route + new read for one boolean | Rejected as strictly more machinery than (b) for the same reach |
| **(d) `StaffMember.laborExempt`** | **NO** — two of three people have no row | one column | **Rejected on §2** |

### 2.3 Why (b) is not a novel idea — the precedent is exact

`SquareTeamMemberWage` **already carries two Froot-owned columns**
(`prisma/schema.prisma:2638-2654`) under a header that reads:

> *"── FROOT-OWNED. THE SYNC'S DO UPDATE NEVER TOUCHES THESE TWO. ──"*

- `weeklyHoursOverride Int?` and `isSupervisory Boolean?`
- The upsert's `DO UPDATE` list **deliberately omits both**
  (`labor-roster.ts:230-233`), with a comment warning that adding them would
  erase every supervisory flag on the next sync.
- They are edited by an **existing admin route** —
  `PATCH /api/square/labor/roster/[id]` — through an **existing schema**,
  `rosterRowPatchSchema` (`labor-roster-hours.ts:131-139`).
- They were built **ahead of any consumer**, by Gary's Q9 ruling of 2026-08-19,
  with the inertness stated on the card's face.

**A third such column is the same shape, the same route, the same card, and the
same ruling.** It reaches mapped and unmapped people identically because the key
is `squareTeamMemberId`, not `StaffMember.id`.

---

## 3 · What would exempt actually suppress? — **NOTHING, TODAY**

Gary asked to hear this twice if it was true. **It is true.**

### 3.1 Today, at `1f3eba8`

Salaried hours reach the forecast at exactly one place —
`labor-budget.ts:74-77`, summing `impliedWeeklyHours` over active SALARIED
`LaborPosition` rows resolved per store (`labor-plan.ts:193`). **No person is
read.** `getWeeklyDayPlan`'s nine database reads contain no `staffMember`, no
`squareTeamMemberWage`, no `squareTimecard`. Marking Kelton exempt changes the
value of one boolean and **nothing else**.

### 3.2 After "absent means zero"

Every store's salaried hours become Σ its own declarations. **Still no person is
read.** Kelton, Karson and Taylin contribute nothing before the ruling and
nothing after it — not because they are exempt, but because **they were never in
the arithmetic.**

### 3.3 So what does the flag do?

**Under the ratified rulings, the ONLY thing that would put Kelton into a
store's labor is a human writing a declaration or an allocation against him.
Exempt's job is to make that impossible — or at least visible — before it
happens.** It is a *gate on the allocation system*, and the allocation system is
next session's work.

Two things it does earn immediately, and neither is suppression:

1. **Display.** Square forces executives onto store rosters, so Kelton, Karson
   and Taylin appear on Las Brisas's roster card looking exactly like staff. A
   marked row can say *"not counted in this store's labor"* — which is true
   today and stays true.
2. **Review state.** It distinguishes *"reviewed and deliberately excluded"*
   from *"nobody has looked at this person yet"* — the same absent-vs-zero
   distinction Gary has now ruled on twice (BUG-12's WK HRS, R7's declarations).

**Stated as plainly as it can be: a flag that suppresses nothing is what the
`forecastExempt` audit caught, and this flag suppresses nothing. The difference
is that this time it is known, said out loud before the build, and there is a
consumer scheduled.** That is a materially different position from `cbab6b7`,
which was ratified believing it suppressed something. Whether that difference is
enough to build now is Gary's call, and §3.5 gives the precedent for building it
labelled.

### 3.4 Is exempt separable from allocation? **YES — and here is the test**

They are not the same statement:

- **Allocation:** *"this person contributes 50% to Las Brisas and 50% to UNR"* —
  and Gary's own invariant is that **allocations sum to 100% because she is one
  person.**
- **Exempt:** *"this person is outside the allocation system entirely."* Their
  allocations sum to **0%**, which **violates the 100% invariant**. Exempt is
  therefore not expressible as an allocation of zeros; it is the predicate that
  decides **who enters** allocation at all.

**That is a clean separation and it argues for building exempt first**: it is
the gate, allocation is the thing gated. **I am not stopping**, because they are
separable in design — but the honest qualifier is that exempt is *inert* alone,
not that it is *entangled*.

### 3.5 The precedent for shipping it inert

This exact situation has been ruled on in this repo. Gary, 2026-08-19 (Q9),
on `weeklyHoursOverride` and `isSupervisory`:

> *"KNOWN AND LABELLED: NOTHING READS THESE VALUES YET … Gary ruled to build the
> editors anyway because item 10 asks for them and because they are the storage a
> later salaried-allocation phase needs; the card says so on its face so their
> inertness is visible rather than discovered."*

**That ruling names "a later salaried-allocation phase" as the reason.** This is
that phase's gate. Building exempt now, on the same row, with the same
labelling discipline, is the same decision Gary already made for the same
reason. See **S5-D42**.

---

## 4 · Where it is set, and where it is read

**One record, one view, no second store of this state.**

### THE RECORD — `/settings/labor` → Positions card → roster tab

- **Component:** `TeamRosterView`, `src/app/(app)/settings/labor/labor-settings-client.tsx:601`
  — the store-picker roster inside `PositionsCard`. It already renders per-row
  editable `WK HRS` and `SUP` cells with card-level Save and per-row status.
- **Route:** `PATCH /api/square/labor/roster/[id]` — **already exists**, already
  gated by `requireSquareLabor()` **and** `canSeeWages(ctx.org, actor)`
  (`route.ts:36-43`), already writes only Froot-owned columns.
- **Schema:** `rosterRowPatchSchema`, `src/lib/labor-roster-hours.ts:131-139` —
  the shared client/server schema. A third optional key joins the existing two.
- **Read for render:** `getStoreRoster`, `labor-roster.ts:357-373`, which already
  returns `weeklyHoursOverride` and `isSupervisory` on every row **including
  unmatched ones** (`staffMemberId: null`). One more field on the same map.

### THE VIEW — `/staff` and `/staff/[id]`

- **Read helper:** `getPayForStaff`, `labor-roster.ts:398-424` — already queries
  `SquareTeamMemberWage` by `squareTeamMemberId` and returns a map keyed by
  `StaffMember.id`. Adding the field to its `select` and return type gives both
  pages the view **through the existing single query**.
- **Components:** `src/app/(app)/staff/page.tsx:80` and
  `src/app/(app)/staff/[id]/page.tsx:132`, both already calling it behind
  `canSeeWages`.
- **Read-only there.** `/staff` shows the fact; it does not own it.

**NO SECOND STORE IS INTRODUCED.** One column, one writer route, two readers
that already exist. Confirmed by the § "Verifying a guard covers every path"
procedure — enumerated by finding every caller of `getStoreRoster` (one:
`api/square/labor/roster/route.ts:54`) and of `getPayForStaff` (two, both
listed), rather than by grepping for the new field's name.

**One asymmetry, stated rather than smoothed:** `/staff` can only show people who
HAVE a `StaffMember` row, so **Karson and Taylin will not appear there at all.**
The record surface is the roster card precisely because it is Square-keyed and
shows everyone. The view is a convenience, not a second source of truth, and it
is incomplete by construction.

---

## 5 · Schema — additive, one nullable column

```prisma
/// Froot-only, and NOT derivable from Square. Square forces executive staff to
/// be mapped to a store location, so they appear on store rosters; this column
/// is a human saying "this person is not part of any store's labor."
///
/// NULL = NOT REVIEWED. true = excluded. false = explicitly included. The three
/// states are distinct and nothing may collapse them — `if (row.laborExempt)`
/// treats "not reviewed" and "included" identically, which is the same bug
/// MIN_WEEKLY_HOURS documents for weeklyHoursOverride. Write `!= null`.
///
/// IT LIVES HERE AND NOT ON StaffMember because Square team members who have no
/// StaffMember row still need it — measured: Karson and Taylin appear on Las
/// Brisas's roster as "Not in Froot". A column on StaffMember could not express
/// the exemption for two of the three people the feature exists for.
///
/// THE SYNC'S DO UPDATE MUST OMIT IT, exactly as it omits the two above. If a
/// later edit adds it to that list, every exemption in the org is erased by the
/// next sync, silently.
laborExempt Boolean?
```

**`Boolean?`, defaulting to `NULL`, on `SquareTeamMemberWage`.** One
`ALTER TABLE ... ADD COLUMN` — additive, no drop, no backfill, no seed, and
inert on every existing row.

**`isCorporate` is NOT sufficient** (§1.3) and is not touched.

**One deliberate difference from `isSupervisory`**, whose comment says *"the
default is false and a human sets it"*: this column keeps `NULL` meaningful
because the whole feature is *review state* (§3.3), and collapsing not-reviewed
into included would make the estate look audited when it is not. See **S5-D44**.

---

## 6 · The replacement promotion gate — B's old gate is dead

### 6.1 Why it is dead

R7-B's gate was **"the strict diff must be EMPTY."** That gate is not merely
inconvenient now — it is **guaranteed to fail**, because "absent means zero"
moves stores by design.

**It also already PASSED, and that result is still worth something.** Run this
session against Gary's AFTER capture:

```
BEFORE docs/prompts/r7_budget_BEFORE_staging_2026-08-22.jsonl  (12 lines)
AFTER  docs/prompts/r7_budget_AFTER_staging.jsonl              (12 lines)
  110 strict field comparisons · 0 mismatch(es)
  STRICT DIFF EMPTY.
  ⚠ 12 UNPAIRED FIELD(S) — `target`, present on the AFTER side only
```

**That discharges R7-B's second blocker as far as it goes: the ADDITIVE work
moved nothing.** It says nothing about the ruling that came after it. (The 12
unpaired `target` fields are the hand-built BEFORE predating that key — surfaced
by design rather than silently skipped.)

### 6.2 The replacement, in one sentence

**The reference side flips: the gate stops being `AFTER == BEFORE` and becomes
`AFTER == PREDICTED`, where PREDICTED is computed BEFORE the deploy, from the
BEFORE capture and the pure engine, and signed off line by line.**

The strict FIELD SETS do not change at all — same fields, same exclusions, same
`totalSchedulableHours` / `adjustedTotalSchedulableHours` separation. **What
changes is what the AFTER is compared against.** That is the smallest possible
change to a gate that is already built and already proven.

### 6.3 The manifest, computed now from the BEFORE capture

**Fully derivable without deploying anything** — `salariedCost` drops to 0, and
the pure engine gives the rest. Week 2026-08-10:

```
store                 | salariedHrs | salariedCost | hourlyHours     | totalSched      | blended
----------------------|-------------|--------------|-----------------|-----------------|--------
Carson                | 40 ->  0    |  800 ->   0  | 137.5 -> 193.0  | 177.5 -> 193.0  | 14.5 (unchanged)
Las Brisas            | 40 ->  0    |  800 ->   0  | 193.0 -> 248.0  | 233.0 -> 248.0  | 14.5 (unchanged)  <-- KRISTIE
Meadowood Mall        | 40 ->  0    |  800 ->   0  | 137.5 -> 193.0  | 177.5 -> 193.0  | 14.5 (unchanged)
South Reno            | 40 ->  0    |  800 ->   0  | 165.5 -> 220.5  | 205.5 -> 220.5  | 14.5 (unchanged)
UNR                   | 40 ->  0    |  800 ->   0  |  13.5 ->  68.5  |  53.5 ->  68.5  | 14.5 (unchanged)  <-- KRISTIE
Default Test Account  | no forecast — budget:null, unchanged
Southgate             | no forecast — budget:null, unchanged
Spanish Springs       | no forecast — budget:null, unchanged
Sparks                | no forecast — budget:null, unchanged
Tahoe Lemonade        | no forecast — budget:null, unchanged
The Palomino Club     | no forecast — budget:null, unchanged
University Village    | no forecast — budget:null, unchanged

5 budgeted stores move · 7 null stores unchanged · 12 lines
blendedHourlyRate stays 14.5 everywhere — D24's canary is UNAFFECTED by this ruling
```

**Note what does NOT move: `blendedHourlyRate`.** D24's rate canary survives the
re-baseline intact and stays an exact-equality assertion. Only the salaried
canary (`800`/`40`) has to be re-expressed.

### 6.4 THREE FINDINGS THE MANIFEST SURFACES, and the first is a hazard

**(i) LAS BRISAS AND UNR GO TO ZERO TOO — and that is WRONG.** Kristie really
does work there. Gary's ruling says *ten* stores stop being charged; the estate
has twelve; **the two he is not counting are hers.** So the manifest is only
correct if **Las Brisas and UNR carry declarations at the moment of promotion.**
Promote "absent means zero" without them and two real stores lose a real
manager. **This is a sequencing constraint, not a design question** — see
**S5-D45**.

**(ii) STAGING CANNOT DEMONSTRATE THE FULL RE-BASELINE.** Only 5 of 12 staging
stores carry a forecast; the other 7 have `budget:null` and cannot move.
**Forecast goals are per-environment data** — stored `GoalPlan` rows per Neon
branch, which a code deploy does not carry — so **production will move more
stores than staging can show.** The manifest must be computed and signed off
**against production's own BEFORE capture**, not extrapolated from staging's
five. See **S5-D46**.

**(iii) THE HOURS-ONLY DECLARATION CANNOT EXPRESS KRISTIE'S COST — and this is
allocation's problem, flagged and NOT designed here.** Cost is
`archetype rate × declared hours` (`labor-budget.ts:75`), and the archetype is
$20/hr. Kristie is $52,000/yr = $1,000/wk; her half-share is $500/wk. Declaring
20 hours at Las Brisas charges **$400, not $500**. Declaring 25 hours charges
$500 but asserts hours she does not work at that store. **The hours and the
dollars cannot both be right through a rate that is not hers.** D18 forbids a
rate on the declaration table, deliberately. **This lands squarely in the next
session and is recorded here only so it is not discovered there.** Not designed.
Not merged.

### 6.5 What changes in `scripts/capture-labor-budget.ts`

Small, and mostly additive:

- **NEW `predict` command.** Reads a BEFORE capture, applies a named
  transformation (`--rule absent-means-zero`, plus `--declare <storeName>=<hours>`
  for stores that will carry declarations at promotion), and emits a PREDICTED
  file **in the identical format**, so S5-D25's same-format rule holds across all
  three files.
- **`diff` gains `--expect <predicted.jsonl>`.** With it, AFTER is compared
  against PREDICTED instead of BEFORE; without it, behaviour is byte-unchanged.
- **NEW `manifest` command** — renders BEFORE → PREDICTED as the per-store
  sign-off table in §6.3. **This is the artifact Gary signs, and it is produced
  before the deploy, not after.**
- **The strict field sets do not change.** Neither do the exclusions, the
  `totalSchedulableHours` assertions, or the S5-D34 same-day promotion.
- **`--rule` is recorded in the PREDICTED file's header**, so a later reader can
  see which transformation was asserted rather than inferring it from the numbers.

**The sequence becomes:** capture BEFORE (production) → `predict` → `manifest` →
**Gary signs line by line** → deploy → capture AFTER → `diff --expect`. An empty
diff then means *"the estate moved exactly as predicted and signed"*, which is a
strictly stronger statement than *"nothing moved"*.

**Proposed, not implemented.**

---

## 7 · Deviations proposed

Numbered from **S5-D41**, not S5-D36 — see the header. **All are proposals.
Nothing is built.**

- **S5-D41** — **The flag lives on `SquareTeamMemberWage`, not `StaffMember`.**
  It is the only home that reaches the unmapped people, who are two of the three
  the feature exists for. Third Froot-owned column beside `weeklyHoursOverride`
  and `isSupervisory`; the sync's `DO UPDATE` must omit it.
- **S5-D42** — **It ships INERT and says so on its face**, under Gary's own Q9
  precedent of 2026-08-19. It suppresses no number today and none after "absent
  means zero"; its consumer is next session's allocation. The card must state
  that, so the inertness is visible rather than discovered.
- **S5-D43** — **`isCorporate` is NOT reused, and the relationship is recorded
  in both columns' comments.** Reuse would change document audiences, compliance
  denominators and — disqualifyingly — the store stamped on signed PDFs. The two
  facts are correlated in Gary's estate and are not the same fact.
- **S5-D44** — **`Boolean?` with `NULL` = not reviewed**, distinct from `false` =
  explicitly included. The feature is review state; collapsing them makes the
  estate look audited when it is not. `!= null`, never truthiness.
- **S5-D45** — **SEQUENCING, AND IT IS A HAZARD, NOT A PREFERENCE.** "Absent
  means zero" must not promote before Las Brisas and UNR carry declarations, or
  Kristie's two real stores lose a real manager. The manifest makes this visible;
  the gate should refuse a PREDICTED file in which a store known to carry a
  salaried person resolves to zero.
- **S5-D46** — **The manifest is computed and signed against PRODUCTION's BEFORE
  capture.** Staging can only demonstrate 5 of 12 stores because forecast goals
  are per-environment data. A staging sign-off would understate the estate.
- **S5-D47** — **The gate flips its reference side, not its field sets.**
  `AFTER == PREDICTED` replaces `AFTER == BEFORE`; strict fields, exclusions and
  the `totalSchedulableHours` separation are all unchanged. `predict`,
  `manifest`, and `diff --expect` are the three additions.

---

## 8 · What this audit does NOT establish

- **Nothing was built.** No schema, migration, route, UI or fixture. The Prisma
  block in §5 and the commands in §6.5 are proposals written out.
- **The estate-wide unmapped count is NOT measured.** Dev holds zero
  `SquareTeamMemberWage` rows. §2.1 carries the paste-ready Neon SQL for
  `preview/staging` and `production`. The design does not depend on the number,
  but the number belongs on the record.
- **Kristie's allocation is NOT designed**, and §6.4(iii)'s rate-vs-hours finding
  is recorded, not solved. Exempt and allocation are separable (§3.4) and were
  not merged.
- **§6.3's manifest is STAGING's**, week 2026-08-10, derived from the committed
  BEFORE capture and the pure engine. It is arithmetic, not an observation of a
  deployed system, and production's manifest will differ and must be computed
  separately.
- **No claim is made that exempt suppresses anything.** §3 says the opposite, in
  the terms Gary asked for.
- **The seam amendment's boundary-test restatement is owed, not done.** Marked on
  L-2 in `856bd46`; whoever builds allocation owes it.
