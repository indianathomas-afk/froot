# TPL-2 — steps (1) and (2): audit and execution plan

**Written:** 2026-08-08
**Repo:** `~/Claude_Projects/Froot/froot`
**Branch:** `staging`
**HEAD at audit:** `cc837db` (clean tree, level with `origin/staging`)
**Scope of this document:** TPL-2 steps (1) *stop writing the legacy string* and
(2) *migrate the read sites to `templateType.name`*. **Step (3), deprecating or
dropping the column, is explicitly NOT authorised by this session** and is not
planned here beyond noting what it inherits.

Every claim below was re-verified by reading the files at `cc837db`.
`docs/prompts/TYPE-1_AUDIT.md` was audited at `2d5b93d`, **before TPL-1b
landed**, so its line numbers have moved and one of its six read sites has
already migrated. The corrections are marked ⚠ in place.

This is a claim wholesale and is not edited afterwards.

---

## 0. Headline

At `cc837db` the column is in the state TPL-1 left it: **`Template.type` is
`String` NOT NULL with no default, written on every path from the same resolved
`TemplateType` row that sets `typeId`, and read by eight sites plus the CSV
export.**

Steps (1) and (2) can ship in **one commit with no migration**, because the NOT
NULL constraint only binds the two CREATE paths. The three UPDATE paths write
the string for no reason but habit, and stopping them is the actual retirement.

⚠ **Correction to the row's "six read sites":** one of the six —
`templates-client.tsx` — was already migrated by TPL-1b and reads
`template.templateType?.name ?? template.type` today. **Five rendering sites
remain**, plus the two wire-only carries the row names, plus the CSV export.

⚠ **Correction to the row's "five write paths": there is a sixth.**
`scripts/import-keva-templates.ts:354` writes `type` with **no `typeId` at
all** — it is the only writer in the tree that manufactures a `typeId IS NULL`
row. See §2.6.

---

## 1. The column at `cc837db`

`prisma/schema.prisma:301-330`:

```prisma
model Template {
  ...
  // TPL-1a: `type` is the LEGACY free-text column and is still written on every
  // path, set from the chosen TemplateType's name. ...
  type             String        // ← NOT NULL, no @default
  typeId           String?       // ← nullable FK, ON DELETE RESTRICT
  ...
  templateType     TemplateType? @relation(fields: [typeId], references: [id])
  @@index([typeId])
}
```

**The constraint is the whole problem.** `type` is NOT NULL with no default, so
a `template.create` that omits it fails. `typeId` is nullable, so the join can
be absent — which is what makes the string fallback necessary in step (2) and
is the subject of the re-measure in §5.

---

## 2. Write paths — what stops, what cannot

Six paths write `Template.type`. Two are CREATEs and are constrained; three are
UPDATEs and are not; one is a script.

| # | Path | File:line | Constrained? | Plan |
|---|---|---|---|---|
| 1 | `POST /api/templates` | `src/app/api/templates/route.ts:110` | **YES** — `create` | **keep**, demoted to a mirror |
| 2 | `PATCH /api/templates/[id]` | `src/app/api/templates/[id]/route.ts:127` | no — `update` | **stop** |
| 3 | `POST /api/templates/import` | `src/app/api/templates/import/route.ts:179` | **YES** — `create` | **keep**, demoted to a mirror |
| 4 | rename cascade, `PATCH /api/template-types/[id]` | `src/app/api/template-types/[id]/route.ts:64-69` | no — `updateMany` | **stop** (delete the whole cascade block) |
| 5 | `POST /api/template-types/[id]/reassign` | `src/app/api/template-types/[id]/reassign/route.ts:51` | no — `updateMany` | **stop** writing `type`; keep writing `typeId` |
| 6 | `scripts/import-keva-templates.ts` | `:354` | **YES** — `create`, and writes **no `typeId`** | **leave**, comment only (§2.6) |

### 2.1 `POST /api/templates` — keep the write, demote its meaning

`route.ts:101-111` writes both columns from `resolveTemplateType()`'s row:

```ts
typeId: resolved.type.id,
type: resolved.type.name,
```

**`type` cannot be omitted here** — NOT NULL, no default. It keeps being written
from `resolved.type.name`, and the comment above it changes from *"the legacy
string is what the six read sites and the CSV export still read"* to a statement
that **no reader depends on it**: it is a NOT-NULL-satisfying mirror, correct at
insert and never maintained afterwards.

### 2.2 `PATCH /api/templates/[id]` — stop

`[id]/route.ts:121-128` writes `typeId` and `type` explicitly *after* the
spread. The `type: resolved.type.name` line is **deleted**. The destructure at
`:45` that pulls `type: _clientType` out of `templateData` **stays** — it is the
guard that stops a client body writing the column through the wholesale spread,
and it becomes more load-bearing once nothing else writes it, not less.

**Consequence, stated plainly:** changing a template's type from Opener to
Closer now leaves `type = "Opener"` on the row while `typeId` points at Closer.
Every migrated read site renders "Closer". The stale string is unreachable
because `typeId` is non-null on that row.

### 2.3 `POST /api/templates/import` — keep the write, demote its meaning

`import/route.ts:169-179`, same shape as §2.1 and the same reason: it is a
`create`. `typeId: resolvedType.id` is the truth; `type: resolvedType.name`
becomes the mirror.

### 2.4 Rename cascade — stop, and delete the block

`template-types/[id]/route.ts:64-69`:

```ts
if (data.name !== undefined && data.name !== existing.name) {
  await tx.template.updateMany({
    where: { typeId: id, organizationId: org.id },
    data: { type: data.name },
  })
}
```

This block exists **only** to keep the legacy string in step with a rename —
its own comment says so, naming the five read sites that render the string. Once
those sites read `templateType.name`, the block is doing nothing a reader can
observe. It is **deleted**, and the surrounding comment is rewritten to record
that the rename now propagates through the join alone.

The `$transaction` wrapper stays even though it now wraps a single update: the
`isUniqueViolation` catch and the shape are unchanged, and unwrapping it is
churn outside this row.

**"Rename rewrites history, knowingly" is unchanged** — it is still true and now
true through the join rather than through a cascade. The AlertDialog count in
the manage UI is untouched.

### 2.5 Reassign — stop writing `type`, keep `typeId`

`reassign/route.ts:49-52`: `data: { typeId: to.id, type: to.name }` becomes
`data: { typeId: to.id }`. Same reasoning as §2.4.

### 2.6 ⚠ The sixth write path — `scripts/import-keva-templates.ts`

Not named on the TPL-2 row. `:349-354` creates templates with `type: tmpl.type`
and **no `typeId`**, so every row it makes is a `typeId IS NULL` row — the exact
shape the step-(2) fallback exists to catch, and the only thing in the tree that
still manufactures one.

It is a **one-off seed script against a hardcoded `TARGET_ORG_ID`**, not a
product path, and it has already been run (audit §2.5 — the eight live values
came from it). **Plan: no behaviour change, one comment** recording that a run
today would produce unlinked rows and that anyone re-running it should give the
created templates a `typeId`. Changing it is out of this row's scope; running it
unwarned is the hazard.

---

## 3. Read sites — every one, with its query

Each site needs **two** edits: the Prisma query must join `templateType`, and
the render must read `templateType?.name ?? template.type`. Sites that fetch
through `checklist.template` need the join nested one level down.

The fallback is `??` on a nullable relation (matching the migrated
`templates-client.tsx:384`), **not** `||` — `TemplateTypeSchema` requires a
non-empty trimmed name, so a joined row can never carry `""`.

### 3.1 Five rendering sites remain (of the row's six)

| # | Site | Render line | Query line | Query today |
|---|---|---|---|---|
| ✅ | `src/app/(app)/templates/templates-client.tsx` | `:384` | server-side, `api/templates/route.ts:28` | **already migrated by TPL-1b** — no change |
| 1 | `src/app/(app)/templates/[id]/page.tsx` | `:60` | `:16-19` | `include: { tasks: … }` |
| 2 | `src/app/print/template/[id]/page.tsx` | `:82` | `:16-19` | `include: { tasks: … }` |
| 3 | `src/app/(app)/checklists/page.tsx` | `:129` | `:62-66` | `include: { store: true, template: true }` |
| 4 | `src/app/print/checklist/[id]/page.tsx` | `:127` | `:25-35` | `template: { include: { tasks: … } }` |
| 5 | `src/app/(app)/store-view/checklist/[id]/checklist-execution-client.tsx` | `:147` | **`…/page.tsx:15-25`** | `template: { include: { tasks: … } }` |

Sites 4 and 5 are the two the row warns about: they reach the column through
`checklist.template.type`, so a grep scoped to the templates directory misses
them. Both are covered.

**Site 5 is the only one that is not self-contained.** It is a client component
fed a whole Prisma row by its server page, and its `Props` declares
`template: { name: string; type: string; operationalPhase: string | null; tasks: Task[] }`
at `:46`. That declaration gains
`templateType: { name: string } | null` and the page's query gains the join —
**two files for one render site.**

Sites 3 and 4 currently type their data implicitly from the Prisma result, so
adding the join is sufficient; no interface changes.

### 3.2 Two wire-only carries

| Site | Field | Plan |
|---|---|---|
| `src/app/api/checklists/route.ts:65` | `templateType: c.template.type` | source becomes `c.template.templateType?.name ?? c.template.type`; **key name unchanged** |
| `src/app/api/stores/[id]/templates/route.ts:60` | `type: t.type` | source becomes `t.templateType?.name ?? t.type`; **key name unchanged** |

**Migrated, not deleted, and that is a recommendation not a default** — see Q3
in §7. Both keys are consumed by nothing that renders (`templateType` by nothing
at all; `type` by a `TemplateOption` declaration at
`store-view-client.tsx:18` that never renders it). Deleting them is a change to
an API response shape, for no benefit, in a row whose whole discipline is
additive. They become correct instead of stale, which costs one line each.

`api/checklists/route.ts`'s TPL-1a comment is rewritten: it currently says the
field "carries the LEGACY string column, which TPL-2 will retire — this is one
of the sites that has to be answered for then." That is the answer.

---

## 4. CSV export — the coupling that makes step (1) safe

`src/app/api/templates/export/route.ts:88` emits `t.type` into the
`template_type` column; the query at `:62-66` has no join.

**This migration is not optional and it is not cosmetic.** The moment §2.4 stops
the rename cascade, `t.type` on an existing row is a snapshot of whatever the
type was called at insert. An unmigrated export would then emit **stale type
names** — the first observable defect of stopping the writes, and it would land
in a file an operator carries between environments.

Plan: add `templateType: { select: { name: true } }` to the include, and emit
`t.templateType?.name ?? t.type`.

### Existing exported files stay import-valid

`POST /api/templates/import` resolves types **by name**, not by id
(`import/route.ts:121-143`, TPL-1b's Q4 behaviour):

1. every `template_type` cell the file mentions is collected up front, blank
   cells resolving under the name `"Mid-Shift"`;
2. each is matched **case-insensitively** against the org's existing types;
3. anything unmatched is **created** as a new type in neutral grey;
4. the per-template loop then writes `typeId` and `type` from that resolved row.

Nothing in that path reads `Template.type` from the database, and nothing keys
on an id. So:

- a CSV exported **before** this change (carrying `"Opener"`) imports exactly as
  it does today — matched to the org's `Opener`, or created if absent;
- a CSV exported **after** this change carries the joined name, which is the
  live name of a real type, so it matches even more reliably than before;
- a CSV exported after this change **from a row whose type was renamed** now
  carries the *new* name rather than the stale one — which is the fix, not a
  regression.

**The import path is unaffected by steps (1) and (2) and is not edited.**

The `?format=json` branch serialises the whole Prisma row, so the added join
puts a `templateType` object in the JSON output. That is additive; the JSON
export is documented as "raw … for reference" and is not an input to the import
route, which takes flat CSV-shaped rows.

---

## 5. Re-measure — the query for Gary, per branch

**Not run by this session** (CLAUDE.md § *Environment Variables* — no deployed
credential reaches this machine). The row's filed evidence — unlinked 0 on all
three branches, 2026-08-07 — was measured **before this session** and the row's
own standing instruction is *"Re-measure, do not cite."* An import can create a
`typeId IS NULL` row at any time.

Branch id selected alongside the result per CLAUDE.md § *Database Evidence*
("belt and braces"), so the label cannot drift from the row.

```sql
-- (A) The gate. Run on dev, preview/staging, and production.
SELECT current_setting('neon.branch_id', true)        AS branch,
       COUNT(*) FILTER (WHERE "typeId" IS NULL)       AS unlinked,
       COUNT(*)                                       AS total
FROM "Template";
```

```sql
-- (B) Only if (A) returns unlinked > 0 — identify them.
SELECT current_setting('neon.branch_id', true) AS branch,
       t."id", t."organizationId", t."name", t."type",
       t."isArchived", t."createdAt"
FROM "Template" t
WHERE t."typeId" IS NULL
ORDER BY t."createdAt";
```

```sql
-- (C) Blank-string check. PATCH accepted `type: ""` into the NOT NULL column
-- before TPL-1a (TYPE-1_AUDIT §2.2), and a blank string on an unlinked row is
-- a fallback that renders nothing. Expected zero.
SELECT current_setting('neon.branch_id', true) AS branch, COUNT(*) AS blanks
FROM "Template" WHERE "type" = '';
```

Expected branch ids, from the TPL-1/TPL-2 rows:
`br-broad-wave-a6vpjdw0` (dev) · `br-square-feather-a63z92vz` (preview/staging)
· `br-sparkling-block-a620qvg4` (production).

### How each read site behaves for an unlinked row

**This plan is safe at any `unlinked` count**, because every migrated site keeps
the string fallback. If (A) returns non-zero, the fallback is load-bearing for
those rows and this is what they render:

| Site | Unlinked-row behaviour |
|---|---|
| templates list badge | legacy string, **neutral grey** (already true — TPL-1b) |
| template detail header | legacy string |
| print template sheet | legacy string |
| checklists card pill | legacy string |
| print checklist subtitle | legacy string |
| execution header | legacy string |
| `api/checklists` `templateType` | legacy string |
| `api/stores/[id]/templates` `type` | legacy string |
| **CSV export `template_type`** | legacy string — **and it re-imports as a real type**, which is how an unlinked row heals through a round-trip |

If (C) returns non-zero **and** those same rows are unlinked, the fallback
renders an empty string on the five text sites. That is a pre-existing data
condition this row does not create, but it would need naming before execution.

**Dropping the fallback is out of the question this session regardless of the
result** — that is step (3) territory and is not authorised.

---

## 6. Regression checklist

No automated tests exist for this surface; this is the manual pass.

**Type round-trips**
- [ ] **Create** a template — Type select required, saves, badge shows the chosen type
- [ ] **Edit** an existing template, **change its type** — badge, detail header and print sheet all show the NEW type (this is the §2.2 case: the row's `type` column is now stale and must not surface)
- [ ] **Duplicate** an Opener — copy is an Opener (`templates-client.tsx:172-183`, posts `typeId`)
- [ ] **Duplicate** a template with `typeId` null — still blocked with the existing message
- [ ] **Import** a CSV naming an existing type (mixed case) — links, no near-duplicate type created
- [ ] **Import** a CSV naming a new type — type created in grey, template linked
- [ ] **Import** a CSV with a blank `template_type` — resolves under "Mid-Shift"
- [ ] **Rename** a type — count warning fires; badge, detail, both print sheets, checklist pill and execution header all show the new name **(this is the §2.4 case — the cascade is gone and the join must carry it)**
- [ ] **Reassign** a type's templates to another type — all move, all render the new name
- [ ] **Delete** an in-use type — still 409 with count; delete an unused type — succeeds

**Surfaces**
- [ ] `/templates` — badges, colours, filter chips, Active/Archived tabs
- [ ] `/templates/[id]` — Type line
- [ ] `/print/template/[id]` — Type line
- [ ] `/checklists` — grey type pill on each card
- [ ] `/print/checklist/[id]` — `{store} • {type}` subtitle, both normal and `?blank=true`
- [ ] `/store-view/checklist/[id]` — execution header `{store} • {type}`

**Export / import round-trip**
- [ ] Export CSV → `template_type` column carries the **joined** name
- [ ] Export a renamed type's template → carries the NEW name (would fail before this change)
- [ ] Re-import that CSV → templates land linked, types matched not duplicated
- [ ] Import a CSV exported **before** this change → still valid (§4)

**Isolation**
- [ ] Second-org isolation untouched — no `where` clause is edited by this plan; every added `include`/`select` sits inside an already-org-scoped query

**DEBT-59**
- [ ] **`template-form.tsx` IS NOT TOUCHED by this plan, so no DEBT-59 spot-check is required.** Flagged here because the row asks: the file carries a now-fully-dead `type: string` on `TemplateFormProps` (`:54`) and a dead `initialData.type`, both orphaned by TPL-1a. **They are deliberately left in place.** Removing them is a two-line cleanup that would drag the DEBT-59 offset spot-check into an S-sized row for no behavioural gain. If this changes during execution it will be raised before the commit, not after.

---

## 7. Open questions — each with a recommendation

**Q1 — How is the NOT NULL constraint resolved on the two CREATE paths?**
Options: (a) keep writing `templateType.name` as a mirror no reader depends on;
(b) add `@default("")` to the column so creates can omit it; (c) do nothing and
skip step (1).
**Recommendation: (a).** It needs **no migration at all**, keeps the row's
"additive only" discipline absolute, and leaves the column holding a real name
rather than a placeholder — which matters for step (3), where someone will want
to look at the data and decide it is safe to drop. (b) buys nothing steps (1)
and (2) need and spends a migration to make the column hold junk.

**Q2 — Do the three UPDATE paths really stop, given the row calls the
both-columns-agree invariant "what makes this row safe to do"?**
**Recommendation: yes, stop all three.** That invariant is what makes the
migration safe *to start* — it guarantees no row's string disagrees with its
join at the moment the reads switch over. Once the reads are on the join, the
string on a linked row is unreachable, and "stop writing the string" is the
literal text of step (1). The one place the divergence would have escaped is the
CSV export, which §4 migrates in the same commit.

**Q3 — Migrate the two wire-only fields, or delete them?**
**Recommendation: migrate, do not delete.** They cost one line each and become
correct. Deleting `type` from `api/stores/[id]/templates` also means editing
`store-view-client.tsx`'s `TemplateOption`; deleting either is a response-shape
change with no caller asking for it. Both are natural candidates for the step-(3)
session, which will be looking at exactly this question anyway.

**Q4 — What about `scripts/import-keva-templates.ts` (§2.6)?**
**Recommendation: comment only, no behaviour change.** It is a one-off seed
against a hardcoded org id, already run, unreachable by any operator. But it is
the only writer left that manufactures a `typeId IS NULL` row, and the next
person to reach for it should be told that in the file rather than by
re-deriving it.

**Q5 — Commit shape?**
**Recommendation: the house two-commit pattern.** Commit 1 = all code, gated on
scoped `npx eslint` over the touched files **and** `npm run build`. Commit 2 =
`docs/ROADMAP.yaml` closing TPL-2 steps (1)-(2), quoting commit 1's short SHA,
gated on `npm run build`. This document is committed **with commit 1**.
Never amended — the recorded SHA must stay valid. Committed, NOT pushed.

---

## 8. Size

**One session.** Thirteen files, no migration, no new abstraction:

- 5 write paths — 2 comment rewrites, 3 line deletions (`route.ts` ×2,
  `reassign/route.ts`), 1 comment added to the seed script
- 5 read sites — 1 query edit + 1 render edit each; site 5 spans 2 files
  (page + client `Props`)
- 2 wire carries — 1 query edit + 1 source edit each
- 1 CSV export — 1 query edit + 1 source edit
- `docs/ROADMAP.yaml`, and this file

The largest single risk is a missed query join producing a TypeScript error,
which `npm run build` catches before the commit rather than in staging.

**No split proposed.**

---

## 9. What step (3) inherits — recorded, not planned

Not authorised by this session. Written down so the next row does not
re-derive it:

- `Template.type` remains `String` NOT NULL and remains **written on the two
  CREATE paths only**, as a mirror. Dropping it requires making those two paths
  stop, which requires the column to become nullable or defaulted first.
- After the soak, `Template.type` on a linked row is a **snapshot at insert**,
  not current truth. Anyone reading the column directly in SQL after this row
  ships must know that.
- The fallback `?? template.type` at nine sites is the transition scaffolding
  and comes out with the column.
- `TemplateType.active` still has no writer (TPL-1's Q2). The TPL-1 row names
  TPL-2 as the moment to revisit it; **it is not revisited here** — it is a
  schema change and belongs with step (3)'s migration, not with a
  no-migration row.
- The two wire-only carries (§3.2) are still emitted and still consumed by
  nothing.
- `scripts/import-keva-templates.ts` still writes `type` with no `typeId`.
