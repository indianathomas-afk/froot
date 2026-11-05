Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/BUG-25.md and follow it.

# BUG-25 — TaskAttachment has no migration

**TIER 3** (migration). Declare the tier before writing anything.
Branch: `staging`. Commit only — never push. Stage only the files you touch.
Gate: staging and main must both be at `9c236f9`. If either isn't, STOP and report.
Claude never runs `migrate deploy`, `migrate dev`, `migrate reset`, `migrate resolve` or `db execute`, and never connects to staging or production. `prisma migrate diff`, `format`, `validate` and `generate` are allowed.

## The bug (filed in `1b598c6` during BUG-23)
The `TaskAttachment` model is in `/Users/garythomas/Claude_Projects/Froot/froot/prisma/schema.prisma`, but no file under `prisma/migrations/` mentions it. Dev evidently has the table. A database rebuilt from migrations alone would not, and task attachments would break.

## Phase 1 — Audit (read-only), then STOP
1. **Is it really missing?** Read the model's `@@map` and every `@map`, and search the migrations for the real table and column names, case-insensitive. If a migration creates it under the mapped name, report "not a bug", file nothing, and STOP: BUG-25 closes as a docs-only correction.
2. **How it got there.** Run `git log -S "TaskAttachment" --oneline -- prisma/` plus the mapped name. Find the commit that added the model and say whether it shipped with a migration. Note any sign it was created with `db push`.
3. **What the schema expects.** Using `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`, extract only the TaskAttachment DDL: the table, indexes and FKs, with their ON DELETE actions. That is the target.
4. **What the real databases have.** Write ONE read-only SQL query for Gary to run in the Neon console on each branch. Every result must include its branch literal. The query should return the table's existence, its columns (name, type, nullable, default), its indexes, and its FK constraints with their delete actions. Gary runs it on `br-broad-wave` (dev), `br-square-feather` (staging) and `br-sparkling-block` (production). Put the query in the report as a single copyable block.

STOP. Wait for Gary's three results, then compare each branch to step 3.
**Plan-changer:** if any branch's table differs from the schema (a missing column, a different FK action, a missing index), STOP and report the differences. That needs a ruling before any migration is written.

## Phase 2 — Build (only if all three branches match the schema)
1. Write the migration `prisma/migrations/<timestamp>_bug25_task_attachment_baseline/migration.sql` so it is **idempotent**. It does nothing on a database that already has the table, and creates the table on a fresh one:
   - `CREATE TABLE IF NOT EXISTS`
   - `CREATE INDEX IF NOT EXISTS`
   - each FK inside a `DO $$ … $$` block that checks `pg_constraint` by name first
   - names identical to step 3's DDL
   - a header comment citing BUG-25 and explaining why it is idempotent
2. **STOP after writing the file.** Gary applies it to dev with `npx prisma migrate deploy` and says go.
3. After Gary's go, run `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`. It must print an empty migration.
4. Fixture `scripts/verify-bug25.ts`, against dev: the table and every column, index and FK from step 3 exist with the right delete actions. Print the branch literal.

## Commits
Make a work commit (migration + fixture) and a docs commit. The docs commit carries:
- the BUG-25 row (`planned` → `in_progress`, nothing deleted)
- a MIGRATIONS.md entry explaining the idempotent baseline
- an UNPROMOTED DEPLOY_LOG entry, kept short
- a DECISIONS.md draft: "R1 — a table that exists without a migration gets an idempotent baseline migration, never `migrate resolve`"

Classify out-of-scope findings as FIX NOW / RULING NOW / COMMENT / ROW. In particular: are any **other** models in the schema missing from the migrations? Check every model and report a count. Do not fix others here. File one ROW listing them.

Report the prisma commands run (verbatim), the SHAs and `git log --oneline @{u}..`.

## Optional fresh-database proof (Gary, after push)
Make an empty Neon branch, point a terminal's `DATABASE_URL` at it, and run `npx prisma migrate deploy`. Then run the step 4 query on it: TaskAttachment should exist. Delete the branch afterwards.
