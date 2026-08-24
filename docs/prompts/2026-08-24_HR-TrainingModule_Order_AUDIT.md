# TrainingModule display order — Phase 0 audit

**Date:** 2026-08-24 · **Tier:** 3 (declared, not re-declared downward)
**Order:** `docs/prompts/2026-08-24_HR-TrainingModule_Order.md`
**Status:** audit only. No source file created or edited. STOPPED for approval and ruling.

A claim wholesale. Not edited after the fact; corrections live on the roadmap row.

---

## 0 · Both opening gates FAILED. Nothing below was built.

The §0 opening command tripped two of its four STOP conditions.

```
=== branch/head ===
main
04a4bf4 DEPLOY_LOG: 2026-08-24 production promotion (DOC-3 linked documents and instructions)
=== level with main? ===
2	0
=== clean? ===
?? docs/prompts/2026-08-24_HR-TrainingModule_Order.md
?? docs/prompts/2026-08-24_HR-TrainingModule_Order_SESSION_PROMPT.md
```

**Gate 1 — not on `staging`.** HEAD is `main`. Expected; this repo opens sessions on `main`.

**Gate 2 — `staging` is BEHIND `main` by 2 commits.** `git rev-list --left-right --count
main...staging` = `2 0`: main has two commits staging lacks, staging has none main lacks.

```
04a4bf4 DEPLOY_LOG: 2026-08-24 production promotion (DOC-3 linked documents and instructions)
607926b Merge branch 'staging'
staging head: 14e3163 DOC-3: §4h complete on the fixed code — the row moves to verified...
origin/staging = 14e3163   origin/main = 04a4bf4   (both branches match their remotes)
```

**The content delta is one documentation file:**

```
=== git diff --stat staging..main ===
 docs/DEPLOY_LOG.md | 4 ++--
 1 file changed, 2 insertions(+), 2 deletions(-)
```

This is the ordinary aftermath of yesterday's promotion: `staging` merged into `main`, then
the deploy-log entry written on `main`. **`src/` and `prisma/` are byte-identical between the
two branches**, which is why the code findings below are valid as read — but the gate is real
and the order says STOP, so it is Gary's to clear, not mine.

**Gate 3 — dirty tree.** Two untracked files, both the order documents Gary added today.
Trivial, but named because §0 lists it as a STOP.

**Gate 4 — `orderIndex` on `TrainingModule`?** PASSES. It does not exist. See §2.

### What clearing the gates takes (Gary's call, no command run)

```bash
(cd ~/Claude_Projects/Froot/froot || { echo "*** CD FAILED ***"; exit 1; }
 git checkout staging
 git merge --ff-only main)
```

`--ff-only` is safe here: staging has no commits of its own, so the merge is a
fast-forward and cannot produce a merge commit or a conflict. The two untracked
order documents carry across a checkout untouched.

---

## 1 · The surface table, re-verified — and it is WRONG in two places

Every line below is a fresh read at the stated `file:line`. The order's §1 table is in the
"claimed" column.

| # | Surface | `file:line` | Actual module sort | §1 table claimed | Verdict |
|---|---|---|---|---|---|
| 1 | ADMIN list API (`GET /api/hr/training`) | `src/app/api/hr/training/route.ts:65` | `createdAt asc` | `createdAt asc` @ `:65` | ✅ correct — **edit** |
| 2 | Assign-dialog picker (staff detail) | `src/app/(app)/staff/[id]/page.tsx:496` | `title asc` | `title asc` @ `:496` | ✅ correct — **edit** |
| 3 | Read-only library API (STORE/MANAGER) | `src/app/api/hr/training/library/route.ts:62` | `createdAt asc` | `createdAt asc` @ `:62` | ✅ correct — **edit** |
| 4 | Export (CSV + JSON) | `src/app/api/hr/training/export/route.ts:37` | `createdAt asc` | `createdAt asc` @ `:37` | ✅ correct — **edit** |
| 5 | Bulk assign | `assignments/bulk/route.ts:225` | — | `createdAt desc` | ❌ **MISATTRIBUTION — not a module surface** |
| 6 | Assign validation lookup | `assignments/route.ts:35` | none (no `orderBy`) | not listed | ➖ not an ordering surface |
| 7 | **Trainee's own list (`/my/training`)** | `src/app/(my)/my/training/page.tsx:34` | assignment `createdAt desc` | **not listed** | 🔴 **MISSING — and it is the one that matters most** |
| 8 | Staff-detail assignment list (admin view) | `src/app/(app)/staff/[id]/page.tsx:483` | assignment `createdAt desc` | not listed | 🟠 same class as #7 — needs a decision |
| 9 | Compliance rollup | `src/lib/hr-compliance.ts:331` | none | not listed | ➖ aggregate; order irrelevant |

### #5 — the bulk-assign row is a misattribution

`assignments/bulk/route.ts:225` orders **`TrainingAssignment`**, not `TrainingModule`, and
it is race-loser detection, not display:

```ts
// bulk/route.ts:221-226
const rows = await prisma.trainingAssignment.findMany({
  where: { trainingModuleId: trainingModule.id, staffMemberId: { in: toCreate } },
  select: { staffMemberId: true },
  orderBy: { createdAt: "desc" },
})
```

Bulk assign takes **one** `trainingModuleId` (`bulk/route.ts:13,53`) and the dialog is opened
from a module row with that id already bound (`bulk-assign-dialog.tsx:97`). It never renders a
module list, so it has no module order to get wrong. **Nothing to edit here.** The order's
"four different sorts across five surfaces" is really **three sorts across four surfaces** — plus
the two the table missed.

### #7 — the surface the §0 grep structurally could not find

The §0 sweep greps `trainingModule.findMany`. `/my/training` queries
**`trainingAssignment`** and reaches the module through an `include`, so no grep of
`trainingModule.findMany` can ever surface it:

```ts
// (my)/my/training/page.tsx:20-34
const assignments = await prisma.trainingAssignment.findMany({
  where: { staffMemberId: self.staffMember.id },
  include: { trainingModule: { select: { title: true, subject: true, ... } }, ... },
  orderBy: { createdAt: "desc" },     // ← newest ASSIGNMENT first
})
```

This is the page `tommy@keva.com` opens, and it is **the only surface where teaching order
is the point** — a trainee reading "Day 1 (Module 1 & 2)" then "MODULE 3". Today it sorts by
when someone happened to click Assign, **newest first**, so a module assigned later appears
above Day 1. Fixing modules 1–4 while leaving this one is fixing the shop window and not
the shop.

The order's §6 acceptance check 3 — *"`tommy@keva.com`: staff-facing training surface shows
the same order"* — **cannot pass without editing this file.** So it is in scope by the order's
own gate even though its §1 table and §4 instruction do not name it. I am treating §6 as
governing and planning the edit. Flagged rather than assumed.

### #8 — the same class, admin-side

`staff/[id]/page.tsx:483` lists one staff member's assignments to an admin, also
`createdAt desc`. Not required by any §6 check. Recommendation and lean in §5, ruling 3.

---

## 2 · Schema facts, read from `prisma/schema.prisma` (not memory)

```prisma
model TrainingModule {
  id             String   @id @default(cuid())
  organizationId String            // ← the org-scoping column
  title          String
  subject        String?           // subtitle, NOT a category (Gary, 2026-08-10)
  categoryId     String?           // ← the category column — NULLABLE
  description    String?
  appliesTo      String   @default("all")
  isActive       Boolean  @default(true)
  isArchived     Boolean  @default(false)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  category       TrainingCategory? @relation(..., onDelete: Restrict)
  @@index([organizationId])
  @@index([categoryId])
}
```

- **Org column: `organizationId`** (NOT `orgId` — the order's §3 backfill SQL says
  `"orgId"`, which would fail. Corrected in §3 below).
- **Category column: `categoryId`, and it is NULLABLE.** This is the fact the ruling turns on.
- **No ordering column exists.** Gate 4 passes.
- `TrainingLesson.orderIndex` already exists and is the working precedent
  (`route.ts:49`, `export/route.ts:28`).

### Measured data — `ep-late-water-a6k53nv2` (Neon `dev` branch, local `.env`)

```
HOST: ep-late-water-a6k53nv2-pooler.us-west-2.aws.neon.tech
TOTAL MODULES: 2      UNCATEGORIZED: 2      ARCHIVED: 0
  cf888f2d | cat=NULL | arch=false | Keva Employee Training Guide Day 1
  cmqvpe2b | cat=NULL | arch=false | HR7 C4 Cert Module
CATEGORIES: 24 rows across 4 orgs (six seeded names per org:
  New Hire Training, Manager Training, Procedures Training,
  Operations Training, Product Training, Smoothie Training)
```

**100% of modules on `dev` are uncategorized while 24 category rows sit unused.** Staging
and production were not queried — staging/production credentials are not pulled to disk
(DECISIONS.md 2026-07-28) and `vercel env pull` is banned repo-wide. The nearest recorded
figures, from the ROADMAP HR-24 row: **staging `br-square-feather` — 5 modules, 3 of 5
uncategorized; production — 12 modules.** Both point the same way as the dev measurement.

---

## 3 · The plan

### 3.1 Migration — `prisma/migrations/20260824T_hr29_training_module_order/migration.sql`

Hand-authored per `docs/MIGRATIONS.md` (`migrate dev` is broken, P3018). Timestamp fixed at
authoring time; it must sort after `20260824193000_doc3_document_links_and_instructions`.

```sql
-- AlterTable
ALTER TABLE "TrainingModule" ADD COLUMN "orderIndex" INTEGER NOT NULL DEFAULT 0;
```

Additive, nullable-free, defaulted — no table rewrite risk, no existing row can fail it.

### 3.2 Backfill — in the SAME migration file, below the ALTER

**Recommendation: in the migration, not a script.** Three reasons. (a) `migrate deploy` runs
in the Vercel build, so staging and production each get the seed exactly once, automatically,
with no separate human step to forget on the promotion. (b) A default of `0` across every row
means the window between ALTER and backfill is a window where every surface shows an
arbitrary tie — keeping them in one transaction closes it. (c) It is idempotent-by-construction:
`ROW_NUMBER()` recomputes the same answer from `createdAt`, which never changes.

**Seed: `createdAt asc`, partitioned by org.** This preserves exactly what admins see on
/hr/training today (`route.ts:65`), so the deploy changes no visible order anywhere until
someone drags. Note it does *not* preserve the Assign dialog's order (`title asc`) — that
dialog is the one the order's §1 names as the visible symptom, and it is *meant* to change.

`"orgId"` in the order's §3 draft is corrected to `"organizationId"`:

```sql
-- GLOBAL (the lean):
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY "organizationId" ORDER BY "createdAt" ASC, "id" ASC
  ) - 1 AS rn
  FROM "TrainingModule"
)
UPDATE "TrainingModule" t SET "orderIndex" = ranked.rn
FROM ranked WHERE t.id = ranked.id;
```

`, "id" ASC` added as a total tie-break: `createdAt` is `DateTime` and two modules created in
the same import can share a millisecond, which would make `ROW_NUMBER()` non-deterministic
between the staging run and the production run — the same row landing at a different index in
each environment. One clause removes the whole class.

**PER_CATEGORY variant** (only if ruled that way) — `PARTITION BY "organizationId",
"categoryId"`. Postgres `PARTITION BY` treats all NULLs as one group, so every uncategorized
module lands in a single partition. That is the ruling's problem, not the SQL's; see §4.

Then `npx prisma generate`. Applied to **`br-square-feather` (`ep-odd-rain`) only**, proved
with a query whose output names the `ep-` host.

### 3.3 Endpoint — `src/app/api/hr/training/reorder/route.ts`, `PATCH`

- **Auth: `requireHrTrainingAccess()`** from `src/app/api/hr/training/access.ts:11` — the same
  helper `route.ts` uses on its `PATCH`/`POST` write paths. It is ADMIN-only at `access.ts:32`
  (`viewer.dbUser?.role !== "ADMIN"` → 403) behind `hrModuleAvailable` (404) and
  `requireModule("hr")` (403). MANAGER and STORE get 403 from the existing line; no new gate.
- **Validation: `zod`**, the folder's schema lib (`schemas.ts:1`, and every route in the folder).
  Body `{ ids: z.array(z.string().min(1)).min(1) }`, plus `category: z.string().nullable()`
  only under PER_CATEGORY.
- **Duplicate ids rejected** — `new Set(ids).size !== ids.length` → 400. Not in the order's
  spec; without it two positions collide silently and the count check still passes.
- **One `findMany`** scoped to `organizationId: access.org.id` (and `categoryId` under
  PER_CATEGORY), selecting `id`. If `found.length !== ids.length` → **400, write nothing**.
  Whole request rejected — a foreign id kills it, not just itself.
- **Completeness check**: the sent list must be the *whole* scope, else positions written are
  meaningless. `found.length !== ids.length` catches ids-not-in-scope; the reverse
  (scope rows the client omitted) is what ruling 2 in §5 is about.
- **One `$transaction`** of `update` calls setting `orderIndex = position`. Return the new list.
- **Archived/inactive**: client sends the active set only; archived rows keep their existing
  index and settle by the `createdAt` tie-break inside their own tab. Tabs are mutually
  exclusive (`training-client.tsx:107,127`) so a stale index in the archived tab is never
  interleaved with a live one on screen. The one place they do mix is
  `export?includeArchived=true` — deterministic there, just not meaningful, which is
  acceptable for a data dump.

### 3.4 Drag UI — `src/app/(app)/hr/training/training-client.tsx`

Copied from the lesson reorder in `src/app/(app)/hr/training/training-form.tsx`:

| Piece | Source `file:line` |
|---|---|
| imports (`DndContext`, `PointerSensor`, `closestCenter`, `DragEndEvent`) | `training-form.tsx:15` |
| imports (`SortableContext`, `verticalListSortingStrategy`, `useSortable`, `arrayMove`) | `training-form.tsx:16` |
| `useSortable` row + drag style (opacity 0.5, shadow, zIndex 10) | `training-form.tsx:213-222` |
| sensor (`PointerSensor`, `activationConstraint: { distance: 8 }`) | `training-form.tsx:464` |
| `handleDragEnd` + `arrayMove` | `training-form.tsx:466-475` |
| `<DndContext>` / `<SortableContext>` wrapper | `training-form.tsx:891-908` |
| `GripVertical` handle icon | `training-form.tsx:6, 239` |

`@dnd-kit` is already a dependency. No new package. Optimistic `arrayMove` → `PATCH` →
on failure revert to the pre-drag array and raise the page's existing toast.

**LIST VIEW ONLY — and this is a deviation from HR-21's card/list parity rule, named here
rather than discovered later.** The list renders twice: a 3-column card grid
(`training-client.tsx:707`) and a table (`:769`). `training-form.tsx` uses
`verticalListSortingStrategy`, which is correct for the table and wrong for a grid — a grid
needs `rectSortingStrategy`, i.e. a *second* dnd approach, which §5 of the order forbids
("no second approach"). Recommendation: the handle appears in the **table view only**; the
card grid **reads** the new order but offers no handle, with the view toggle as the route to
reordering. Parity of *result* is kept; parity of *affordance* is not. If Gary wants the handle
in the card grid too, that is `rectSortingStrategy` and it should be said now.

Gate: `canManage` — the same flag guarding the page's create/edit/checkbox controls
(`training-client.tsx:280, 712, 771`), which is ADMIN.

### 3.5 The per-surface edits

| # | `file:line` | From | To |
|---|---|---|---|
| 1 | `api/hr/training/route.ts:65` | `{ createdAt: "asc" }` | `[{ orderIndex: "asc" }, { createdAt: "asc" }]` |
| 2 | `(app)/staff/[id]/page.tsx:496` | `{ title: "asc" }` | `[{ orderIndex: "asc" }, { createdAt: "asc" }]` |
| 3 | `api/hr/training/library/route.ts:62` | `{ createdAt: "asc" }` | `[{ orderIndex: "asc" }, { createdAt: "asc" }]` |
| 4 | `api/hr/training/export/route.ts:37` | `{ createdAt: "asc" }` | `[{ orderIndex: "asc" }, { createdAt: "asc" }]` |
| 7 | `(my)/my/training/page.tsx:34` | `{ createdAt: "desc" }` | `[{ trainingModule: { orderIndex: "asc" } }, { trainingModule: { createdAt: "asc" } }]` |
| 8 | `(app)/staff/[id]/page.tsx:483` | `{ createdAt: "desc" }` | same as #7 — **pending ruling 3** |

Prisma orders through a to-one relation natively, so #7/#8 need no extra query. Under
PER_CATEGORY, `{ category: { name: "asc" } }` is prefixed on the staff-facing merged
surfaces (#3, #7) — `categoryId asc` would order by cuid, which is meaningless to a reader.

**No client-side module sort exists to delete.** The only `.sort()` in the training UI is
`training-client.tsx:362`, over *category chip names*, and it stays.

Verification after Phase 2: re-run the §0 grep; every module `orderBy` reads `orderIndex`.

---

## 4 · THE RULING — GLOBAL or PER_CATEGORY

**Lean: GLOBAL, and the measurement is what makes it lopsided rather than close.**

**The case for GLOBAL.** Ordering is a property of the *curriculum*, not of a filing label.
Categories are a NULLABLE display field that Gary already ruled is not a permission input
and not a mirror of anything (HR-24 R-j; the `subject` comment in the schema). A module
that gets recategorized keeps its place in the sequence, because its place was never
category-dependent. One index per org, one endpoint contract, one backfill partition.

**The case for PER_CATEGORY.** It matches what the chips present: the library reads as
buckets, so ordering inside a bucket is what an admin filtering to "New Hire Training"
expects to be arranging.

**What the data does to that case.** Every module on `dev` is uncategorized (2 of 2), and the
recorded staging figure is 3 of 5. PER_CATEGORY would therefore ship as a single giant
NULL-category bucket — **functionally identical to GLOBAL on day one, at the cost of a
permanent trap**: the day someone categorizes a module, it leaves the bucket its index was
computed in and lands in another one, at an index that means nothing there. Teaching order
silently scrambles, and the trigger is an unrelated cosmetic edit. GLOBAL has no such state:
recategorizing moves a badge and nothing else.

There is an "Uncategorized" chip (`training-client.tsx:573-581`), so PER_CATEGORY is at least
*addressable* — the NULL bucket can be selected and dragged. It is not blocked, it is just
buying a failure mode for a benefit that today's data says is zero.

**The two-category staffer — the consequence Gary asked to be priced.** Tommy is assigned
"Day 1 (Module 1 & 2)" and "MODULE 3" from New Hire Training, plus "How to assemble a
Crathco Bubbler" from Equipment & Procedures. On `/my/training` he sees one flat list;
there are no chips on that page.

- **Under GLOBAL** his list is one sequence in one authored order. An admin who wants the
  Bubbler read after Day 1 but before Module 3 drags it there and it stays there. The list
  reads as a curriculum.
- **Under PER_CATEGORY** there is no single ordering to render — his modules carry indices
  from two different numbering spaces, and `New Hire #1` versus `Equipment #0` is not a
  comparison, it is a collision. `/my/training` must then impose a category order *on top* of
  the module order, so the fix becomes "sort by category, then by index" — and now
  **category ordering is a new unruled problem** (alphabetical? a `sortOrder` on
  `TrainingCategory`? another schema column, another row). The interleaving an admin most
  wants — one equipment module dropped into the middle of the new-hire sequence — becomes
  **unexpressible**, because cross-category interleaving is precisely what per-bucket indices
  cannot represent.

That last point is the decisive one: PER_CATEGORY does not just complicate the trainee's
list, it removes an arrangement an operator would plausibly want, and it drags a second
schema decision along behind it.

**Recommendation: GLOBAL.** With GLOBAL, the chip filter is a *view* over one order and the
drag handle is disabled while a filter narrows that view — which is exactly what §5 of the
order already specifies, and it only reads naturally under GLOBAL.

**This is Gary's to rule. Nothing in §3 runs until it is in `docs/DECISIONS.md` in his words.**

---

## 5 · Two further rulings the order does not cover

### Ruling 2 (blocking — it changes the endpoint contract): the TAB is a filter too

§5 of the order gates the drag handle on the **category chips**. It does not mention the
**tabs**, and `/hr/training` has three: Active / Inactive / Archived
(`training-client.tsx:107,127,341`). The visible list is a **double** filter — tab × chip — so
even with every chip cleared, the Active tab is still a *subset* of the org's modules.

That matters because §4's endpoint writes `orderIndex = position` over the ids it receives.
Hand it the active subset and it writes `0..k-1` over rows whose org already holds a dense
`0..N-1` from the backfill — the indices collide with the inactive and archived rows.
Collisions resolve deterministically via the `createdAt` tie-break, so nothing breaks, but the
archived tab's order shifts as a side effect of a drag in the active tab, which no one asked for.

**Lean: scope a reorder to the Active tab.** The handle is enabled only on the **Active tab
with no chip filter**; the endpoint scopes its `findMany` to
`{ organizationId, isActive: true, isArchived: false }` and writes a dense `0..k-1` over
exactly that set. Tabs are mutually exclusive on screen, so a stale index in another tab is
never rendered beside a fresh one. Every staff-facing surface (#3, #7) shows live modules
only, so this is precisely the set they read. Inactive and archived rows keep their backfilled
index and sort by tie-break within their own tab.

The alternative — a positional splice that re-inserts the sent ids into the org's full ordering
— preserves unsent rows exactly but is materially more code for a case (reordering archived
modules) with no user demand.

**Consequence to accept either way:** reactivating an archived module drops it wherever its
stale index falls in the live list, not at the end. Under the lean, an admin fixes it with one
drag. Worth a sentence in the roadmap notes; not worth a mechanism.

### Ruling 3 (non-blocking): does surface #8 move with #7?

`staff/[id]/page.tsx:483` is the admin's view of one staff member's assignments,
`createdAt desc`. **Lean: yes, change it with #7** — an admin checking Tommy's progress
against a curriculum wants the curriculum's order, and leaving the two views of the same
data on opposite sorts is the exact defect this row exists to close. One line, same shape.
If Gary would rather keep "most recently assigned first" for the admin, say so and #8 stays.

---

## 6 · Triage

**FIX NOW — 0.** Nothing found is both broken and inside this row's blast radius.

**RULING NOW — 3.**
1. **GLOBAL vs PER_CATEGORY** (§4). Lean: **GLOBAL**. The row's premise; nothing runs without it.
2. **Reorder scope vs tabs** (§5). Lean: **Active tab, no chip filter; endpoint scopes to the
   live set.** Blocking — it is the endpoint's contract.
3. **Does `staff/[id]/page.tsx:483` move with `/my/training`?** (§5). Lean: **yes.**
   Non-blocking; #8 is dropped from the plan if the answer is no.

Plus three plan decisions taken on evidence, flagged for veto rather than ruled:
- `/my/training` (#7) is **in scope**, because §6 check 3 cannot pass otherwise (§1).
- Backfill lives **in the migration**, with `, "id" ASC` added for cross-environment determinism (§3.2).
- Drag handle is **table view only**; the card grid reads the order but has no handle — a
  named deviation from HR-21 card/list parity (§3.4).

**COMMENT — 2.** Recorded on the row per DEBT-84, not filed as rows.
1. The order's §1 table misattributes `bulk/route.ts:225`, which orders `TrainingAssignment`
   for race-loser detection. Bulk assign carries a single module id and has no module list.
   The real count is three sorts over four module surfaces, plus two assignment surfaces the
   table missed.
2. The order's §3 backfill SQL says `"orgId"`; the column is `"organizationId"`. As written it
   errors. Corrected in §3.2.

**ROW — 1.** Last resort, and it is the one the order instructs be filed and not built.

| | |
|---|---|
| **id** | `HR-29` (next free: highest is HR-28; DEBT is at 84) |
| **title** | Training sequence enforcement — module N+1 stays locked until N is complete |
| **status** | `planned` — filed, deliberately not built |
| **depends on** | this row (`orderIndex` is the sequence it would enforce) |
| **scope** | Gate a trainee's access to module N+1 on completion of module N, using the `orderIndex` sequence this row introduces. Trainee-facing only. |
| **open questions** | (a) What happens to someone **mid-sequence** when an admin reorders — does an already-completed module ahead of them re-lock? (b) Is there a **trainer override**, and is it per-assignment or per-person? (c) Does a locked module **still appear** in the list greyed out, or vanish? (d) Does the lock follow **assignment order or module order** for a trainee assigned only modules 2 and 5? (e) Does it interact with **categories** — one sequence per org, or one per category (inherits whatever §4 rules)? |
| **not in scope** | Any change to who may see or assign a module. |

Counts: **FIX NOW 0 · RULING NOW 3 · COMMENT 2 · ROW 1.**

---

## 7 · What Gary's reply needs to carry

1. **Clear the gates** — approval to `git checkout staging` and `git merge --ff-only main`
   (§0), or an instruction to proceed some other way.
2. **Ruling 1 in his own words** — GLOBAL or PER_CATEGORY. Appended verbatim to
   `docs/DECISIONS.md` as a dated `## … — 2026-08-24 (Gary)` entry in the file's existing
   style, newest at top. That entry is the ratification.
3. **Ruling 2** — reorder scope against the tabs.
4. **Ruling 3** — whether `staff/[id]/page.tsx:483` moves.
5. **Approval of the backfill SQL** as corrected in §3.2, including that it lives in the
   migration and is applied to `br-square-feather` (`ep-odd-rain`) only.
6. Veto or acceptance of the three flagged plan decisions in §6.

Nothing below Phase 0 runs until all six land.
