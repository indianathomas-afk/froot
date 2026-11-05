# BUG-25 — Audit (Phase 1 only; Phase 2 cancelled by ruling)

Session: BUG-25, TIER 3, 2026-11-05. Prompt: `docs/prompts/BUG-25.md`.
Gate: `staging`, `main`, `origin/staging`, `origin/main` all at `9c236f9`
(checked after `git fetch`). Nothing was built: no migration, no fixture.

## Gary's ruling (his words, in chat, 2026-11-05)

> "Ruling: path 3. Don't build anything for BUG-25 — no migration, no fixture,
> no Neon runs. One docs commit only: correct the BUG-25 row in place (20
> tables have no CREATE TABLE, a fresh migrate deploy fails at
> 20260706190000_i6_recipes_adjustments_prep, so TaskAttachment alone can't be
> fixed in isolation), set it to point at the MIGRATIONS.md §2 baseline squash,
> and file one ROW for the squash itself if none exists (list all 20 tables;
> note the check matched table names only, not columns). Draft my ruling in
> DECISIONS.md for me to ratify. Commit only."

"Path 3" was the third option in Claude's Phase 1 report. It read: "Leave the
whole problem to the MIGRATIONS.md §2 baseline squash." The other two were:
(1) BUG-25 narrow (TaskAttachment only, others as a ROW, fresh-DB proof
dropped), Claude's recommendation; (2) one idempotent baseline for all 20,
timestamped before i6.

## 1. Is TaskAttachment really missing from the migrations? Yes.

- `model TaskAttachment` (`prisma/schema.prisma`) has no `@@map` and no field
  has `@map`, so the table is `"TaskAttachment"` and the columns carry the
  field names.
- `grep -ril "taskattachment\|task_attachment" prisma/migrations/` → no match
  in any of the 87 migration folders. No CREATE TABLE, no index, no FK.

## 2. How it got there

- Added by `129a378` (2026-06-30 15:49 -0700, "Add task attachments (PDF/image)
  with Vercel Blob storage"). That commit touches `prisma/schema.prisma` and no
  migration.
- `git log -S "TaskAttachment" --oneline -- prisma/` also returns `bb675e1`
  (CAL-1). That hit is commit-message text comparing CAL-1's blob store to
  TaskAttachment, not a schema change to the model.
- `git log -S "task_attachment"` → nothing.
- Evidence for `db push`: the commit is six days before `db push` was retired
  (2026-07-06 staging drift incident, CLAUDE.md § Database), and the build
  script at `129a378` was `prisma generate && next build`, with no migrate step.
  Same signature as DEBT-35 (`Task.estimatedTimeMinutes`). NOT proven.

## 3. What the schema expects (target DDL)

From `npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`:

```sql
CREATE TABLE "TaskAttachment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskAttachment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TaskAttachment_taskId_key" ON "TaskAttachment"("taskId");
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

## 4. What the real databases have

**dev only, measured once.** The query below was run read-only through the
Prisma client against the database in local `.env` (Neon endpoint
`ep-late-water…`, which `.env` labels as dev, br-broad-wave). It was run to
catch syntax errors before handing the query to Gary. Result (dev,
2026-11-05): table exists; 7 columns exactly as § 3 (all NOT NULL, `createdAt`
`timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP`, `sizeBytes`
`integer`, the rest `text`); indexes `TaskAttachment_pkey` and
`TaskAttachment_taskId_key` (UNIQUE on `"taskId"`); constraints
`TaskAttachment_pkey` and `TaskAttachment_taskId_fkey`
`FOREIGN KEY ("taskId") REFERENCES "Task"(id) ON UPDATE CASCADE ON DELETE CASCADE`.
**dev matches the schema.**

**staging and production: NOT measured.** The Neon runs were cancelled by the
ruling.

**THE PHASE 1 QUERY VIOLATED CLAUDE.md R4 AND MUST NOT BE REUSED AS WRITTEN.**
It carried a hand-typed branch literal (`SELECT 'br-broad-wave'::text AS
branch`, edited per branch). The prompt asked for "its branch literal", and R4
(§ Git Rules, 2026-10-24) forbids exactly that. The label must come from
`current_setting('neon.branch_id', true)` instead. The dev dry run above is
labelled from `.env`, not from the query. Anyone measuring the branches later
should swap the `p` CTE for:

```sql
WITH p AS (SELECT current_setting('neon.branch_id', true) AS branch),
```

and leave the rest of the query unchanged. The query as run (with the
NOT NULL constraint filter added afterwards, which the dev run did not have):

```sql
WITH p AS (SELECT 'br-broad-wave'::text AS branch),   -- R4 VIOLATION, see above
t AS (SELECT to_regclass('public."TaskAttachment"') AS rel)
SELECT p.branch, 1 AS ord, 'table' AS kind, 'TaskAttachment' AS name,
       CASE WHEN t.rel IS NULL THEN 'MISSING' ELSE 'exists' END AS detail
FROM p, t
UNION ALL
SELECT p.branch, 2, 'column', a.attname::text,
       format_type(a.atttypid, a.atttypmod)
       || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE ' NULL' END
       || COALESCE(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), '')
FROM p, t
JOIN pg_attribute a ON a.attrelid = t.rel AND a.attnum > 0 AND NOT a.attisdropped
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
UNION ALL
SELECT p.branch, 3, 'index', i.relname::text, pg_get_indexdef(i.oid)
FROM p, t
JOIN pg_index x ON x.indrelid = t.rel
JOIN pg_class i ON i.oid = x.indexrelid
UNION ALL
SELECT p.branch, 4, 'constraint', c.conname::text,
       pg_get_constraintdef(c.oid) || ' [delete='
       || CASE c.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'r' THEN 'RESTRICT'
            WHEN 'a' THEN 'NO ACTION' WHEN 'n' THEN 'SET NULL'
            WHEN 'd' THEN 'SET DEFAULT' ELSE '-' END || ']'
FROM p, t
JOIN pg_constraint c ON c.conrelid = t.rel AND c.contype <> 'n'
ORDER BY 2, 4;
```

## 5. The plan-changer: 20 of 130 models have no CREATE TABLE

Method: list every `model` in `prisma/schema.prisma` with its table name (the
model name, or `@@map` where present — 2 models are mapped, neither is in the
list), then search the concatenated `prisma/migrations/*/migration.sql` for
`CREATE TABLE (IF NOT EXISTS )?"<table>" (`, case-insensitive.

**LIMIT: this matched TABLE NAMES ONLY.** It does not check columns, types,
indexes or FKs for any table, missing or present. A table that IS created by
a migration can still have drifted columns (DEBT-35's
`Task.estimatedTimeMinutes` is exactly that case and passes this check). All
15 enums have a `CREATE TYPE` in some migration.

| Table | Model added in | First migration that references it |
|---|---|---|
| TaskAttachment | `129a378` 2026-06-30 | none |
| CatalogCategory | `10794e5` 2026-07-05 | none |
| CatalogItem | `10794e5` 2026-07-05 | none |
| CatalogItemVariation | `10794e5` 2026-07-05 | none |
| Vendor | `376fe38` 2026-07-05 | `20260707090000_i7_vendor_minimums_delivery_adjustments` |
| PurchaseOrder | `376fe38` 2026-07-05 | `20260707100000_i7_po_invoice_file` |
| PurchaseOrderLine | `376fe38` 2026-07-05 | none |
| VendorIngredient | `2e610d9` 2026-07-05 | none |
| SquareCategory | `3893e62` 2026-07-05 | `20261103000000_n3_public_menu` |
| SalesItem | `3893e62` 2026-07-05 | `20260706190000_i6_recipes_adjustments_prep` |
| IngredientCategory | `3893e62` 2026-07-05 | none |
| Ingredient | `3893e62` 2026-07-05 | `20260707080000_i7_store_ingredient_pars` |
| IngredientCostLog | `2172c83` 2026-07-05 | none |
| IngredientDuplicateDismissal | `2172c83` 2026-07-05 | none |
| IngredientStorageMapping | `432a30e` 2026-07-06 | none |
| InventoryCountCorrection | `eb816db` 2026-07-06 | none |
| SalesPeriodCache | `b3cb378` 2026-07-06 | `20260710030000_sales_cache_unconfirmed` |
| SalesLineCache | `b3cb378` 2026-07-06 | none |
| SalesHourlyCache | `b3cb378` 2026-07-06 | none |
| StoreMonthlyGoal | `b3cb378` 2026-07-06 | none |

"Added in" = first commit where `git log -S "model <Name> {"` hits
`prisma/schema.prisma`. "First referenced" = first migration folder, in name
order, whose SQL contains `"<Name>"`. Several of those (Vendor, PurchaseOrder,
Ingredient) are referenced earlier by FKs from other tables' CREATE TABLEs.
The folder listed is the first match by file, not necessarily the first
statement that would fail.

**Consequence.** On an empty database, `npx prisma migrate deploy` stops at
`20260706190000_i6_recipes_adjustments_prep`. Its first statement is
`ALTER TABLE "SalesItem" ADD COLUMN "recipeStatus" …`, and no earlier
migration creates `SalesItem`. Every migration after it is never reached. So:

- BUG-25's framing ("a database rebuilt from migrations alone would lack
  TaskAttachment") is true but understated. Such a database cannot be built
  at all.
- A TaskAttachment-only baseline timestamped in November would never run on a
  fresh database, and the prompt's "optional fresh-database proof" could not
  pass.
- All 20 tables share one cause, dated 2026-06-30 → 2026-07-06, the last week
  before `db push` was retired. MIGRATIONS.md §2's baseline squash regenerates
  `0_init` from the schema, which creates all 20. That is why the ruling
  points BUG-25 there.

## 6. Out-of-scope triage

- FIX NOW: 0.
- RULING NOW: 1 — the 20-table finding (§ 5). Ruled: path 3.
- COMMENT: 1 — the Phase 1 query's R4 violation (§ 4). Recorded here and on
  the BUG-25 row. No other document carries the query.
- ROW: 1 — DEBT-125, the baseline squash itself. No row existed: searched
  `docs/ROADMAP.yaml` for "squash" and "baseline". Hits are only in DOC-1,
  DOC-3, BUG-25, DEBT-3, DEBT-5, DEBT-27 and DEBT-35 notes, none of them a row
  for doing the squash.

## 7. Prisma commands run (verbatim)

```
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script
```

No other prisma command. The dev dry run in § 4 used the Prisma client
(`$queryRawUnsafe`, one SELECT) from a temporary `scripts/_tmp-bug25-audit.ts`,
deleted immediately afterwards and never committed.
