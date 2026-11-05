# DEBT-125 — Phase 1 audit (read-only)

Session: DEBT-125 baseline squash, Phase 1. **TIER 3.** Written 2026-11-05.
Prompt: `docs/prompts/DEBT-125.md`. Nothing under `prisma/` was changed. The
candidate `0_init` lives in the session scratchpad, not in the repo.

---

## 0. Gate

| Check | Result |
|---|---|
| Branch | `staging`, clean except 3 untracked prompt files (`DEBT-125.md`, `DOCS-N5b-promotion-and-BUG-22.md`, `N-5e-addon-import-audit.md`). |
| `git fetch origin`, then local `staging`, `origin/staging`, `origin/main` | All three are `2b0a33e7aa31899a5d93325feca4c91ab8181b3e`. `git log origin/main..origin/staging` and the reverse are both empty. **Level.** The BUG-25 docs commit (`4e11087`) is already on main through merge `2b0a33e`, so the "staging may be ahead by one" exception isn't needed. |
| `env \| grep -c DATABASE_URL` | `0` (no shell override; `.env` drives the CLI). |
| Datasource host | `.env` hosts are `ep-late-water-a6k53nv2` and `ep-late-water-a6k53nv2-pooler`. That is **dev**, `br-broad-wave-a6vpjdw0` per the MIGRATIONS.md branch table. The CLI uses the non-pooled one (`prisma.config.ts`, BUG-3). |
| `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` | **dev (ep-late-water-a6k53nv2):** `-- This is an empty migration.` **Gate passes.** |
| Prisma | CLI 7.8.0, `@prisma/client` 7.8.0, engines `3c6e192761c0362d496ed980de936e2f3cebcd3a`. |

---

## 1. What already governs this (quoted)

**MIGRATIONS.md §2** (the squash plan), the two warnings:

> ⚠️ **After regenerating `0_init`, re-append every object in the "Protected
> indexes" table by hand — seven at time of writing (three partial indexes and
> four CHECK constraints) — or the baseline is wrong.** … **Count them out
> of that table, not out of this sentence**

> ⚠️ **THE CURRENT MIGRATIONS FOLDER CANNOT REBUILD THE LIVE SCHEMA, AND THIS
> STEP WILL SILENTLY ADOPT THE DIFFERENCE RATHER THAN SURFACE IT.** …
> **So diff the regenerated `0_init` against a live branch's actual column types
> before marking it applied**, and treat `estimatedTimeMinutes` as one *known*
> instance rather than the only one

The first warning's "seven" is stale. The table it points to has **eight**
rows: 3 partial unique indexes and 5 CHECKs. The table header and Hazard 1
already say so ("corrected 'five' → 'eight' 2026-11-02 by N-1d"). Counted from
the table, as the warning says to: **8.**

**§2 differs from this prompt on bookkeeping.** §2 says to `DELETE FROM
"_prisma_migrations"` on each branch, then run `migrate resolve --applied 0_init`
per branch URL. This prompt keeps the old rows and marks staging and
production with a console INSERT (draft R2). See finding F1 in § 9.

**Hazard 1 (Protected indexes):** "the regenerated baseline will **omit all
eight** … Re-append **all eight** by hand after regenerating, and diff the
result against this table."

**"What is NOT a hazard":** `migrate diff` is blind to partial indexes and
CHECKs in both directions. So the empty gate diff proves nothing about these 8
objects on dev. § 7's catalog query is the only thing that does.

**CLAUDE.md § Database, the rules this session ran under:**

> **CLAUDE CODE NEVER RUNS A MIGRATION. `npx prisma migrate diff` is the ONLY
> prisma command a session may run against a database** … **Never `migrate dev`,
> never `migrate deploy`, never `migrate reset`, never `db execute`.**

> `npx prisma format`, `npx prisma validate` and `npx prisma generate` are
> ALLOWED.

> Claude still never runs `db execute`, `migrate deploy`, `migrate dev`,
> `migrate reset` or `migrate resolve`

Also binding: R2, where apply instructions come only from Gary's planning chat.
This prompt *is* that instruction for Phase 3 and 4, and Gary wrote it. Also
binding: R3, where every apply instruction starts with `cd …/froot` and `pwd`.
And R4: no hand-typed branch literal in SQL.

---

## 2. Objects the schema can't express

Every `prisma/migrations/*/migration.sql` was grepped for the following:
- partial and expression indexes: `WHERE` on any non-comment line, `lower(`, `USING`
- `CHECK`
- `CREATE TRIGGER|FUNCTION|VIEW|MATERIALIZED|EXTENSION|SEQUENCE|RULE|POLICY|DOMAIN`, `DO $$`, `plpgsql`, `nextval`
- `COLLATE`, `GENERATED ALWAYS`, `EXCLUDE`, `DEFERRABLE`, `COMMENT ON`, `GRANT`
- every `UPDATE` / `INSERT INTO` / `DELETE FROM` / `WITH`

A second grep found any later `DROP` or `RENAME` of each object by name.

### 2a. Schema objects, all to be appended to `0_init`

**Totals:** 3 partial indexes and 5 CHECKs, an exact match for the
MIGRATIONS.md table. There are **no** triggers, functions, views,
materialized views, extensions, sequences, policies, domains, `DO` blocks,
expression indexes or GIN indexes in any migration.

| # | Object | Kind | Exact DDL (from the source file) | Source migration | Dropped or renamed later? | Rebuildable exactly? |
|---|---|---|---|---|---|---|
| 1 | `LaborSettings_org_default_key` | partial UNIQUE index | `CREATE UNIQUE INDEX "LaborSettings_org_default_key" ON "LaborSettings"("organizationId") WHERE "storeId" IS NULL;` | `20260720000000_labor0_positions_settings_forecast:73` | No | Yes. `storeId TEXT` is in the candidate. |
| 2 | `StoreStaffAssignment_one_primary_key` | partial UNIQUE index | `CREATE UNIQUE INDEX "StoreStaffAssignment_one_primary_key" ON "StoreStaffAssignment"("staffMemberId") WHERE "isPrimary";` | `20260729145504_build2_staff_one_primary_store:30-32` | No | Yes. `isPrimary BOOLEAN NOT NULL DEFAULT false` |
| 3 | `HrDocumentStoreAssignment_staff_grant_key` | partial UNIQUE index | `CREATE UNIQUE INDEX "HrDocumentStoreAssignment_staff_grant_key" ON "HrDocumentStoreAssignment"("hrDocumentId", "staffMemberId") WHERE "granteeType" = 'STAFF';` | `20260812171500_doc1a_document_audience_grants:39-41` | No | Yes. The table is created under its `@@map` name `HrDocumentStoreAssignment`, and `granteeType` is TEXT, not an enum. |
| 4 | `hrdoc_grant_shape` | CHECK | `ALTER TABLE "HrDocumentStoreAssignment" ADD CONSTRAINT "hrdoc_grant_shape" CHECK (("granteeType" = 'STORE' AND "storeId" IS NOT NULL AND "staffMemberId" IS NULL) OR ("granteeType" = 'STAFF' AND "staffMemberId" IS NOT NULL AND "storeId" IS NULL));` | `20260812171500_doc1a_document_audience_grants:49-53` | No | Yes |
| 5 | `hrdoc_link_shape` | CHECK | `ALTER TABLE "HrDocument" ADD CONSTRAINT "hrdoc_link_shape" CHECK (("kind" = 'Link') = ("externalUrl" IS NOT NULL));` | `20260824193000_doc3_document_links_and_instructions:34-35` | No | Yes. `kind TEXT NOT NULL`, `externalUrl TEXT` |
| 6 | `NotificationRecipientPick_one_target_check` | CHECK | `ALTER TABLE "NotificationRecipientPick" ADD CONSTRAINT "NotificationRecipientPick_one_target_check" CHECK (("userId" IS NULL) <> ("contactId" IS NULL));` | `20261023200000_notify12_recipients:58-59` | No | Yes |
| 7 | `LaborAssignment_minutes_check` | CHECK | `ALTER TABLE "LaborAssignment" ADD CONSTRAINT "LaborAssignment_minutes_check" CHECK ("startMinutes" >= 0 AND "startMinutes" < "endMinutes" AND "endMinutes" <= 1440);` | `20261030200242_l4a_labor_assignment:44-45` | No | Yes. Both columns are `INTEGER NOT NULL`. |
| 8 | `IngredientNutrition_basis_together` | CHECK | `ALTER TABLE "IngredientNutrition" ADD CONSTRAINT "IngredientNutrition_basis_together" CHECK (("basisAmount" IS NULL) = ("basisUnit" IS NULL));` | `20261102220000_n1d_proof_only_nutrition:16-17` | No | Yes |

The only `DROP INDEX` statements in the history are the following five,
**none of them protected objects**. All are ordinary unique keys that the
schema regenerates in their final form:
- `StaffMember_squareTeamMemberId_key` (`20260714120000`)
- `HrDocumentAcknowledgment_checkpointId_hrDocumentVersionId_s_key` (`20260723180000` and `20261028202919`)
- `HrSignedRecord_hrDocumentVersionId_staffMemberId_key` (`20260723180000`)
- `HrSignedRecord_hrDocumentVersionId_staffMemberId_signingCyc_key` (`20261028202919`)

**"Still exists in the live schema."** Per the migration history, all 8 exist:
each is created once and never dropped. **Not measured live this session.**
Claude can't query `pg_catalog`, because `db execute` is forbidden, and
`migrate diff` is blind to all 8. Earlier sessions read #2, #3 and #4 back
from dev's `pg_indexes` / `pg_constraint` (MIGRATIONS.md, 2026-07-29 and
2026-08-12). The § 7 query lists all of them on each branch, and its expected
answer is given there.

### 2b. Data backfills: none go into `0_init`

A fresh database has no rows, so every one of these statements has nothing to
act on. Each source query reads existing rows only. None inserts a fixed
global row that a fresh database would need.

| Migration | Statement(s) | What it reads | In `0_init`? |
|---|---|---|---|
| `20260808103000_tpl1a_template_type_entity` | 2× `INSERT INTO "TemplateType"`, `UPDATE "Template"` | `DISTINCT organizationId, type FROM "Template"`; `FROM "Organization" CROSS JOIN (VALUES …)` | **No.** Empty-DB no-op. |
| `20260809160000_chk1_section_entity` | `INSERT INTO "Section"`, `UPDATE "Task"`, `UPDATE "TaskLog"` | `FROM "Task"` | **No** |
| `20260810194426_hr20_training_category_entity` | `INSERT INTO "TrainingCategory"` | `FROM "Organization" CROSS JOIN (VALUES …)` | **No** |
| `20260824210000_hr29_training_module_order_index` | `WITH ranked … UPDATE "TrainingModule"` | `"TrainingModule"` | **No** |
| `20260828120000_comp1_comp_confidential` | 2× `UPDATE "SquareTeamMemberWage"` | its own rows, plus `StaffMember` | **No** |
| `20260928213037_doc5_document_category_entity` | 2× `INSERT INTO "HrDocumentCategory"`, `UPDATE "HrDocument"` | `FROM "Organization" CROSS JOIN (VALUES …)`; `DISTINCT … FROM "HrDocument"` | **No** |
| `20261023200000_notify12_recipients` | `INSERT INTO "NotificationContact"`, `INSERT INTO "NotificationRecipientPick"` | `unnest(o."hrAckRecipients") FROM "Organization"` | **No** |
| `20261102220000_n1d_proof_only_nutrition` | `UPDATE "IngredientNutrition"` | its own rows | **No** |

The three per-org default seeds (TemplateType, TrainingCategory,
HrDocumentCategory) are mirrored in app code. See
`src/lib/template-types.ts:5`, `src/lib/training-categories.ts:5` and
`src/lib/document-categories.ts:6`, each a "MUST MATCH prisma/migrations/…"
comment. So new orgs never depended on the migration. The migration seeded
only the orgs that existed when it ran.

---

## 3. The candidate `0_init`

Command, output to the scratchpad and not under `prisma/migrations`:

```
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script -o <scratchpad>/0_init.candidate.sql
```

| Measure | Value |
|---|---|
| Lines | 3,453 |
| sha256 (raw generated output, before anything is appended) | `f033968252a7ce9b60f5d50f9f8c387d7062a547696a1d133746861aff0531c4` |
| `CREATE TABLE` | **130** |
| `^model ` in `prisma/schema.prisma` | **130**. **Equal.** |
| `CREATE TYPE` / `^enum ` | 15 / 15 |
| `CREATE … INDEX` | 182, with no `WHERE` in any (as expected) |
| `FOREIGN KEY` | 244 |
| `CHECK` | 0 (as expected) |
| First statement | `CREATE SCHEMA IF NOT EXISTS "public";` |
| Line endings | LF ("ASCII text"); there is no `.gitattributes`. |
| `SERIAL` / sequences | 0 |
| Function defaults (`DEFAULT f(`) | none besides `CURRENT_TIMESTAMP` |

**All 20 BUG-25 tables are present**, one `CREATE TABLE "<name>" (` each:
TaskAttachment, CatalogCategory, CatalogItem, CatalogItemVariation, Vendor,
PurchaseOrder, PurchaseOrderLine, VendorIngredient, SquareCategory, SalesItem,
IngredientCategory, Ingredient, IngredientCostLog,
IngredientDuplicateDismissal, IngredientStorageMapping,
InventoryCountCorrection, SalesPeriodCache, SalesLineCache, SalesHourlyCache,
StoreMonthlyGoal.

All 7 tables that host § 2a's objects are present too (LaborSettings,
StoreStaffAssignment, HrDocumentStoreAssignment, HrDocument,
NotificationRecipientPick, LaborAssignment, IngredientNutrition). So are all
14 columns those objects reference.

**DEBT-35's known instance:** the candidate has `"estimatedTimeMinutes" DOUBLE
PRECISION`, which matches all three live branches (measured 2026-08-01). It
does not match init's `INTEGER`. As §2 predicted, the squash erases that
disagreement, and it is recorded here so the evidence survives.

**On §2's second warning ("diff against a live branch").** For dev it is done:
the gate's empty diff compares dev's live catalog with the same schema
`0_init` is generated from, which covers every column, type, default, index
and FK that Prisma can see. For staging and production, the § 7 Neon schema
diffs against dev do the same job. What neither of them covers is § 2a, and
that is what the catalog query is for.

---

## 4. What reads migration paths by name

**Must be re-pointed or verified in Phase 2:**

| File | Reference | What happens after the move |
|---|---|---|
| `scripts/verify-doc5-categories.ts:57-60` | `readdirSync(join(ROOT, "prisma/migrations")).find(…doc5…)`, then reads its `migration.sql` | **Breaks.** `find` returns `undefined`, then the read fails. Re-point to `prisma/migrations_archive`. |
| `scripts/verify-notify12.ts:346` | `../prisma/migrations/20261023200000_notify12_recipients/migration.sql` | Breaks. Re-point. |
| `scripts/verify-n1d.ts:173` | `prisma/migrations/20261102220000_n1d_proof_only_nutrition/migration.sql` | Breaks. Re-point. |
| `scripts/verify-n2-label.ts:193` | `prisma/migrations/20261102230000_n2_nutrition_serving_settings/migration.sql` | Breaks. Re-point. |
| `scripts/verify-n3-public.ts:217` | `prisma/migrations/20261103000000_n3_public_menu/migration.sql` | Breaks. Re-point. |
| `scripts/verify-n1e.ts:323` | `prisma/migrations/20261103010000_n1e_label_inbox/migration.sql` | Breaks. Re-point. |
| `scripts/verify-n5-modifiers.ts:306` | `prisma/migrations/20261103020000_n5_square_modifiers/migration.sql` | Breaks. Re-point. |
| `scripts/verify-n5b-modifier-usage.ts:304` | `prisma/migrations/20261104010000_n5b_sales_modifier_cache/migration.sql` | Breaks. Re-point. |
| `src/lib/template-types.ts:5`, `src/lib/training-categories.ts:5`, `src/lib/document-categories.ts:6` | `// MUST MATCH prisma/migrations/<name>` comments | Pointers. Re-point to `migrations_archive/`. Comment-only. |

Several fixtures assert on migration SQL *content*, for example the N-1d CHECK
text. Re-pointing keeps them honest, because the archived bytes are unchanged.
Phase 2 should run each re-pointed fixture's file-reading part. Their DB parts
run against dev as before.

**Unaffected, but listed so nobody re-checks:**
- `prisma.config.ts:21`, `migrations: { path: "prisma/migrations" }`. The folder keeps its name, so no change is needed.
- `package.json` `vercel-build: prisma migrate deploy && npm run build`. No path in it, so no change is needed.
- `scripts/generate-roadmap.mjs` and `scripts/generate-guide.mjs`: zero `migration` references.
- No `.github/` directory exists. `vercel.json` holds regions and crons only.

**Doc pointers.** Edit only the living documents, never `docs/prompts/` (CLAUDE.md § Where documents live):
- `docs/MIGRATIONS.md`: 15 `prisma/migrations/2026…` paths
- `docs/ROADMAP.yaml`: 7
- `docs/DEPLOY_LOG.md`: 4
- `CLAUDE.md`: no migration paths, but § Database says "`npx prisma migrate dev` is currently broken — the baseline squash was never done". Phase 2 updates that sentence (see F4).

---

## 5. How Prisma 7.8 treats ledger rows whose folders are gone

**Source:** the installed engine, `node_modules/@prisma/engines/schema-engine-darwin-arm64`
(engines `3c6e1927…`), read with `strings` and `nm`. Also the CLI bundle
`node_modules/prisma/build/index.js`. Not from memory.

What the binary shows:

- `migrate deploy` is the engine's `apply_migrations`
  (`schema_commands::commands::apply_migrations`). Its ledger read is
  `SELECT id, checksum, finished_at, migration_name, logs, rolled_back_at,
  started_at, applied_steps_count FROM _prisma_migrations ORDER BY started_at
  ASC`.
- The divergence messages ("The following migration(s) are applied to the
  database but missing from the local migrations directory", "The migrations
  recorded in the database diverge from the local migrations directory",
  "was modified after it was applied") come from
  `schema-engine/core/src/commands/diagnose_migration_history_cli.rs`. That is
  the **`migrate dev` / `migrate status`** path, not `apply_migrations`.
- The deploy path's ledger refusal is P3009: "migrate found failed migrations
  in the target database, new migrations will not be applied". It fires on a
  row with `finished_at IS NULL AND rolled_back_at IS NULL`.

**Finding:** `migrate deploy` tolerates rows whose folders no longer exist. It
applies each local migration with no matching un-rolled-back row and ignores
the rest. With `0_init` marked applied, the local folder holds nothing
pending, so it should report no pending migrations. **This is read from the
engine's structure and messages, not executed.** Phase 3 B is the proof.

Two consequences:
- **Any open failed row on a branch would block the deploy (P3009),** whatever
  its folder. The § 7 query counts these. The expected count is 0.
- **`migrate status` and `migrate dev` WILL complain** about the 87 orphan rows
  on any branch that keeps them, because they run `diagnose_migration_history`.
  `migrate dev` treats divergence as drift and offers a **reset, which wipes
  the database**. See F1.

---

## 6. The checksum, and the INSERT to mark a branch

**How 7.8 computes `_prisma_migrations.checksum`.** The engine symbols are:

```
schema_connector::checksum::compute_checksum
sha2::sha256::compress256 / sha2::sha256::soft::*
<[u8; 32] as schema_connector::checksum::FormatChecksum>::format_checksum
<[u8; 32] as schema_connector::checksum::FormatChecksum>::format_checksum_old
```

The source path `schema-engine/connectors/schema-connector/src/checksum.rs` is
in the binary, and the `hex-0.4.3` crate is linked. So the checksum is the
**SHA-256 of the `migration.sql` text, as a 64-char lowercase hex string**
(a 32-byte digest; the ledger column is `VARCHAR(64)`). The CLI reads the file
and passes its contents to the engine, via `markMigrationApplied({migrationsList,
migrationName})` in the CLI bundle. `format_checksum_old` exists as a legacy
variant the engine accepts when matching. It doesn't affect what we write.

**Empirical confirmation, folded into the § 7 query:** it returns the stored
checksum for `20261104020000_tpl3_task_retired_at`. `shasum -a 256` of that
file in the repo today gives:

```
943b2b3969a8da4f9f188480dea0213a33889f20d7f56b0c16d27758baf69704
```

If the branch returns that value, the algorithm is proven on real data. If it
returns anything else, that is a plan-changer, and Phase 2 stops.

**What a correct row needs.** The Postgres ledger DDL is embedded in the engine:

```
id VARCHAR(36) PRIMARY KEY NOT NULL, checksum VARCHAR(64) NOT NULL,
finished_at TIMESTAMPTZ, migration_name VARCHAR(255) NOT NULL, logs TEXT,
rolled_back_at TIMESTAMPTZ, started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
applied_steps_count INTEGER NOT NULL DEFAULT 0
```

`apply_migrations` decides "already applied" from `migration_name`,
`finished_at` and `rolled_back_at`. The checksum is compared only by the
`diagnose` path (`migrate dev` / `status`), as the "modified after it was
applied" warning. The rest of the row shape can't be read from the binary,
because `markMigrationApplied` writes it through a query builder, not a
literal: the values for `applied_steps_count` and `logs`. The § 7 query
returns the distinct shapes of existing rows. Several were written by `migrate
resolve --applied` in the pre-2026-10-16 `db execute` + `resolve` era (§3 of
MIGRATIONS.md), so the INSERT can copy a real resolve row's shape. The draft
below uses `applied_steps_count = 1`, `logs = NULL` and `started_at =
finished_at = now()`. Those values are inert for deploy either way.

**Draft INSERT.** Run in the Neon console SQL editor, once per branch, with the
branch picked in the console's dropdown. `<CHECKSUM>` is the sha256 of the
**committed** `prisma/migrations/0_init/migration.sql`. Phase 2 computes it
from the final bytes, after the hand-appended objects, and writes the filled
INSERT into its report and DEPLOY_LOG. The value in § 3 is the raw candidate
and is **not** the one to use.

```sql
INSERT INTO "_prisma_migrations"
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid()::text, '<CHECKSUM>', now(), '0_init', NULL, NULL, now(), 1
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations"
  WHERE migration_name = '0_init' AND rolled_back_at IS NULL
)
RETURNING current_setting('neon.branch_id', true) AS neon_branch_id,
          id, migration_name, checksum, finished_at;
```

- The guard makes the statement idempotent. A second run returns 0 rows and
  inserts nothing.
- It deliberately ignores rolled-back rows, so it still works after the
  recovery below.
- `RETURNING` carries the server-reported branch id (R4), so the confirmation
  can't carry a wrong label.
- **Expected: exactly 1 row returned.** Zero rows means `0_init` was already
  there. Stop and read the existing row before doing anything else.
- `gen_random_uuid()` is built into Postgres 13+. The § 7 query returns
  `version()` to confirm.

**Recovery, if a push ever lands before the INSERT.** The deploy fails on
`CREATE SCHEMA`/`CREATE TYPE … already exists`, and Prisma leaves an open
`0_init` row (P3009 from then on). No data changes, because the first statement
fails. The prompt says to clear the row with `migrate resolve --rolled-back
0_init`. On staging or production that is a **local connection to a deployed
branch**, which the console-only rule forbids. The console equivalent is:

```sql
UPDATE "_prisma_migrations" SET rolled_back_at = now()
WHERE migration_name = '0_init' AND finished_at IS NULL AND rolled_back_at IS NULL
RETURNING current_setting('neon.branch_id', true) AS neon_branch_id, id, migration_name, rolled_back_at;
```

Then run the INSERT, then redeploy. See F3: which of the two goes in DEPLOY_LOG
is Gary's call.

---

## 7. Gary's comparison steps

**A. Neon console schema diffs.** Project Froot.
1. Open **Branches**. Select `dev` (`br-broad-wave-a6vpjdw0`, endpoint
   `ep-late-water-a6k53nv2`), the branch the gate diffed.
2. Click **Schema diff**. Base branch: `dev`. Compare branch:
   `preview/staging` (`br-square-feather-a63z92vz`). Database: `neondb`.
   **Expected: no differences.**
3. Repeat with the compare branch set to `production`
   (`br-sparkling-block-a620qvg4`), database `neondb`. **Expected: no
   differences.**
4. Paste each result, or "no differences", with its two branch names on the
   same line.

These diffs are pg_dump-based, so they also compare the 8 § 2a objects. Data
is ignored. Any difference at all, including in the 8 objects, is a
plan-changer, and Phase 2 doesn't start.

**B. The read-only query.** Run it on each of the three branches, choosing the
branch in the SQL editor's dropdown. It has no branch literal; the server
reports the branch.

```sql
SELECT
  current_setting('neon.branch_id', true)                                   AS neon_branch_id,
  (SELECT count(*) FROM "_prisma_migrations")                               AS ledger_rows,
  (SELECT migration_name FROM "_prisma_migrations"
     ORDER BY started_at DESC LIMIT 1)                                      AS latest_migration_name,
  (SELECT count(*) FROM "_prisma_migrations"
     WHERE finished_at IS NULL AND rolled_back_at IS NULL)                  AS open_failed_rows,
  (SELECT count(*) FROM "_prisma_migrations"
     WHERE rolled_back_at IS NOT NULL)                                      AS rolled_back_rows,
  (SELECT count(*) FROM "_prisma_migrations" WHERE migration_name = '0_init') AS init_rows,
  (SELECT checksum FROM "_prisma_migrations"
     WHERE migration_name = '20261104020000_tpl3_task_retired_at'
     ORDER BY started_at DESC LIMIT 1)                                      AS tpl3_checksum,
  (SELECT string_agg(DISTINCT applied_steps_count::text || '/' ||
            CASE WHEN logs IS NULL THEN 'nolog' ELSE 'log' END, ', ')
     FROM "_prisma_migrations")                                             AS row_shapes,
  (SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
     FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relnamespace = 'public'::regnamespace
       AND (i.indpred IS NOT NULL OR i.indexprs IS NOT NULL))               AS partial_or_expr_indexes,
  (SELECT string_agg(conname, ', ' ORDER BY conname) FROM pg_constraint
     WHERE contype = 'c' AND connamespace = 'public'::regnamespace)         AS check_constraints,
  (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace)  AS user_triggers,
  (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) AS public_functions,
  (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace
     AND relkind IN ('v','m'))                                              AS views,
  (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace
     AND relkind = 'S')                                                     AS sequences,
  (SELECT string_agg(extname, ', ' ORDER BY extname) FROM pg_extension)     AS extensions,
  version()                                                                 AS pg_version;
```

**Expected on every branch:**

| Column | Expected | If not |
|---|---|---|
| `neon_branch_id` | the branch picked in the dropdown | wrong branch. Re-run. |
| `ledger_rows` | ≥ 87 (more if past rolled-back rows exist) | read it |
| `latest_migration_name` | `20261104020000_tpl3_task_retired_at` | branch is behind or ahead. **Plan-changer.** |
| `open_failed_rows` | **0** | P3009 would block every deploy. **Plan-changer.** |
| `init_rows` | 0 | someone already marked it |
| `tpl3_checksum` | `943b2b3969a8da4f9f188480dea0213a33889f20d7f56b0c16d27758baf69704` | checksum algorithm not proven. **Plan-changer (step 6).** |
| `row_shapes` | informational; sets the INSERT's `applied_steps_count` | — |
| `partial_or_expr_indexes` | exactly `HrDocumentStoreAssignment_staff_grant_key, LaborSettings_org_default_key, StoreStaffAssignment_one_primary_key` | an object exists that no migration made, or one is missing. **Plan-changer.** |
| `check_constraints` | exactly `IngredientNutrition_basis_together, LaborAssignment_minutes_check, NotificationRecipientPick_one_target_check, hrdoc_grant_shape, hrdoc_link_shape` | same. **Plan-changer.** |
| `user_triggers`, `public_functions`, `views`, `sequences` | 0, 0, 0, 0 | an object the schema can't express that no migration made. **Plan-changer.** |
| `extensions` | `plpgsql`, plus anything Neon installs itself | anything else is listed and judged. It may need `CREATE EXTENSION` in `0_init`. |
| `pg_version` | ≥ 13 (for `gen_random_uuid()`) | — |

`contype = 'c'` excludes NOT NULL entries, which Postgres 18 stores as `'n'`.

---

## 8. Plan-changer status (prompt § Phase 1)

| Condition | Status |
|---|---|
| Any branch's schema differs from dev | **YES — staging, by 2 columns (F6).** Production matches dev. Phase 2 is held until staging gets the F6 ALTERs and its fingerprint matches dev/production. |
| A § 2 object can't be rebuilt exactly | **NO.** All 8 can be rebuilt verbatim; every column they reference is in the candidate with a compatible type. |
| Step 6 can't be pinned down from the installed CLI | **Pinned:** SHA-256 hex via `compute_checksum`. **Confirmation still open:** `tpl3_checksum` in § 7 B must equal the value in § 6. The row's `applied_steps_count`/`logs` values aren't readable from the binary, but `apply_migrations` doesn't depend on them. |

---

## 9. Findings outside the gate (triage)

**F1 — RULING NOW: keep the 87 old rows, or delete them as §2 says?** The
prompt's R2 keeps them and inserts `0_init`, and `migrate deploy` ignores the
orphans (§ 5). But `migrate status` reports divergence on every branch that
keeps them. And `migrate dev`, the command the squash exists to un-break,
runs `diagnose_migration_history`, sees "applied to the database but missing
from the local migrations directory", and offers to **reset dev**.
- **Recommendation:** keep the rows on staging and production (the prompt's
  plan; no deletion on a deployed ledger, and history is retained).
- On **dev only**, Gary deletes the 87 archived-name rows when he marks
  `0_init` (DELETE … WHERE migration_name <> '0_init' RETURNING …), so
  `migrate dev` works there.
- Alternatively, follow §2 and delete everywhere.

Gary's call either way. R2's wording would need a clause.

**F2 — RULING NOW (Phase 2 step 4): `--from-migrations` can't run
shadow-free.** The CLI passes the migrations list to the engine, which
replays it into a shadow database. With no `shadowDatabaseUrl`, and `.env`
has no `SHADOW_DATABASE_URL`, the engine creates a temporary
`prisma_migrate_shadow_db_*` **database on the configured server**: dev's
compute, with CREATE DATABASE, replaying `0_init`, then DROP DATABASE. That is
more than a read, and it isn't what CLAUDE.md's "migrate diff only reads"
assumes.
- **Recommendation:** Phase 2 skips step 4 and reports why. Phase 3 A step 3
  (deploy to `squash_test`, then diff, then empty) proves the same thing on
  Gary's side.
- Or Gary provides a throwaway `SHADOW_DATABASE_URL` and rules that Claude may
  run it against that.

**F3 — RULING NOW (DEPLOY_LOG recovery text):** the prompt's recovery step,
`migrate resolve --rolled-back 0_init`, run against staging or production is
a local connection to a deployed branch. **Recommendation:** use the console
`UPDATE … SET rolled_back_at = now()` in § 6, which keeps the console-only rule.

**F4 — FIX NOW, in Phase 2's docs commit (already in its scope):**
- §2's "seven at time of writing" → count from the table (8).
- §2's `rm -rf prisma/migrations/2026*` and `--to-schema-datamodel` instructions
  are superseded. `--to-schema-datamodel` isn't even a 7.8 flag; it is
  `--to-schema`.
- §3's `db execute` + `migrate resolve` flow and its "migrate dev is currently
  broken" note.
- CLAUDE.md § Database's "currently broken — the baseline squash was never
  done" sentence.

All of these are claims that become false when the squash lands.

**F5 — COMMENT:** even after the squash, `migrate dev` still needs
`SHADOW_DATABASE_URL`, which `.env` doesn't have. And CLAUDE.md forbids
Claude running `migrate dev` anyway. So "steps 2–4 collapse back to `migrate
dev`" (MIGRATIONS.md §3) is true only for Gary. The `migrate diff` flow stays
the session flow. Worth one sentence in the new "after the squash" section.

**F6 — FIX NOW (Gary, console), with a draft ruling: staging is missing
`receivedAt` on `PurchaseOrder` and `PurchaseOrderLine`.** Added 2026-11-05
after the § 7 results came back.
- **What Gary found:** both columns exist on dev and production (nullable
  timestamp, no default) and are missing on `preview/staging`
  (`br-square-feather-a63z92vz`). § 7 B passed on all three branches. It only
  checks the ledger and the 8 § 2a objects, so the columns showed up only in
  the full-schema comparison.
- **Exact type:** `schema.prisma:1480` and `:1503` declare `receivedAt
  DateTime?`. The candidate `0_init` (lines 637 and 655) emits `"receivedAt"
  TIMESTAMP(3)`, nullable, with no default, matching what Gary saw on dev and
  production.
- **Why no migration carried them:** `PurchaseOrder` and `PurchaseOrderLine`
  are two of the 20 BUG-25 tables, and no migration ever creates them. `grep
  receivedAt prisma/migrations` finds nothing. The schema gained the columns
  in `b3cb378` (I-5, 2026-07-06), so dev and production got them outside the
  migration history (db-push era). Staging's copies of these tables never did.
  This is the same class of gap BUG-25 describes, one level down: a column
  rather than a table.
- **Why it matters to the squash:** the cutover marks staging as already
  having `0_init`, so `0_init`'s `receivedAt` lines would never run there.
  Without a fix, staging would stay two columns short indefinitely, and the
  "every existing database matches `0_init`" premise would be false on
  staging. Today the app's PO code selects `receivedAt`, so PO reads on
  staging very probably already fail with "column does not exist" (not
  checked).
- **Fix:** two console ALTERs on `br-square-feather` only:
  `ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "receivedAt"
  TIMESTAMP(3);` and the same for `"PurchaseOrderLine"`. Nullable with no
  default, so Postgres changes only the catalog: no table rewrite and no data
  touched. Then a full-column fingerprint must match dev and production
  (Gary's reference: `column_count` 1356, `columns_hash`
  `161820680854ced30bf432c6943b5fa7`). The candidate `0_init`'s 1,348
  columns, plus `_prisma_migrations`' 8, also make exactly 1,356.
- **Draft ruling R4 (DEBT-125; numbered after the prompt's R1–R3, not
  CLAUDE.md's workflow R4):** before the squash, staging gets the two
  `receivedAt` columns by console ALTER (`ADD COLUMN IF NOT EXISTS`, nullable
  `TIMESTAMP(3)`, no default). The ALTERs run, and the fingerprint matches
  dev/production, before Phase 2 starts and before staging's `0_init`
  INSERT. No migration is written for them: `0_init` already carries both
  columns for fresh databases, and dev and production already have them.
  Recorded in DEPLOY_LOG as staging data/DDL drift repair, not a migration.

**Correction to this audit (2026-11-05):** there are **86** migration folders,
not 87. `ls -d prisma/migrations/*/` and `git ls-files` both give 86, and
every branch's `ledger_rows` is 86. The prompt's "87" was copied into § 5,
§ 7's expected table and F1 without being counted. Phase 2's fixture and docs
use 86.

**No new ROW** is proposed.

---

## 10. Commands run (verbatim)

```
npx prisma --version
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script -o /private/tmp/claude-501/-Users-garythomas-Claude-Projects-Froot/a661a2da-c044-4786-b2a2-3092233c0fd9/scratchpad/0_init.candidate.sql
npx prisma migrate diff --help
npx prisma migrate deploy --help
```

`migrate deploy --help` prints help only and opens no connection. No other
prisma command was run, and no SQL was run on any branch. The rest was `git`,
`grep`, `shasum`, `strings`/`nm` on the installed engine, and reads.

STOP. Gary runs § 7 and pastes the results.
