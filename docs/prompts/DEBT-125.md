Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/DEBT-125.md and follow it.

# DEBT-125 — Baseline squash of prisma/migrations (closes BUG-25)

**TIER 3**: this touches the migration history of every database. Declare the tier before writing anything.
Branch: `staging`. Commit only — never push.
Stage only the files you touch. A move of the whole migrations folder counts as touched.

Claude runs only `prisma format`, `validate`, `generate` and `migrate diff`, and never connects to staging or production. Every command against a Neon branch other than dev is Gary's, and Gary runs staging and production SQL in the Neon console only.

## Gate
- Staging and main must be level. The one exception: staging may be ahead by the BUG-25 ratification docs commit. If anything else differs, STOP.
- Run `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` against dev. It must print an empty migration. If it doesn't, STOP: dev is behind the repo, and Gary applies the pending migrations himself.

## Why (plain English)
Twenty tables have no CREATE TABLE in any migration (BUG-25 / DEBT-125 rows), so a fresh `migrate deploy` dies at `20260706190000_i6_recipes_adjustments_prep`. The fix is to replace the 87-step history with one generated starting file, `0_init`, built from today's schema. Every existing database is then marked as already having it. Nothing about the live data changes.

## Phase 1 — Audit (read-only), then STOP
Write the findings to `docs/prompts/DEBT-125_AUDIT.md`.
1. Read `/Users/garythomas/Claude_Projects/Froot/froot/docs/MIGRATIONS.md` §2 (the squash plan and its two warnings) and CLAUDE.md's migration rules. Quote what applies.
2. **Objects the schema can't express.** Grep every migration for anything `migrate diff --from-empty` would NOT regenerate:
   - partial or expression indexes (`WHERE`, `lower(`, `USING gin`)
   - CHECK constraints, triggers, functions, views, extensions, sequences
   - manual `UPDATE`/data backfills, and anything §2 calls "protected indexes"

   List each with its migration file and whether it still exists in the live schema. Data backfills do NOT go into `0_init`, because a fresh database has no data. Say so for each one.
3. **The candidate `0_init`.** Generate it with `npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` into a scratch path, not under `prisma/migrations`. Report its CREATE TABLE count against the model count in the schema. They must be equal: 130.
4. **What references migration paths.** Fixtures, scripts, `vercel-build`, docs or the roadmap generator that read `prisma/migrations/*` by name. List each one.
5. **How Prisma 7.8 handles old rows.** Read the installed Prisma CLI's own docs/help in `node_modules`, not memory. Does `migrate deploy` tolerate `_prisma_migrations` rows whose folders no longer exist? Write down what you find. Phase 3's rehearsal proves it either way.
6. **The checksum for marking databases.** Find how Prisma 7.8 computes `_prisma_migrations.checksum`, and how a row for `0_init` is written (columns, values). Phase 4 marks staging and production with a Neon-console INSERT, never a local `migrate resolve`, which keeps the console-only rule. Draft that INSERT.
7. **Gary's comparison steps.** Write the steps for Gary to compare branch schemas in the Neon console:
   - schema diff of `br-broad-wave` against `br-square-feather`
   - schema diff of `br-broad-wave` against `br-sparkling-block`

   Data differences don't matter, only schema. Add one read-only query Gary runs on each branch that returns `current_setting('neon.branch_id', true)` and the `_prisma_migrations` row count and latest `migration_name`. Never hard-code a branch literal (CLAUDE.md R4).

STOP. Gary runs step 7 and pastes the results.
**Plan-changers:** STOP and report if any of these is true:
- any branch's schema differs from dev;
- a step-2 object can't be reconstructed exactly;
- step 6 can't be pinned down from the installed CLI.

## Phase 2 — Build (commits only, nothing pushed)
1. `git mv` every folder under `prisma/migrations/` (not `migration_lock.toml`) into `prisma/migrations_archive/`. Add a short README there: archived by DEBT-125, history only, never applied again.
2. Create `prisma/migrations/0_init/migration.sql`. It holds the Phase 1 step 3 output plus every step-2 object that still exists, appended by hand. Each appended object gets a comment naming the archived migration it came from. The file header cites DEBT-125 and BUG-25. Keep `migration_lock.toml`.
3. Re-point everything from Phase 1 step 4.
4. Run `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script` (shadow-free if the CLI allows; otherwise report why). The expected result is empty.
5. Fixture `scripts/verify-debt125.ts`, with no DB needed:
   - `prisma/migrations/` holds exactly `0_init` and the lock file;
   - the archive holds all 87;
   - the `0_init` CREATE TABLE count equals the model count;
   - every step-2 object is present by name;
   - all 20 BUG-25 tables (TaskAttachment included) are created.
6. Make a work commit and a docs commit. The docs commit carries:
   - the DEBT-125 row (`planned` → `in_progress`), with BUG-25 pointed at it;
   - MIGRATIONS.md: §2 marked done, a new "after the squash" section, and the ledger noting the archive;
   - CLAUDE.md: any migration-path references updated;
   - an UNPROMOTED DEPLOY_LOG entry;
   - a DECISIONS.md draft of R1–R3 (below).

   STOP. Do not push. Phase 3 is Gary's.

## Draft rulings (Gary ratifies at PRE-PUSH-CHECK)
- **R1:** Old migrations are archived in `prisma/migrations_archive/`, never deleted. Prisma never reads that folder.
- **R2:** Staging and production are marked as having `0_init` by a Neon-console INSERT into `_prisma_migrations`, run BEFORE the push that carries the squash. They are never marked by a local connection.
- **R3:** Objects the schema can't express live, hand-written, at the end of `0_init`, each one commented with its source.

## Phase 3 — Rehearsal (Gary, steps written out by the session in its Phase 2 report)
**A. Fresh rebuild.**
1. In the Neon console, create an empty database `squash_test` on the dev branch.
2. Run one command from the repo:

   ```
   DATABASE_URL="<squash_test url>" npx prisma migrate deploy
   ```

   It should apply `0_init` only.
3. Then run:

   ```
   DATABASE_URL="<squash_test url>" npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
   ```

   The result must be empty.

**B. Marking an existing database.**
1. In the Neon console, create a branch `squash-rehearsal` from dev. It carries dev's old `_prisma_migrations` rows.
2. Run the Phase 1 step 6 INSERT in that branch's SQL editor.
3. Run:

   ```
   DATABASE_URL="<rehearsal url>" npx prisma migrate deploy
   ```

   It must report nothing to apply and no error.

Delete `squash_test` and `squash-rehearsal` afterwards. If A or B fails, STOP and bring the output to the planning chat.

## Phase 4 — Cutover (Gary, after PRE-PUSH-CHECK; order is everything)
**Staging:**
1. Run the INSERT on `br-square-feather` in the Neon console.
2. Run the read-only query to confirm the row exists.
3. Push staging.
4. The Vercel build log must show `prisma migrate deploy` with no pending migrations.
5. Smoke test.

**Production:**
1. Run the INSERT on `br-sparkling-block`.
2. Run the read-only query to confirm the row exists.
3. Promote with the usual `--no-ff` merge.
4. Check the build log the same way.

**Dev:** run the INSERT on `br-broad-wave` (or `npx prisma migrate resolve --applied 0_init` locally, since dev is allowed).

If a push ever lands without the INSERT, the deploy fails on "already exists". No data is touched, but the failed row must be cleared with `migrate resolve --rolled-back 0_init` before the INSERT. Write that recovery into DEPLOY_LOG.

## Report
Classify out-of-scope findings as FIX NOW / RULING NOW / COMMENT / ROW. Report:
- the prisma commands run, verbatim;
- the SHAs;
- `git log --oneline @{u}..`;
- Gary's Phase 3 steps, written as one copyable command each.
