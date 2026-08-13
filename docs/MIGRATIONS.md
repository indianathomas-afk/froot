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

> ⚠️ **THE CURRENT MIGRATIONS FOLDER CANNOT REBUILD THE LIVE SCHEMA, AND THIS
> STEP WILL SILENTLY ADOPT THE DIFFERENCE RATHER THAN SURFACE IT.** Relocated
> here 2026-08-02 from DEBT-35, which closes on this relocation.
>
> Known instance, measured on **all three branches** 2026-08-01 — `dev`,
> `preview/staging` and `production` all have `Task.estimatedTimeMinutes` as
> `double precision`; `prisma/schema.prisma:311` says `Float?`; and the only
> migration that ever creates the column,
> `prisma/migrations/20260627002005_init/migration.sql:132`, says **`INTEGER`**.
> No migration alters it afterwards. The schema and the live databases agree
> with each other and **the LEDGER is the one that is wrong** — whatever changed
> the type reached production. Consistent with a `db push` from before that
> command was retired (2026-07-06 staging drift incident); not proven, and a
> migration altering the type would refute it. None exists.
>
> Why it belongs on THIS step specifically, and it is the same shape as Hazard 1
> below: `--to-schema-datamodel` generates from `schema.prisma`, so the
> regenerated `0_init` will say `DOUBLE PRECISION` — matching the live databases
> and **erasing the evidence that the ledger ever disagreed**. The squash is
> simultaneously the operation that would have surfaced this and the operation
> that makes it unfindable. Nothing fails; the discrepancy just stops existing.
>
> **So diff the regenerated `0_init` against a live branch's actual column types
> before marking it applied**, and treat `estimatedTimeMinutes` as one *known*
> instance rather than the only one — anything else from the same `db push` era
> would have exactly the same signature. Every environment is fine today only
> because none of them was built from these migrations.

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

Three unique indexes and one CHECK constraint exist in every database but
**cannot be written in `prisma/schema.prisma`** — Prisma has no `WHERE` clause
on `@@unique` and no CHECK support at all:

| Object | Table | Predicate | Origin |
|---|---|---|---|
| `LaborSettings_org_default_key` | `LaborSettings` | `WHERE "storeId" IS NULL` — one org-default row | `20260720000000_labor0_positions_settings_forecast` |
| `StoreStaffAssignment_one_primary_key` | `StoreStaffAssignment` | `WHERE "isPrimary"` — one primary store per staff member | `20260729145504_build2_staff_one_primary_store` |
| `HrDocumentStoreAssignment_staff_grant_key` | `HrDocumentStoreAssignment` | `WHERE "granteeType" = 'STAFF'` — one STAFF grant per (document, person) | `20260812171500_doc1a_document_audience_grants` |
| `hrdoc_grant_shape` (**CHECK**, not an index) | `HrDocumentStoreAssignment` | STORE rows carry `storeId` only; STAFF rows carry `staffMemberId` only | `20260812171500_doc1a_document_audience_grants` |

**Read the table name in those last two rows carefully.** The Prisma model is
`HrDocumentGrant`; the physical table is still `HrDocumentStoreAssignment`,
because DOC-1 A renamed the model with `@@map` rather than renaming the table
(a rename would have been a destructive migration to fix a name). Anything
touching raw SQL — these objects, a Neon console query, a hand-written
migration — sees the old name. The Prisma client sees the new one.

**Why the DOC-1 A partial index is needed at all**, since the table also carries
`@@unique([hrDocumentId, storeId])`: that key cannot constrain STAFF rows,
whose `storeId` is NULL. Postgres treats NULLs as distinct in a unique index, so
`(doc, NULL)` never collides with itself and a document could otherwise
accumulate unlimited duplicate grants to the same person. Verified 2026-08-12 on
dev — a second identical STAFF row was rejected with `23505` against this index,
and a STORE row carrying a `staffMemberId` was rejected with `23514` against the
CHECK.

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

### Hazard 3 — the index guarantees AT MOST one primary, not AT LEAST one

Relocated here 2026-08-02 from DEBT-9, which keeps the data task itself.

`StoreStaffAssignment_one_primary_key` is partial: `WHERE "isPrimary"` indexes
**only rows where the flag is TRUE**. A staff member with ZERO primaries
therefore contributes zero index entries, cannot collide with anything, and is
perfectly legal. **The constraint reads as "every staff member has one primary
store". It does not say that, and it never will.**

Two consequences that have both already bitten:

- **Zero-primary staff are invisible to the constraint and to any check built on
  it.** `primaryStoreName()` (`src/lib/hr.ts:65-73`) falls back to the
  alphabetically-first assignment, deterministically — so the value is
  stable-and-arbitrary, not correct, and the comment above that function says so
  in terms. On a signed HR document that value is frozen onto
  `HrDocumentAcknowledgment.storeName` and `FormSubmission.storeName` and stamped
  into the PDF. An alphabetical accident becomes a legal record.
- **A single-assignment row becomes ambiguous the instant a second store is
  added**, silently, and the index does not catch it — because zero primaries
  stay legal in both states.

There is also **no ordering dependency** between setting primaries and applying
the migration, in either direction, for the same reason: zero-primary rows
contribute nothing to index. An earlier instruction to set primaries *before* the
index landed was withdrawn on this basis (accepted 2026-07-29).

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

**Re-confirmed 2026-08-12 by DOC-1 A, and extended to CHECK constraints.** With
`HrDocumentStoreAssignment_staff_grant_key` *and* the `hrdoc_grant_shape` CHECK
both provably present on dev (`br-broad-wave-a6vpjdw0` — read back from
`pg_indexes` and `pg_constraint` minutes earlier), both directions returned
`-- This is an empty migration.`:

```bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
npx prisma migrate diff --from-schema prisma/schema.prisma --to-config-datasource --script
```

So the blindness covers CHECK constraints as well as partial indexes, and in
both directions. Recorded because DOC-1 A initially wrote the OPPOSITE into its
schema comment and its commit message — "a future generated diff will propose
dropping them" — reasoning from "Prisma cannot express it" to "Prisma will fight
it". This section already said otherwise, with evidence, and was not consulted
until the entry was being written. **The schema comment was corrected; the
migration file's header comment still carries the wrong claim and was
deliberately left alone**, because editing an applied migration changes the
checksum in `_prisma_migrations` and breaks `migrate deploy` on every branch that
already ran it. An applied migration is frozen even when it is wrong — put the
correction here.

Note the direction of the error, which is why it is worth writing down: it would
have sent a future reader hunting for a `DROP INDEX` line that never appears,
and left Hazard 1 — the one that actually drops these — unwatched.

## Hand-authored FK `ON DELETE` vs the schema's implied default

**When a hand-authored migration states an `ON DELETE` behaviour and
`schema.prisma`'s relation omits the `onDelete` annotation, the schema
misdescribes every live database — and unlike the partial-index blindness
above, `migrate diff` SEES this drift and generates SQL to "fix" it, i.e. to
relax the live constraint.** Prisma's defaults are `SetNull` for optional
relations and `Restrict` for required ones; hand-written SQL that chose
anything else must be mirrored by an explicit annotation or the next generated
diff opens with a `DROP CONSTRAINT` + re-`ADD` pair for a table nobody
touched.

Found 2026-08-10 by HR-20's own diff: `Template.templateType` carried no
`onDelete` (implied `SetNull`) while TPL-1a's migration created
`Template_typeId_fkey` `ON DELETE RESTRICT` on every branch — the ruled
behaviour; the Manage Types dialog's delete-blocked-while-in-use 409 depends
on it. The generated diff would have silently converted "deleting a type in
use refuses" into "deleting a type in use uncategorises its templates".
Annotated `onDelete: Restrict` in the schema the same day (`0a745c3`) —
schema-only, no database changed.

**The tell: a generated diff containing constraint churn for a table your
schema edit did not touch. Never paste that through; resolve the drift first.**
One instance is fixed; the sweep across every other hand-authored FK is
DEBT-68 (unowned).

### DOC-1 A: grant rows CASCADE with the staff member, by design

`HrDocumentStoreAssignment_staffMemberId_fkey` is `ON DELETE CASCADE`, annotated
`onDelete: Cascade` in the schema, so the two agree and no drift exists here.
Recorded because the *reason* is a policy decision rather than a convenience,
and DOC-1 A's grant rows sit next to the most delete-averse tables in this
schema:

**Access rules die with the person; records do not.** A grant answers "may this
person be shown this document" — a question that stops existing when the staff
member does. `HrSignedRecord` and `HrDocumentAcknowledgment` answer "did this
person sign this document", which never stops being true. So they carry **no
cascade at all** and deliberately block deletion of the version and staff member
they pin, while a grant is swept up with its subject. Deleting a staff member
removes their grants and cannot touch a signature they gave (ruling 4, Gary
2026-08-12 — signed records are permanent regardless of any later grant change).

The store side is `ON DELETE CASCADE` for the same reason it always was: a grant
naming a deleted store is unresolvable, not merely stale.

**The one thing this does NOT mean:** revoking access is not deletion. Documents
themselves are never hard-deleted (`isActive: false` is the pattern, ruling 8),
and un-assigning an audience is a grant-row change that leaves every signature
already on file intact and readable.

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

## 2026-08-12 — `20260812171500_doc1a_document_audience_grants` (DOC-1 A)

Applied to **dev only** so far (`br-broad-wave-a6vpjdw0`, direct endpoint
`ep-late-water-a6k53nv2`, no `-pooler`). Staging and production get it via
`migrate deploy` in the Vercel build on Gary's push — **not yet promoted at time
of writing**. Work commit `d728da4`.

| Statement | Kind |
|---|---|
| `HrDocument.appliesTo` `SET DEFAULT 'selected'` | default only — **no row rewritten** |
| `HrDocumentStoreAssignment` + `granteeType` (`NOT NULL DEFAULT 'STORE'`), `staffMemberId`, `createdById`, `createdAt` | additive columns |
| `HrDocumentStoreAssignment.storeId` `DROP NOT NULL` | widening — required, a STAFF grant has no store |
| index + FK on `staffMemberId` (`ON DELETE CASCADE`) | additive |
| `HrDocumentStoreAssignment_staff_grant_key`, `hrdoc_grant_shape` | hand-written — see § Protected indexes |

**No table was renamed.** The Prisma model `HrDocumentStoreAssignment` became
`HrDocumentGrant` in the same commit with `@@map` holding the physical name, so
the rename produced zero SQL and every pre-existing row is a valid STORE grant
under the new `granteeType` default.

**The default flip is the part to understand before promoting.** It changes what
NEW documents inherit and nothing else: every document that predates the
migration keeps `appliesTo = 'all'` and keeps reaching everyone, so no library
empties and no compliance denominator moves when this lands. Documents uploaded
*after* it start with zero grants and are ADMIN-only until Phase B's assign
dialog gives them an audience — intended, not a regression.

**Pre-promotion check (hard stop 4 of the DOC-1 A session prompt, Gary's to
run).** On production (`br-sparkling-block`), with the branch id in the same
output:

```sql
SELECT current_setting('neon.branch_id', true) AS branch_id,
       current_database(), count(*) FROM "HrDocument";
```

Zero → the fresh-start ruling holds and no backfill ships. Nonzero → **stop**: a
COMPANY-grant backfill for the existing rows becomes a ruling in planning chat
before this promotes. Note what makes this cheap to get wrong — because existing
rows keep `'all'`, a forgotten backfill does **not** break anything visible; it
simply leaves those documents company-wide forever, which is the correct default
but was never an explicit decision for real production content.
