# Adopting real Prisma migrations

Why: schema changes used to be applied with `prisma db push` straight from a laptop
pointed at the production DB. That means the database shape never traveled through
staging → main with the code, and staging drifted (missing tables → 500s).
From now on, schema changes ship as migration files committed next to the code.

## Order matters
Do "Sync staging" (step 0) BEFORE baselining, or staging will be marked as
migrated while still missing tables.

---

## 0. Sync staging DB (if not done yet)
Get the staging branch connection string from Neon Console:

```bash
cd ~/Claude_Projects/Froot/froot
DATABASE_URL="<staging-branch-url>" npx prisma db push
```

This is the LAST time `db push` gets used.

## 1. One-time Neon setup (safety)
**Your local `.env` points at the `dev` branch** (`ep-late-water-a6k53nv2`),
repointed by BUILD-1/DEBT-4. It used to point at production, which is why this
section was written as a warning. `prisma migrate dev` can offer to WIPE the
database it's pointed at — never point it at prod.

**The repoint created a new trap in the opposite direction:** a local pre-check
now silently reads `dev` and returns a **false all-clear about production**. See
"Which branch am I actually reading?" below.

In Neon Console:
1. Create branch `dev` (from production) — your local development DB.
2. Create branch `shadow` (contents don't matter; Prisma resets it constantly).

In `froot/.env`:
```
DATABASE_URL="<dev branch connection string>"
SHADOW_DATABASE_URL="<shadow branch connection string>"
```
(Production/staging URLs live only in Vercel env vars, where they already are.)

## 2. One-time baseline (squash history into one init migration)
Existing DBs already have every table, but the migrations folder doesn't reflect
that. Rebuild it as a single migration, then tell each DB "you already have this."

```bash
cd ~/Claude_Projects/Froot/froot
rm -rf prisma/migrations/2026*            # old migrations stay in git history
mkdir -p prisma/migrations/0_init
npx prisma migrate diff --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/0_init/migration.sql
```

> ⚠️ **After regenerating `0_init`, re-append both partial indexes by hand or
> the baseline is wrong** — see "Protected indexes" below. `--to-schema-datamodel`
> generates from the schema, which cannot express them.

Reset migration bookkeeping on EACH existing DB (prod, staging, dev).
In the Neon SQL editor per branch (touches only Prisma's ledger table, no data):
```sql
DELETE FROM "_prisma_migrations";
```

Then mark the baseline as already-applied on each (per branch URL):
```bash
DATABASE_URL="<prod-url>"    npx prisma migrate resolve --applied 0_init
DATABASE_URL="<staging-url>" npx prisma migrate resolve --applied 0_init
DATABASE_URL="<dev-url>"     npx prisma migrate resolve --applied 0_init
```

Commit and ship:
```bash
git add prisma/migrations && git commit -m "Baseline migrations (squash to 0_init)"
git push origin staging
# verify the Vercel staging build passes (migrate deploy should say 'No pending migrations')
# then merge staging → main
```

## 3. The new normal (every schema change)

> **Connection routing (BUG-3, 2026-07-25):** all Prisma CLI commands
> (`migrate deploy`, `migrate diff --from-config-datasource`, `db execute`,
> `migrate status`) connect via `DATABASE_URL_UNPOOLED` — Neon's **direct**
> (non-pooled) endpoint, the pooled host with `-pooler` stripped — falling back
> to `DATABASE_URL` with a console warning if unset. Reason: Prisma's migration
> advisory lock (`pg_advisory_lock(72707369)`) leaked onto recycled pgbouncer
> backends, causing intermittent P1002 deploy failures. Local `.env` needs
> `DATABASE_URL_UNPOOLED` (dev-branch URL minus `-pooler`); Vercel already has
> it in all environments via the Neon integration. Runtime traffic still uses
> pooled `DATABASE_URL` (`src/lib/prisma.ts`). Proof on deploy: the build log's
> `Datasource "db"` line must show a host **without** `-pooler`.

> `prisma migrate dev` is currently broken here: the baseline squash (step 2)
> was never done, so shadow-DB replay of the old migration history fails with
> P3018 (and `.env` has no `SHADOW_DATABASE_URL`). Until the baseline lands,
> hand-author migrations instead:

```bash
# 1. edit prisma/schema.prisma
# 2. diff the schema against the live dev DB to generate the migration SQL
#    (timestamp format YYYYMMDDHHMMSS):
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma \
  --script -o prisma/migrations/<timestamp>_<name>/migration.sql
# 3. review the SQL, apply it, and record it in the migrations ledger:
npx prisma db execute --file prisma/migrations/<timestamp>_<name>/migration.sql
npx prisma migrate resolve --applied <timestamp>_<name>
# 4. regenerate the client:
npx prisma generate
# 5. commit the migration folder WITH the code that uses it
# 6. push staging → Vercel build runs `prisma migrate deploy` on the staging DB
# 7. test on staging → merge to main → same SQL runs on prod
```

Once the baseline squash is done and `SHADOW_DATABASE_URL` is set, steps 2–4
collapse back to `npx prisma migrate dev --name <name>`.

Rules:
- Never `db push` against staging or prod again.
- Never run `migrate dev` against staging or prod (it's the dev-only command).
- A migration file, once pushed, is immutable — fix mistakes with a new migration.

---

## Protected indexes — expressible only in migration SQL, not in the schema

Two unique indexes exist in every database but **cannot be written in
`prisma/schema.prisma`**, because Prisma has no `WHERE` clause on `@@unique`:

| Index | Table | Predicate | Origin |
|---|---|---|---|
| `LaborSettings_org_default_key` | `LaborSettings` | `WHERE "storeId" IS NULL` — one org-default row | `20260720000000_labor0_positions_settings_forecast` |
| `StoreStaffAssignment_one_primary_key` | `StoreStaffAssignment` | `WHERE "isPrimary"` — one primary store per staff member | `20260729145504_build2_staff_one_primary_store` |

### Hazard 1 — the baseline squash silently drops them

§2 rebuilds `0_init` with `migrate diff --from-empty --to-schema-datamodel`,
which generates **from the schema**. The schema cannot express either index, so
the regenerated baseline will **omit both**. Any database later built from
`0_init` — a fresh environment, a rebuilt Neon branch — comes up with **no
constraint and nothing failing loudly**. Re-append both by hand after
regenerating, and diff the result against this table.

### Hazard 2 — the schema misinforms a reader

`StoreStaffAssignment` shows only `@@unique([staffMemberId, storeId])`, which
constrains **membership, not primacy**. A developer reading the schema will
reasonably conclude nothing prevents two `isPrimary` rows. It does — here.

### What is NOT a hazard: generated diffs

**`prisma migrate diff` is blind to partial indexes in both directions.** It
neither creates nor drops them, so no generated diff will threaten these.
Verified 2026-07-29 on **branch dev (`ep-late-water-a6k53nv2`)**, twice, on two
different indexes:

- With `LaborSettings_org_default_key` physically present in `pg_indexes`, both
  `--from-config-datasource --to-schema` and the reverse `--from-schema
  --to-config-datasource` reported only an unrelated new column. Neither
  mentioned the index.
- After `StoreStaffAssignment_one_primary_key` was created, the shape diff still
  returned `-- This is an empty migration.` with exit code 0.

Recorded because it is easy to assume the opposite, and the wrong assumption
produces the wrong protection: an earlier draft of this section told readers to
watch every generated diff for a `DROP INDEX` line. That guard is unnecessary,
and worse, it would have replaced the real hazard above with a false one.

Disconfirming evidence, if it ever appears: a `DROP INDEX` for either name in
generated output. Two diffs in both directions on a branch that provably had the
index produced none.

## Which branch am I actually reading?

| Branch | Endpoint | Branch id | Seeded from | Use |
|---|---|---|---|---|
| `production` | `ep-green-smoke-a6xthq4r` | `br-sparkling-block-a620qvg4` | — | Neon console only. Never on disk. |
| `preview/staging` | `ep-odd-rain-a6gr4xmm` | `br-square-feather-a63z92vz` | **branched from `production`**, diverged per-table since | first target of every `migrate deploy` |
| `dev` | `ep-late-water-a6k53nv2` | `br-broad-wave-a6vpjdw0` | **branched from `production`** (§1) | local `.env`; every CLI command here |

Branch ids recorded 2026-08-01 from `docs/prompts/DEBT-2_AUDIT.md` (§`Q0`, `S0`,
`P0`), where each was measured against its endpoint before any query ran. They
make the identity check a direct comparison rather than an inference from the
host.

**Staging is a Neon child branch of production that has DIVERGED PER-TABLE since
its branch point — it was not separately seeded.** Narrowed 2026-08-01 (DEBT-31)
from an earlier version of this line that read "`dev` inherits production's data
shape; staging does not". That claim was too broad, and a wrong reason is what
lets someone conclude the opposite for a table they have not checked.

What the evidence actually supports, per table:

- **`StaffMember` HAS diverged.** Verified 2026-07-29 by running the same
  zero-primary query on both: **branch `preview/staging`** returned four ACTIVE
  staff (Aaliyah Rose 1, Chase Nyman 2, Gary Thomas 1, Kelton Thomas 3), while
  **branch `dev`** returned exactly what **branch `production`** had returned on
  2026-07-27 — Gary Thomas and Kelton Thomas, 9 assignments each. This is the
  observation the original line was written from, and it is real.
- **`Template` has NOT.** The 2026-06-27 row carries the same cuid
  (`cmqx004mk001d3apdv3b6h4mj`) on **branch `dev`**, **branch `preview/staging`**
  and **branch `production`** — identical id, identical `createdAt` to the
  millisecond. Rows are not independently seeded into the same cuid; that is
  shared ancestry. Staging then diverged on top of it (a second org with 8
  templates created 2026-07-11 that production has never had).

So per-table divergence, not a separate seed. The Neon console shows the
relationship directly: breadcrumb "production ↳ preview/staging".

Two consequences:

1. **A clean staging result is not evidence about production.** They are
   different data. Every result must name its branch (CLAUDE.md § Database
   Evidence).
2. **`dev` is the fair rehearsal for a production migration**, and staging is
   the fair rehearsal for the *deploy*. Both are worth running; they answer
   different questions.

---

## 2026-07-21 — 11 migrations applied to production with the L-3 promotion

The `staging → main` promotion (merge commit `9743899`) carried **11 migrations**
that existed on staging but not on `main`, applied to production Neon by
`prisma migrate deploy` during the Vercel build. All are **additive** (new tables
+ new nullable / `DEFAULT`ed columns; the one index change — `StaffMember`
global-unique `squareTeamMemberId` → per-org `@@unique` — only *relaxes* a
constraint, so it cannot fail existing data). No `DROP TABLE`, no `DROP COLUMN`,
no data-rewriting `UPDATE`/`DELETE`.

```
20260712120000_hr0_hr_training_compliance_schema
20260713080000_hr4_signed_record
20260713160000_hr5_fillable_forms
20260713200000_hr6_training_resource_order
20260713220000_hr7_staff_identity_training_execution
20260714120000_staff_square_id_per_org_unique
20260714150000_staff_uploaded_documents
20260720000000_labor0_positions_settings_forecast
20260720230000_labor2_daysplit_daypart_adjustment
20260721010000_labor3_gm_onfloor_window
20260721163612_labor3_daily_split_policy_weekly_day_hours
```

Applied cleanly (a first redeploy hit the transient Prisma **P1002** Neon-pooler
timeout — leaked advisory lock on the pooler; a retry went green). See
`DEPLOY_LOG.md` for the full promotion entry.

---

> **Ordering of this history section: OLDEST FIRST** — the opposite of
> `DEPLOY_LOG.md`, which is reverse-chronological with the newest entry at the
> top. Recorded 2026-08-01 because assuming one file's order from another's is
> exactly the error DEBT-23 was built on. Check with `grep -n "^## "` rather than
> inferring.

## 2026-07-29 → 2026-08-01 — three promotions, ZERO migrations

Recorded 2026-08-01 by DOCS-2. Between the BUILD-2 promotion and `97ed309`, three
production promotions carried **no migration files at all**. Stated explicitly
because this section records *which migrations rode which promotion*, and silence
here is indistinguishable from an unfinished entry — a reader reconstructing the
sequence needs "none, and here is why", not a gap.

| Promotion | Date | Carried | Migrations |
|---|---|---|---|
| `746c1be` | 2026-07-29 (am) | PERM-6, PERM-7, DEBT-8, DEBT-10, DEBT-14 | **none** |
| `493175e` | 2026-07-29 (pm) | BUILD-2 | **two** — see below |
| `63407be` | 2026-08-01 (pm) | DEBT-1, DEBT-2 and the 07-30 debt batch | **none** |
| `97ed309` | 2026-08-01 (eve) | the DEBT-SWEEP batch | **none** |

Verified per promotion with `git diff --stat <parent>..<sha> -- prisma/`, each
returning empty for the three zero-migration rows. `493175e` is the exception and
already has its own full accounting in `DEPLOY_LOG.md` under 2026-07-29:
`20260729124105_build2_user_default_store` and
`20260729145504_build2_staff_one_primary_store`. Those two remain the newest
migrations in `prisma/migrations/`.

### Why DEBT-1b's backfill is not in this list

`63407be` carried DEBT-1b, which **did** mutate production data — the
`operationalPhase` backfill from the legacy `"During Hours"` to the canonical
`"During the Day"`. It is absent from this section because it was deliberately
**not** a committed data migration. It ran as one-off approved SQL per branch in
the Neon console, ruled 2026-07-31.

The reasoning, in full in `docs/prompts/DEBT-1_AUDIT.md` § DEBT-1b remediation
record and in `DEPLOY_LOG.md`'s 2026-07-31 entry: `prisma/` was outside that
session's writable set, and a migration file would have fired **unattended** during
a Vercel build — taking the operator's hand off a production mutation that DEBT-1
had always required be approved per statement, per branch. No DDL ran, no
`_prisma_migrations` row was written, and code rollback and data rollback are
therefore fully independent for that change.

The consequence for anyone auditing this file: **`prisma/migrations/` is not a
complete record of what has mutated production data.** Approved-SQL events are
logged in `DEPLOY_LOG.md` instead, marked "NOT a promotion". Read both.
