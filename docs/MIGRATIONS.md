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

> ✅ **DONE 2026-11-05 by DEBT-125 (closes BUG-25). Built in work commit
> `1c85892`. Branches are marked at cutover; see § 2a "After the squash" for
> what was built and how each branch is marked.** This section is kept as the
> plan it was. Where it differs from what was done, § 2a wins, and the
> differences are marked inline below (F4 of the DEBT-125 audit):
> - The old folders were **archived** with `git mv` into
>   `prisma/migrations_archive/` (R1), not `rm -rf`'d.
> - The flag is `--to-schema`. `--to-schema-datamodel` is not a Prisma 7.8 flag.
> - The ledger is **not** reset: Gary's F1 ruling keeps the 86 old rows on
>   every branch.
> - Marking is a Neon-console INSERT (R2), not a local `migrate resolve`.

Existing DBs already have every table, but the migrations folder doesn't reflect
that. Rebuild it as a single migration, then tell each DB "you already have this."

```bash
cd ~/Claude_Projects/Froot/froot
rm -rf prisma/migrations/2026*            # SUPERSEDED (R1): DEBT-125 used git mv into prisma/migrations_archive/
mkdir -p prisma/migrations/0_init
npx prisma migrate diff --from-empty \
  --to-schema prisma/schema.prisma \
  --script > prisma/migrations/0_init/migration.sql
```

> ⚠️ **After regenerating `0_init`, re-append every object in the "Protected
> indexes" table by hand — eight when DEBT-125 counted them, 2026-11-05 (three
> partial indexes and five CHECK constraints) — or the baseline is wrong.**
> `--to-schema` generates from the schema, which cannot express any of them. **Count them out
> of that table, not out of this sentence**, which said "both" from when there
> were two until DOC-3 made it five (2026-08-24), and "five" until L-4a found
> NOTIFY-12's CHECK missing and added its own (2026-10-30).

> ⚠️ **THE CURRENT MIGRATIONS FOLDER CANNOT REBUILD THE LIVE SCHEMA, AND THIS
> STEP WILL SILENTLY ADOPT THE DIFFERENCE RATHER THAN SURFACE IT.** Relocated
> here 2026-08-02 from DEBT-35, which closes on this relocation.
>
> Known instance, measured on **all three branches** 2026-08-01 — `dev`,
> `preview/staging` and `production` all have `Task.estimatedTimeMinutes` as
> `double precision`; `prisma/schema.prisma:311` says `Float?`; and the only
> migration that ever creates the column,
> `prisma/migrations_archive/20260627002005_init/migration.sql:132` (archived by
> DEBT-125), says **`INTEGER`**.
> No migration alters it afterwards. The schema and the live databases agree
> with each other and **the LEDGER is the one that is wrong** — whatever changed
> the type reached production. Consistent with a `db push` from before that
> command was retired (2026-07-06 staging drift incident); not proven, and a
> migration altering the type would refute it. None exists.
>
> Why it belongs on THIS step specifically, and it is the same shape as Hazard 1
> below: `--to-schema` generates from `schema.prisma`, so the
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
>
> **Done by DEBT-125, 2026-11-05.** Before the build, a full-column fingerprint
> (name, type, precision, nullability, default) of every `public` column was
> compared across all three branches. It found one real difference: staging
> lacked `receivedAt` on `PurchaseOrder` and `PurchaseOrderLine`. Gary added
> both by console ALTER (DEBT-125 R4). After that all three matched: 1356
> columns, which is `0_init`'s 1,348 plus `_prisma_migrations`' 8.
> `estimatedTimeMinutes` is `DOUBLE PRECISION` in `0_init`, matching the live
> branches.

**SUPERSEDED by DEBT-125 (F1, R2).** The ledger reset (`DELETE FROM
"_prisma_migrations"`), the three local `migrate resolve --applied 0_init`
commands, and the "commit and ship" block that followed them were NOT done.
They are removed here so nobody runs them. The old rows stay, and marking is
the console INSERT in § 2a.

## 2a. After the squash (DEBT-125, 2026-11-05)

**What is in the repo now (work commit `1c85892`):**
- `prisma/migrations/` holds `0_init/` and `migration_lock.toml`, nothing else.
  New migrations go here, next to `0_init`.
- `prisma/migrations_archive/` holds the 86 old folders (`20260627002005_init`
  … `20261104020000_tpl3_task_retired_at`), unchanged, with a README. **History
  only. Never move a folder back:** its SQL would run again on top of `0_init`.
  Prisma never reads the archive. The `verify-*` fixtures read it as text.
- `0_init/migration.sql`:
  - **PART 1** is the unedited `migrate diff --from-empty --to-schema` output:
    130 tables, all 20 BUG-25 tables included.
  - **PART 2** is the 8 § Protected-indexes objects, hand-written, each copied
    verbatim from its archived migration and commented with it (R3).
  - **sha256 `0e7d39aa0030e9c7adf485a92e7adc3f5038580a521b2ef707b9b6a752e4c717`.**
    This is the checksum every branch is marked with, so **`0_init` is never
    edited again**. `scripts/verify-debt125.ts` pins it.

**The ledger.** Every branch keeps its 86 old rows (Gary, F1).
`migrate deploy` ignores rows whose folders are gone. `migrate status` lists
them as divergence, and `migrate dev` would offer a reset, which is why
`migrate dev` is never run (§ 3). A branch is "on the squash" once it also has
one `0_init` row, written by this console INSERT (R2). Run it on each branch
in the Neon SQL Editor, picking the branch in the dropdown; there is no branch
literal (CLAUDE.md R4):

```sql
INSERT INTO "_prisma_migrations"
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid()::text,
       '0e7d39aa0030e9c7adf485a92e7adc3f5038580a521b2ef707b9b6a752e4c717',
       now(), '0_init', NULL, NULL, now(), 1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations"
                  WHERE migration_name = '0_init' AND rolled_back_at IS NULL)
RETURNING current_setting('neon.branch_id', true) AS neon_branch_id,
          id, migration_name, checksum, finished_at;
```

The INSERT returns one row the first time and zero rows if the branch is
already marked. `applied_steps_count = 1, logs = NULL` is the shape every
deploy-applied row on all three branches has (§ 7 `row_shapes`).

**ORDER IS EVERYTHING: a branch's INSERT runs BEFORE that branch's database
sees the squash.** On an unmarked branch, `migrate deploy` tries to run
`0_init`. That fails with "already exists" and leaves a failed `0_init` row,
which blocks every later deploy (P3009). No data is touched. **Recovery (F3,
console, not `migrate resolve`):**

```sql
UPDATE "_prisma_migrations" SET rolled_back_at = now()
WHERE migration_name = '0_init' AND finished_at IS NULL AND rolled_back_at IS NULL
RETURNING current_setting('neon.branch_id', true) AS neon_branch_id,
          id, migration_name, rolled_back_at;
```

Then run the INSERT, then redeploy.

**Where `0_init` reaches a database, and so what must be marked first:**
- **staging and production:** the Vercel build (`vercel-build` runs `prisma
  migrate deploy`) on the push or promotion that carries `1c85892`.
- **dev:** ANY local `npx prisma migrate deploy` from a checkout that
  contains `1c85892`, including CLAUDE.md's step 3 for the next schema
  change. Dev was due last in the DEBT-125 prompt's cutover. Until dev is
  marked, nobody runs `migrate deploy` against dev from this checkout.
- **Local commands that set a URL must set `DATABASE_URL_UNPOOLED`, not
  `DATABASE_URL`.** `prisma.config.ts` connects with `DATABASE_URL_UNPOOLED`
  first, and `.env` sets it to dev. dotenv never overrides a variable already
  set on the command line, so `DATABASE_URL_UNPOOLED="<url>" npx prisma …`
  reaches `<url>`. But `DATABASE_URL="<url>" npx prisma …` silently reaches
  **dev**. Confirm the `Datasource "db"` line names the intended database
  every time.

**Per-branch status:** see the ledger entry "2026-11-05 — `0_init`" at the end
of this file.

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

> **`prisma migrate dev` is never run, by anyone (Gary, DEBT-125 F1,
> 2026-11-05).** The squash replaced the history it couldn't replay, but every
> branch keeps its 86 archived-name ledger rows. `migrate dev` reads those as
> "applied to the database but missing from the migrations directory" and
> offers to RESET the database. `.env` also has no `SHADOW_DATABASE_URL`.
> Migrations are hand-authored with the flow below. (This note used to say
> "currently broken … until the baseline lands". It was corrected by
> DEBT-125, F4.)

```bash
# 1. edit prisma/schema.prisma
# 2. diff the schema against the live dev DB to generate the migration SQL
#    (timestamp format YYYYMMDDHHMMSS):
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma \
  --script -o prisma/migrations/<timestamp>_<name>/migration.sql
# 3. GARY applies it to dev (CLAUDE.md § Database, ruled 2026-10-16):
#    `env | grep -c DATABASE_URL` must print 0, then:
npx prisma migrate deploy      # Datasource host must be the dev endpoint
#    (Corrected by DEBT-125 F4: this step used to be `db execute` + `migrate
#    resolve`, which CLAUDE.md now forbids except as a workaround Gary
#    approves case by case.)
# 4. regenerate the client:
npx prisma generate
# 5. commit the migration folder WITH the code that uses it
# 6. push staging → Vercel build runs `prisma migrate deploy` on the staging DB
# 7. test on staging → merge to main → same SQL runs on prod
```

This flow is permanent. The old line here said that after the squash steps
2–4 "collapse back to `npx prisma migrate dev`". F1 ended that: `migrate dev`
is never run (above). A new migration folder goes in `prisma/migrations/`, next
to `0_init`, and sorts after it.

Rules:
- Never `db push` against staging or prod again.
- Never run `migrate dev`, on any branch (DEBT-125 F1).
- A migration file, once pushed, is immutable — fix mistakes with a new migration.

---

## Protected indexes — expressible only in migration SQL, not in the schema

Three unique indexes and **five** CHECK constraints exist in every database but
**cannot be written in `prisma/schema.prisma`** — Prisma has no `WHERE` clause
on `@@unique` and no CHECK support at all:

(Count corrected 2026-10-30 by L-4a, ruled by Gary as F1. It read "**two**"
CHECKs, but NOTIFY-12's `NotificationRecipientPick_one_target_check`
(2026-10-23) had already made three and was missing from the table below; L-4a
adds the fourth. Both rows are appended at the bottom.)
(Count "four" → "five" 2026-11-02 by N-1d, which appends
`IngredientNutrition_basis_together` at the bottom.)

| Object | Table | Predicate | Origin |
|---|---|---|---|
| `LaborSettings_org_default_key` | `LaborSettings` | `WHERE "storeId" IS NULL` — one org-default row | `20260720000000_labor0_positions_settings_forecast` |
| `StoreStaffAssignment_one_primary_key` | `StoreStaffAssignment` | `WHERE "isPrimary"` — one primary store per staff member | `20260729145504_build2_staff_one_primary_store` |
| `HrDocumentStoreAssignment_staff_grant_key` | `HrDocumentStoreAssignment` | `WHERE "granteeType" = 'STAFF'` — one STAFF grant per (document, person) | `20260812171500_doc1a_document_audience_grants` |
| `hrdoc_grant_shape` (**CHECK**, not an index) | `HrDocumentStoreAssignment` | STORE rows carry `storeId` only; STAFF rows carry `staffMemberId` only | `20260812171500_doc1a_document_audience_grants` |
| `hrdoc_link_shape` (**CHECK**, not an index) | `HrDocument` | `("kind" = 'Link') = ("externalUrl" IS NOT NULL)` — only a Link carries a URL, and every Link carries one | `20260824193000_doc3_document_links_and_instructions` |
| `NotificationRecipientPick_one_target_check` (**CHECK**, not an index) | `NotificationRecipientPick` | `("userId" IS NULL) <> ("contactId" IS NULL)` — exactly one target per pick | `20261023200000_notify12_recipients` |
| `LaborAssignment_minutes_check` (**CHECK**, not an index) | `LaborAssignment` | `"startMinutes" >= 0 AND "startMinutes" < "endMinutes" AND "endMinutes" <= 1440` — no overnight, no zero-length, inside one day | `20261030200242_l4a_labor_assignment` |
| `IngredientNutrition_basis_together` (**CHECK**, not an index) | `IngredientNutrition` | `("basisAmount" IS NULL) = ("basisUnit" IS NULL)` — a proof-only record has neither, a numbered one has both | `20261102220000_n1d_proof_only_nutrition` |

**Since DEBT-125 (2026-11-05), all eight also live in
`prisma/migrations/0_init/migration.sql` PART 2.** The Origin column names
folders now under `prisma/migrations_archive/`. A NEW protected object goes in
its own new migration and gets a row here. It is never appended to `0_init`,
which is frozen by its checksum (§ 2a). Hazard 1 now applies only if `0_init`
is ever regenerated.

**The DOC-3 row's table needs no `@@map` warning and that is worth stating,
because the two rows above it do.** `hrdoc_link_shape` sits on `HrDocument`,
whose Prisma model and physical table are BOTH `HrDocument` — the rename trap
described in the next paragraph applies to `HrDocumentGrant` only.

**`hrdoc_link_shape` states two thirds of an invariant, and the missing third is
not an oversight.** DOC-3's full rule is `kind = 'Link' ⇔ externalUrl IS NOT
NULL ⇔ zero HrDocumentVersion rows`. The first ⇔ is row-local and is the CHECK
above. The second is CROSS-TABLE, which no CHECK can express at any price — it
would take a trigger, and this codebase has none — so it is enforced in
`POST /api/hr/documents` (the Link branch writes no `versions.create`) and by
`POST /api/hr/documents/[id]/versions` being reachable only from a surface gated
on `kind === "Acknowledgment"`. **If you are ever tempted to "complete" this
constraint, that is the reason you cannot.**

**Read the table name in the `HrDocumentStoreAssignment` rows carefully** —
`HrDocumentStoreAssignment_staff_grant_key` and `hrdoc_grant_shape`. (Named
rather than counted from the end: they were "the last two rows" until DOC-3
appended one, and a positional pointer in a table that grows is a pointer that
goes wrong silently.) The Prisma model is
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

§2 rebuilds `0_init` with `migrate diff --from-empty --to-schema` (the old
`--to-schema-datamodel` flag no longer exists),
which generates **from the schema**. The schema cannot express any of them, so
the regenerated baseline will **omit all eight**. Any database later built from
`0_init` — a fresh environment, a rebuilt Neon branch — comes up with **no
constraint and nothing failing loudly**. Re-append **all eight** by hand after
regenerating, and diff the result against this table.

**"Both" became "all five" as the table grew, and the wording is worth watching.**
This paragraph said "either index" / "omit both" / "re-append both" while the
table listed four objects, because it was written when there were two and was
never re-counted as rows were added. A re-append instruction that names a number
smaller than the table is the one kind of staleness this section cannot survive:
it reads as complete, and what it silently omits is exactly what Hazard 1 drops.
Corrected 2026-08-24 by DOC-3, which added the fifth. **If you add a sixth,
this sentence is part of the edit.**

**It happened anyway, twice: corrected "five" → "eight" 2026-11-02 by N-1d.**
NOTIFY-12 (2026-10-23) added the sixth row and L-4a (2026-10-30) the seventh,
and neither updated the count above. N-1d adds the eighth,
`IngredientNutrition_basis_together`. Counted from the table at this edit:
three indexes and five CHECKs. A rule that tells the next editor to update a
number does not make them do it. **Count the table's rows; don't trust this
number.**

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

---

## 2026-08-15 — `20260815150000_hr11n_checkpoint_retirement` (HR-11n Phase A)

Applied to **dev only** so far (`ep-late-water-a6k53nv2`, direct endpoint, no
`-pooler`; database `neondb`). Staging and production get it via `migrate deploy`
in the Vercel build on Gary's push — **not yet promoted at time of writing**.

| Statement | Kind |
|---|---|
| `HrDocumentCheckpoint.retiredAt` `TIMESTAMP(3)` | additive, nullable, no default |
| `HrDocumentCheckpoint.retiredByUserId` `TEXT` | additive, nullable, no default — soft pointer, no FK |
| `HrDocumentCheckpoint.retiredReason` `TEXT` | additive, nullable, no default |

Three nullable columns and nothing else. No drops, no renames, no type changes,
no index changes, and **no backfill** — every existing row reads `retiredAt NULL`,
which is "live", so the migration moves no behaviour on its own. Promoting it
changes nothing until an admin retires something by hand.

`retiredByUserId` carries **no foreign key**, matching `DocumentAnchor.generatedCheckpointId`
and the `HrDocumentAcknowledgment` snapshot columns: a deleted user must never
cascade into, or block, a record of what was done. The admin UI resolves the name
org-scoped and falls back to "Unknown" — *who* retired a step is secondary
evidence, *that* it was retired is the record.

**The diff was clean, which is itself worth recording.** `migrate diff` compares
the whole schema against the live database, so any pre-existing drift on dev would
have appeared as extra statements in the generated file. Only these three lines
came out, so dev was in sync with `schema.prisma` at `0e49bdb`.

## 2026-08-24 — `20260824193000_doc3_document_links_and_instructions` (DOC-3 Phase 1)

Applied to **dev only** so far (`ep-late-water-a6k53nv2`, direct endpoint, no
`-pooler`; database `neondb`; `neon.branch_id` read back in the same query as
`br-broad-wave-a6vpjdw0`). Staging and production get it via `migrate deploy` in
the Vercel build on Gary's push — **not yet promoted at time of writing**.

| Statement | Kind |
|---|---|
| `HrDocument.externalUrl` `TEXT` | additive, nullable, no default |
| `HrDocument.instructionsHtml` `TEXT` | additive, nullable, no default |
| `HrDocument.instructionsVideoUrl` `TEXT` | additive, nullable, no default |
| `hrdoc_link_shape` CHECK | **hand-written — see § Protected indexes** |

Three nullable columns plus one hand-appended CHECK. No drops, no renames, no
type changes, and **no backfill**: every pre-existing row is a non-Link with a
NULL `externalUrl`, so both sides of the constraint read FALSE and `FALSE =
FALSE` is TRUE. The `ALTER` cannot fail on data, and promoting it moves no
behaviour on its own — nothing can create a Link until DOC-3 Phase 2 ships the
route.

**The CHECK was proven to FIRE, not merely to exist**, on dev
(`br-broad-wave-a6vpjdw0`) before the commit, because a constraint read back
from `pg_constraint` only proves it was created:

- `SELECT pg_get_constraintdef(...)` → `CHECK (((kind = 'Link'::text) = ("externalUrl" IS NOT NULL)))`
- `INSERT` of a **Link with a NULL `externalUrl`** → rejected, **`23514`**
- `INSERT` of a **Reference carrying an `externalUrl`** → rejected, **`23514`**
- `INSERT` of a well-formed Link → accepted, and read back with `version_rows = 0`

Both directions matter and that is why both were run: a one-sided constraint
(`kind = 'Link' → externalUrl IS NOT NULL`) would have passed the first probe and
silently allowed the second. Same method DOC-1 A used for `hrdoc_grant_shape`,
whose `23514` is recorded in § Protected indexes. The harness was a temporary
`npx tsx` script against the dev database; it deleted its own rows (`deleted
rows: 1` — the two rejected inserts never landed) and was removed before the
commit.

**The generated half of the diff was clean.** `migrate diff` compares the whole
schema against the live database, so any pre-existing drift on dev would have
surfaced as extra statements. Only the three `ADD COLUMN` lines came out, so dev
was in sync with `schema.prisma` at `648e6da`.

## 2026-09-17 — `20260917143000_cal1_calendar` (CAL-1)

**CORRECTED 2026-09-18 (DOCS-5), citing Gary in chat the same day. THIS
MIGRATION IS APPLIED ON ALL THREE LIVE BRANCHES** — dev `br-broad-wave` at
13:26Z by Gary's own `migrate deploy`; staging `br-square-feather` and
production `br-sparkling-block` through `migrate deploy` in the Vercel build,
production's being the build of promotion `53cb9ce`. SQL confirms it from the
database side on each: **`calendar_tables = 4` on all three.** Production also
reads `orgs_enabled = 0`, which is the ruling-9 inert state the paragraph below
predicts — the schema is there and the toggle is off for every org.

**This correction is outside the CAL-2 scope this session was given**, and is
written anyway because the two entries sit one above the other and leaving one
reading "APPLIED NOWHERE" while correcting the other would make this file worse
than either sentence alone.

**ORIGINAL PARAGRAPH, PRESERVED VERBATIM** — true when written, and the
generation-method reasoning that follows it is unaffected:

**APPLIED NOWHERE. Not dev, not staging, not production.** This is the first
entry in this ledger written for a migration that has not touched a database at
all, and it says so at the top rather than in a footnote. Gary applies it to dev
(`prisma db execute` + `migrate resolve --applied`, §3 above), then pushes so
staging and production take it through `migrate deploy` in the Vercel build.
Until dev has it, **every calendar query fails at runtime on every branch,
including local dev** — there is no `CalendarEvent` table anywhere.

| Statement | Kind |
|---|---|
| `Organization.calendarEnabled` `BOOLEAN NOT NULL DEFAULT false` | additive, defaulted |
| `CalendarEvent` | new table |
| `CalendarEventStoreAssignment` | new table |
| `CalendarEventAttachment` | new table |
| `CalendarOccurrence` | new table |
| 2 indexes + 3 unique indexes | new |
| 10 foreign keys | new |

Four new tables and one new column. **No drops, no renames, no type changes, no
backfill.** The new column is `NOT NULL DEFAULT false`, so every existing
`Organization` row lands with the calendar off — which is also the ruling-9
inert state, so promoting this migration changes no behaviour on its own.
Nothing can create a calendar row until an admin turns the toggle on. The
`ALTER` cannot fail on data and the four `CREATE TABLE`s have no data to fail on.

**It was generated WITHOUT TOUCHING A DATABASE, and that is a deviation from §3
worth reading before you copy it.** The documented flow is `migrate diff
--from-config-datasource --to-schema prisma/schema.prisma`, which introspects
the live dev database. The dev Neon branch was unreachable during the CAL-1
build (`Can't reach database server at ep-late-water-a6k53nv2…`, endpoint
asleep), so the diff was taken **file to file** instead:

```bash
git show HEAD:prisma/schema.prisma > /tmp/schema_head.prisma
npx prisma migrate diff --from-schema /tmp/schema_head.prisma \
  --to-schema prisma/schema.prisma --script \
  -o prisma/migrations/20260917143000_cal1_calendar/migration.sql
```

**Note what that costs, because the DOC-3 entry above depends on the opposite
property.** `--from-config-datasource` compares the whole schema against the
LIVE DATABASE, so pre-existing drift on dev surfaces as extra statements — which
is how DOC-3 could assert "dev was in sync with `schema.prisma` at `648e6da`".
The file-to-file diff **cannot see drift at all**. It compares two commits of a
text file, so it produces exactly the delta this session authored and would stay
silent about a dev database that had wandered. So:

- What this diff proves: the SQL is the faithful delta of this session's schema
  edit, with nothing extra and nothing missing.
- What it does NOT prove: that dev matches `schema.prisma` at `bb675e1`. **If
  `db execute` errors on an object that already exists, that is drift, and it is
  the check this generation method skipped** — not a fault in the SQL.

For a migration that must not be applied locally anyway, the trade is a good
one: it is the only generation method that cannot accidentally write. But a
future session with a reachable dev branch should prefer §3's form.

**`onDelete` choices, stated because they were decisions** (see § Hand-authored
FK `ON DELETE` vs the schema's implied default):

- `organizationId` → `RESTRICT`, matching `UsageDaily`. An org is never deleted
  in this product, and a cascade there would be a silent mass delete.
- event → assignments / occurrences / attachment → `CASCADE`. An occurrence has
  no meaning without its event, and archive rather than delete is the normal
  path regardless.
- `storeId` → `CASCADE`, matching `TemplateStoreAssignment`.
- `completedByUserId` and `completedByStaffId` → **`SET NULL`, and this one is
  load-bearing.** Deleting a user must never erase the fact that the work was
  done: the occurrence keeps `status = 'Completed'` and its `completedAt`, and
  loses only the attribution.

**Three columns are `DATE`, not `TIMESTAMP(3)`** — `CalendarEvent.startDate`,
`CalendarEvent.endDate`, `CalendarOccurrence.dueDate`. Deviation **S5-D77**,
approved by Gary. A calendar date is not an instant, and CLAUDE.md § Database
Evidence records the UTC/local misreading producing three confident wrong
conclusions in one day; a `DATE` column has no time to misread. `UsageDaily.date`
is the existing precedent. **`CalendarOccurrence.dueAt` is deliberately
`TIMESTAMP(3)`** — it is a real instant, frozen at materialisation, and the only
column in these four tables a timezone question can be asked of.

## 2026-09-18 — `20260918180000_cal2_scheduled_checklists` (CAL-2)

**CORRECTED 2026-09-18 (DOCS-5), citing Gary in chat the same day. THIS ENTRY
SAID "APPLIED NOWHERE" AND IT WAS ALREADY APPLIED ON DEV WHEN THE SENTENCE WAS
WRITTEN.** `20260918180000_cal2_scheduled_checklists` was applied to the dev
branch `br-broad-wave` at **19:50:06Z**, and to staging `br-square-feather` at
**20:01:31Z** — the second through `prisma migrate deploy` in the Vercel build
that followed Gary's push, which is the documented path and needs no correction.
The dev one does: **19:50:06Z falls inside the CAL-2 build session**, so the
migration was applied to dev while that same session was reporting it "not run
locally".

**THE CAL-2 BUILD SESSION APPLIED IT — not Gary.** Settled by Gary in chat
2026-09-18, correcting this entry's first draft, which had recorded the hand as
unsettled and named him as the presumption. **So the session applied the
migration to the dev branch and then reported it "not run locally" in the same
run** — the contradiction is not a stale sentence, it is a session describing
something it had just done. Note what that also means against §3 above and
CLAUDE.md's rule that Claude never touches a database: this application was not
Gary's to make.

**Gary's own runs were both later and neither applied anything.** A capital-F
attempt at roughly 13:40 PDT, from `Froot/` rather than `Froot/froot/`, aborted
before the install finished; then a lowercase run from the repo itself, which
**found nothing pending** — because the build session had already applied it an
hour and a half earlier. That empty result is the corroboration, not an anomaly:
it is what a correct `migrate` run looks like against a branch that is already up
to date.

**Production still does not have it, and that is correct rather than outstanding.**
CAL-2 is on `origin/staging` and is not in `53cb9ce`; `br-sparkling-block` takes
this migration in the Vercel build of whatever merge promotes the phase. The
runtime-failure warning in the original paragraph below is answered for dev and
staging and remains true, harmlessly, for a production database no CAL-2 code is
deployed against.

**THE PROMOTION HAPPENED — added 2026-09-19 (DOCS-6), the paragraph above kept
as written.** CAL-2 reached `main` on 2026-09-18 in `d2b8d79` ("promote:
CAL-1b, DOCS-4, CAL-2, CAL-2a, DOCS-5, CAL-2b"), so "the merge that promotes
the phase" is no longer hypothetical and `br-sparkling-block` takes this
migration in that merge's Vercel build. **Not verified against the branch
here** — a docs session does not read a deployed database (CLAUDE.md
§ Environment Variables) — so what is recorded is the promotion and the path,
not a production count. The next session with a reason to look at
`br-sparkling-block` owes the count.

**ORIGINAL PARAGRAPH, PRESERVED VERBATIM** — it was believed when written, and
the claim it makes is the record of what the build session thought it knew:

**APPLIED NOWHERE at the time of writing. Not dev, not staging, not
production.** Gary applies it to dev (`prisma db execute` + `migrate resolve
--applied`, §3 above), then pushes so staging and production take it through
`migrate deploy` in the Vercel build. Until dev has it, every query touching
`Checklist.calendarOccurrenceId` or `CalendarEvent.templateId` fails at runtime
on every branch — which is every calendar read, the day-close cron, the
operations report and both checklist creation paths.

| Statement | Kind |
|---|---|
| `CalendarEvent.templateId` `TEXT` (nullable) | additive, no default |
| `Checklist.calendarOccurrenceId` `TEXT` (nullable) | additive, no default |
| `Checklist_calendarOccurrenceId_key` | new UNIQUE index |
| `CalendarEvent_templateId_idx` | new index |
| 2 foreign keys | new |

**No drops, no renames, no type changes, no backfill.** Both columns are
nullable with no default, so every existing row lands `NULL` — which is the
correct value for all of them: a checklist that predates this phase was not made
by an occurrence, and an event that predates it schedules no template.

**Precheck: none owed, and the unique index is the only part that could have
needed one.** `CREATE UNIQUE INDEX` on a nullable column would fail on duplicate
values — but **PostgreSQL permits unlimited NULLs in a unique index**, and every
existing `Checklist` row has `NULL` here because the column did not exist a
statement earlier. There is no data for either `ALTER` to fail on and no row for
either FK to violate.

**GENERATED AGAINST THE LIVE DEV DATABASE, which is the documented §3 form and
NOT what CAL-1 could do.**

```bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma \
  --script -o prisma/migrations/20260918180000_cal2_scheduled_checklists/migration.sql
```

**Note what that buys over CAL-1's file-to-file diff, because the CAL-1 entry
above explicitly asks the next session to prefer this form if it can.**
`--from-config-datasource` compares the whole schema against the **live dev
database**, so pre-existing drift surfaces as extra statements in the output.
The diff returned **exactly this session's delta and nothing else** — so:

- What this diff proves, as CAL-1's did: the SQL is the faithful delta of this
  session's schema edit, nothing extra, nothing missing.
- **What it proves that CAL-1's could not: dev was in sync with
  `prisma/schema.prisma` at `ed98ff2`.** A file-to-file diff compares two commits
  of a text file and would stay silent about a dev database that had wandered.
  This one would not have.

The dev branch was reachable this time (endpoint `ep-late-water`); CAL-1's was
asleep, which is the whole reason that entry documents a deviation.

**`onDelete` choices, stated because they were decisions** (see § Hand-authored
FK `ON DELETE` vs the schema's implied default):

- **`CalendarEvent.templateId` → `RESTRICT`.** Prisma's implied default for an
  OPTIONAL relation is `SET NULL`, and that is wrong here: it would leave an
  event whose entire meaning is *"this template runs on Mondays"* pointing at
  nothing, and the invariant the Event form depends on — `templateId` set means
  template-backed — would break with no error anywhere. A scheduled template is
  ARCHIVED, never deleted. `Checklist.template` is already `RESTRICT` by the same
  implied rule, so a template that has ever generated a checklist is already
  undeletable; this makes a *scheduled* one undeletable too, one step earlier.
- **`Checklist.calendarOccurrenceId` → `SET NULL`, and it is the SAFETY NET
  rather than the policy.** The policy lives in `PATCH
  /api/calendar/events/[id]`, which decides per row whether an Open occurrence
  may be dropped at all — it refuses to drop one whose checklist somebody has
  already started, and deletes the unstarted checklist along with its occurrence.
  `SET NULL` exists so that a path nobody anticipated degrades to an **untracked
  checklist** rather than to a foreign-key error inside a cron. An untracked
  checklist is a known, survivable state: it is exactly what every pre-CAL-2
  non-Daily row already is.

**The unique index is the "one occurrence, one checklist" invariant** and it is
expressed in the schema rather than only in code, so a second linked checklist
cannot be written even by a path that forgot to check.

## 2026-09-20 — `20260920120000_hr16_ack_recipients` (HR-16)

**APPLIED TO PRODUCTION 2026-09-20 in promotion `076ccf8`** (staging -> main,
merged 20:31:24 -0700 Pacific), through `prisma migrate deploy` in that merge's
Vercel build. **THIS RECORDS THE PATH, NOT A COUNT.** No production database
was read by the session that wrote this line — `br-sparkling-block` is reached
only through the Neon console (CLAUDE.md § Environment Variables), and a docs
session does not read a deployed database. The chain the claim rests on is:
`migrate deploy` runs in `vercel-build`, a failed migration fails the build,
and Gary reported the production deploy succeeded. **A SQL confirmation on
`br-sparkling-block` is owed and is Gary's**, on the CAL-1 precedent above
where the correction cited a real count on each of the three branches.

**DEV AND STAGING ARE ALSO NO LONGER OUTSTANDING**, so the "APPLIED NOWHERE"
paragraph preserved below is spent in full. Dev has it: `verify-f5-polish.ts`
ran 63/63 against the dev branch on 2026-09-20, and every `Organization` create
in that fixture selects all scalar columns — including this one — so the run
could not have passed without it (the same mechanism NOTIFY-2a's row names).
Staging took it through `migrate deploy` on the push that preceded this
promotion.

**ORIGINAL PARAGRAPH, PRESERVED VERBATIM** — true when written:

**APPLIED NOWHERE. Not to dev, not to staging, not to production.** This is the
first entry in this file whose migration has been applied to no database at all
at the time of writing, and that is the CLAUDE.md § Database rule working as
intended rather than an omission: `migrate diff` reads and writes a file,
Claude runs nothing else, and step 3 is Gary's. Dev gets it by hand or not at
all; staging and production get it via `prisma migrate deploy` in the Vercel
build on Gary's push.

| Statement | Kind |
|---|---|
| `Organization.hrAckRecipients` `TEXT[] DEFAULT ARRAY[]::TEXT[]` | additive, defaulted, not null-able-relevant — an empty array, never NULL |

One column and nothing else. **No drops, no renames, no type changes, no index
changes, no backfill.**

**Every existing row lands on `ARRAY[]::TEXT[]`, which is the correct value for
all of them, and this matters more here than for a typical default.** The column
decides who receives real email: staging runs
`NOTIFY_EMAIL_PROVIDER=resend` (NOTIFY-1, `1c21368`), so a default that
resolved to anything other than empty would mail a live address the moment the
first acknowledgment completed after the deploy. Empty means the code path runs,
finds no recipients, logs a named skip and sends nothing — so promoting this
migration moves no behaviour on its own, and cannot until an admin types an
address into /settings.

**A Postgres array column with a default is never NULL here.** Prisma's
`String[]` maps to `TEXT[] NOT NULL`-in-effect via the default; the generated
statement carries `DEFAULT ARRAY[]::TEXT[]`, so the `ALTER` has no data to fail
on and no row to leave in an unreadable state. `src/lib/hr-ack-notification.ts`
reads `.length === 0` with no null guard, which is correct for this shape.

**GENERATED AGAINST THE LIVE DEV DATABASE — the documented §3 form.**

```bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma \
  --script -o prisma/migrations/20260920120000_hr16_ack_recipients/migration.sql
```

**The diff came back clean, and that is the part worth recording.**
`--from-config-datasource` compares the whole schema against the live dev
database, so any pre-existing drift would have surfaced as extra statements in
the output. **Exactly one `ALTER TABLE` came out and nothing else** — so dev was
in sync with `prisma/schema.prisma` at `13bccff`, and the SQL is the faithful
delta of this session's one-column edit.

**No `ON DELETE` choice was made** (see § Hand-authored FK `ON DELETE` vs the
schema's implied default): the column is a scalar list, not a relation. It holds
addresses as text, deliberately not a join to `User` — F-5's pace alerts derive
recipients from ADMIN/MANAGER user emails (`src/lib/pace-alerts.ts:98`) and
HR-16 does not, because "who at corporate hears about signatures" is a choice an
admin makes rather than a consequence of who holds a role. An address here need
not belong to a Froot user at all.

**No protected index is involved**, so § Protected indexes needs no new row and
a future baseline squash has nothing extra to re-append for this migration.

---

## 2026-09-20 — `20260920190000_f5b_pace_alerts_toggle` (F-5b)

**APPLIED TO PRODUCTION 2026-09-20 in promotion `076ccf8`** (staging -> main,
merged 20:31:24 -0700 Pacific), through `prisma migrate deploy` in that merge's
Vercel build. **THIS RECORDS THE PATH, NOT A COUNT.** No production database
was read by the session that wrote this line — `br-sparkling-block` is reached
only through the Neon console (CLAUDE.md § Environment Variables), and a docs
session does not read a deployed database. The chain the claim rests on is:
`migrate deploy` runs in `vercel-build`, a failed migration fails the build,
and Gary reported the production deploy succeeded. **A SQL confirmation on
`br-sparkling-block` is owed and is Gary's**, on the CAL-1 precedent above
where the correction cited a real count on each of the three branches.

**DEV WAS ALREADY RECORDED BELOW AND STILL HOLDS** — re-confirmed 2026-09-20
by `verify-f5-polish.ts` passing 63/63 against dev, which creates and reads
`Organization` rows carrying this column. Staging took it through
`migrate deploy` on the push that preceded this promotion, so the "neither
staging nor production" half of the paragraph below is now spent.

**ORIGINAL PARAGRAPH, PRESERVED VERBATIM** — true when written:

**APPLIED TO DEV BY GARY, not by this session; applied to neither staging nor
production.** Staging and production get it via `prisma migrate deploy` in the
Vercel build on Gary's push. The session ran `migrate diff` and nothing else —
CLAUDE.md § Database, `DEBT-103`.

| Statement | Kind |
|---|---|
| `Organization.paceAlertsEnabled` `BOOLEAN NOT NULL DEFAULT false` | additive, defaulted, NOT NULL — no nullable window, no backfill |

One column and nothing else. **No drops, no renames, no type changes, no index
changes, no backfill.**

**Every existing row lands on `false`, and that is the phase's safety argument
rather than a convention.** The column gates the only email Froot sends to
MANAGERS. Staging already runs `NOTIFY_EMAIL_PROVIDER=resend` and production is
expected to follow — and the two features share one sender with HR-16, so a
default of `true` would have made setting that variable in the Production scope
start mailing real Keva admins and managers as a *side effect of a change made
for a different feature*. `false` means promoting this migration moves no
behaviour at all: the cron's store query requires the column, finds no org with
it set, evaluates nothing, writes no `PaceAlertLog` row and sends nothing until
an admin turns it on at /settings.

**`NOT NULL DEFAULT false` means the `ALTER` has no data to fail on and leaves
no row in an unreadable state.** Prisma's `Boolean @default(false)` generates
exactly that; there is no nullable phase and no separate backfill statement, so
the migration is safe to apply to a table of any size under `migrate deploy`.

### THE PART OF THIS ENTRY WORTH READING — the diff was NOT clean on the first attempt, and committing it would have broken the staging deploy

**`docs/MIGRATIONS.md`'s HR-16 entry states that
`20260920120000_hr16_ack_recipients` was "APPLIED NOWHERE. Not to dev, not to
staging, not to production." That was still true when F-5b's audit ran, and the
audit measured it rather than assuming it.** A read-only diff taken at that
moment returned HR-16's column as still outstanding against the live dev
database.

**Consequence, had the documented §3 command simply been run and its output
committed:** `migrate diff --from-config-datasource` would have emitted **two**
`ALTER TABLE` statements into this folder — `hrAckRecipients` *and*
`paceAlertsEnabled`. On the staging build, `migrate deploy` applies migrations in
timestamp order: `20260920120000_hr16_ack_recipients` first, adding the column,
then this folder, re-adding it → **Postgres `42701`, column already exists →
the deploy fails**, and the failed migration blocks every later one until it is
resolved by hand.

**The file would have passed review.** Both statements are additive, neither
drops anything, and it satisfies every rule in § 3 and § Protected indexes. The
defect would not have been in the SQL — it would have been in the SQL having
been generated against a database one migration behind the repo.

**How it was resolved (F5, Gary, 2026-09-20):** Gary applied HR-16 to dev, and
the session **re-ran the read-only diff until it came back empty before
generating anything.** It took two attempts — the first re-run still showed
HR-16 outstanding and the session stopped rather than proceed. The alternative
considered and rejected was to generate the dirty file and hand-strip the
duplicate statement.

**The general rule, which is the reason this section exists at length:**
`--from-config-datasource` compares the schema against **the live dev
database**, so it is only as trustworthy as that database is current. **When the
previous phase's migration has not been applied to dev, the next phase's
generated file is contaminated by default — and contaminated in a way that reads
as correct.** Before generating any migration, run the diff with no `-o` and
confirm what comes back is only your own change.

**GENERATED AGAINST THE LIVE DEV DATABASE — the documented §3 form.**

```bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma \
  --script -o prisma/migrations/20260920190000_f5b_pace_alerts_toggle/migration.sql
```

**The diff came back clean on the run that produced this file** — exactly one
`ALTER TABLE` and nothing else — so dev was in sync with `prisma/schema.prisma`
apart from this session's one-column edit, and the SQL is the faithful delta of
that edit. Confirmed a third time after Gary applied this folder to dev: the
same command with no `-o` returned `-- This is an empty migration.`

**No `ON DELETE` choice was made** (see § Hand-authored FK `ON DELETE` vs the
schema's implied default): the column is a scalar boolean, not a relation.

**No protected index is involved**, so § Protected indexes needs no new row and
a future baseline squash has nothing extra to re-append for this migration.

---

## 2026-09-20 — `20260920210000_notify2a_pace_threshold` (NOTIFY-2a)

**APPLIED TO PRODUCTION 2026-09-20 in promotion `076ccf8`** (staging -> main,
merged 20:31:24 -0700 Pacific), through `prisma migrate deploy` in that merge's
Vercel build. **THIS RECORDS THE PATH, NOT A COUNT.** No production database
was read by the session that wrote this line — `br-sparkling-block` is reached
only through the Neon console (CLAUDE.md § Environment Variables), and a docs
session does not read a deployed database. The chain the claim rests on is:
`migrate deploy` runs in `vercel-build`, a failed migration fails the build,
and Gary reported the production deploy succeeded. **A SQL confirmation on
`br-sparkling-block` is owed and is Gary's**, on the CAL-1 precedent above
where the correction cited a real count on each of the three branches.

**DEV AND STAGING ARE ALSO NO LONGER OUTSTANDING.** Gary applied this to dev
on 2026-09-20 — recorded on the NOTIFY-2a ROADMAP row, whose PRE-PUSH-CHECK
rider notes the fixture went green only after that apply, because every
`Organization` read selects this column. Re-confirmed by the 63/63 run on
2026-09-20. Staging took it through `migrate deploy` on the push that preceded
this promotion.

**ORIGINAL PARAGRAPH, PRESERVED VERBATIM** — true when written:

**APPLIED NOWHERE. Not to dev, not to staging, not to production.** The session
ran `migrate diff` and nothing else — CLAUDE.md § Database, `DEBT-103`. Step 3
of the documented flow (`db execute` + `migrate resolve` against dev) is GARY'S
and is owed. Staging and production get it via `prisma migrate deploy` in the
Vercel build on Gary's push.

| Statement | Kind |
|---|---|
| `Organization.paceAlertThresholdPct` `INTEGER` (nullable, no default) | additive, nullable — no backfill, no rewrite |

One column and nothing else. **No drops, no renames, no type changes, no index
changes, no backfill.**

**NULLABLE WITH NO DEFAULT IS THE RULING, NOT A SHORTCUT (F1, Gary
2026-09-20).** The alternative was `INTEGER NOT NULL DEFAULT 90` with
`PACE_ALERT_THRESHOLD_PCT` retired — simpler to reason about afterwards, and
rejected because it makes applying this migration a *behaviour change* in any
environment that sets the variable to something other than 90. As written,
every existing row lands `NULL`, the cron resolves `paceThresholdPct()` for a
null org exactly as it did before, and promoting this migration moves no
behaviour at all. The env var keeps its current meaning: the fallback for every
org that has not set its own value.

**A nullable `ADD COLUMN` with no default does not rewrite the table** — under
Postgres it is a catalogue-only change, so this is safe to apply to a table of
any size under `migrate deploy`, and there is no nullable-then-backfill window
because `NULL` is the intended terminal state for most rows.

**The two validators for this number do not agree, and that is deliberate.**
`paceThresholdPct()` (`src/lib/pace-alerts.ts:20-23`) accepts any finite value
in `(0,100]` including fractions; this column is `INTEGER` and
`PUT /api/pace-alerts/settings` accepts `50`–`100` only. So `87.5` is a legal
FALLBACK and an impossible ORG value. Nothing sets a fractional value anywhere
today — `PACE_ALERT_THRESHOLD_PCT` is unset in every environment — and the
narrower range is the one an admin types into a box, where `5` and `95` are one
keystroke apart and one of them silences every alert for the month. Recorded in
`docs/DECISIONS.md` under NOTIFY-2a so a future reader finds the asymmetry
stated rather than discovering it from a rejected form submission.

**Changing this value never rewrites history.** `PaceAlertLog.thresholdPct` has
recorded the threshold actually used, per send, since F-5
(`20260710220000_f5_pace_alerts_audit_index`), so an org that lowers its
threshold in October does not alter what September's alerts say they were
measured against.

**GENERATED AGAINST THE LIVE DEV DATABASE — the documented §3 form.**

```bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma \
  --script -o prisma/migrations/20260920210000_notify2a_pace_threshold/migration.sql
```

**The pre-check the F-5b entry above demands was run and came back clean.**
Before any schema edit, the same command with no `-o` returned `-- This is an
empty migration.` — so the live dev database was in sync with
`prisma/schema.prisma` at 59/59 and this file is the faithful delta of this
session's one-column edit alone, with no contamination from an unapplied
predecessor. That check is the whole point of F-5b's long section and it fired
correctly here on the first attempt.

**No `ON DELETE` choice was made** (see § Hand-authored FK `ON DELETE` vs the
schema's implied default): the column is a scalar integer, not a relation.

**No protected index is involved**, so § Protected indexes needs no new row and
a future baseline squash has nothing extra to re-append for this migration.

## 2026-09-28 — `20260928213037_doc5_document_category_entity` (DOC-5)

**APPLIED TO PRODUCTION 2026-09-28 in promotion `92df26b`** (staging -> main,
merged 16:05:27 -0700 Pacific), through `prisma migrate deploy` in that merge's
`vercel-build`. Gary reported `br-sparkling-block` at 0 of 6 documents with
`categoryId` NULL after the deploy. Staging (`br-square-feather`) had already
received it through `vercel-build` on Gary's push, at 0 of 11. The "APPLIED TO
DEV ONLY" paragraph below is the build session's, kept in place and now spent.

**APPLIED TO DEV ONLY**, by Gary on 2026-09-28, using `prisma migrate deploy`
against `br-broad-wave`. He reported 0 of 3 documents uncategorized, 5
categories per org across 5 orgs, and no stray values. The session ran
`migrate diff` and nothing else against a database. Staging and production get
it through `prisma migrate deploy` in the Vercel build on Gary's push.

| Statement | Kind |
|---|---|
| `HrDocument.categoryId` `TEXT` (nullable) + index | additive, nullable |
| `CREATE TABLE "HrDocumentCategory"` + org index + `(organizationId, name)` unique | additive |
| FK `HrDocument_categoryId_fkey` → `HrDocumentCategory` `ON DELETE RESTRICT` | additive |
| FK `HrDocumentCategory_organizationId_fkey` → `Organization` `ON DELETE RESTRICT` | additive |
| Seed: 5 starter rows per org with zero categories | data, idempotent |
| Seed: one gray row per unknown legacy `category` string | data, idempotent |
| Backfill: `categoryId` by name for every `HrDocument`, org-scoped | data, NULL rows only |

**No drops, no renames, no type changes, no narrowing.** The legacy
`HrDocument.category` is read to backfill and never written. It stays NOT NULL
and is stale by design (F3). Retiring it is a later, destructive row.

**The generated half was clean.** `migrate diff --from-config-datasource`
against dev produced only the DDL above, with no drift on any other table. The
FK is annotated `onDelete: Restrict` in `schema.prisma`, which is the
TPL-1a/HR-20 lesson. Left unannotated, an optional relation reads as
`SetNull`, and every later diff would try to relax the live constraint.

**The backfill covers every kind and archived rows.** Agreement forms
(`FillableForm`) share the taxonomy (F7). An archived row still holds the FK,
so leaving it NULL would only defer the question.

**The seed must match `STARTER_DOCUMENT_CATEGORIES`** in
`src/lib/document-categories.ts`: same names, colours and `sortOrder`. That
constant seeds orgs created afterwards, from both Clerk webhook sites.
`scripts/verify-doc5-categories.ts` compares the two by parsing this file's
`VALUES` list, and replays this file's data block twice inside a rolled-back
transaction.

**`HrDocumentCategory` ids are generated per branch**, with the prefix `hdc`
plus a uuid. They will not match across dev, staging and production, so never
paste one across branches.

## 2026-09-29 — `20260928222624_doc6_key_return_register` (DOC-6)

**APPLIED TO DEV ONLY.** Gary applied it on 2026-09-29, using `prisma migrate
deploy` against `br-broad-wave` (host `ep-late-water-a6k53nv2`), and reported
"Migration applied to dev". The session then ran `migrate diff
--from-config-datasource --to-schema` against dev, which returned
`-- This is an empty migration.`: dev matches the schema. The session ran
`migrate diff`, `format`, `validate` and `generate`, and no other prisma
command. Staging and production get the migration through `prisma migrate
deploy` in the Vercel build, on Gary's push.

| Statement | Kind |
|---|---|
| `CREATE TYPE "HrReturnEventType"` (`Returned`, `Reissued`) | additive |
| `HrDocument.tracksReturn` `BOOLEAN NOT NULL DEFAULT false` | additive; existing rows read false |
| `HrDocument.returnItemLabel` `TEXT` (nullable) | additive, nullable |
| `CREATE TABLE "HrReturnEvent"` + indexes on `organizationId`, `(hrDocumentId, staffMemberId, createdAt)` and `staffMemberId` | additive |
| FKs `HrReturnEvent_{organizationId,hrDocumentId,staffMemberId}_fkey` `ON DELETE RESTRICT` | additive |

**No drops, no renames, no type changes, no narrowing, no data block.** The
`DEFAULT false` means no existing document opens a register until an admin
ticks the box.

**The generated half was clean.** Before editing the schema, the pre-check
diff against dev returned `-- This is an empty migration.`, so this file holds
only this session's change. After editing, the diff produced exactly the
statements above. All three FKs are annotated `onDelete: Restrict` in
`schema.prisma`, which is the TPL-1a/HR-20 lesson.

**`recordedByUserId` deliberately has no FK.** User rows are hard-deleted
(`api/users/[id]/route.ts:372`), and a return event must outlive the manager
who recorded it. `recordedByName` is the snapshot the UI renders.

**The table is append-only by application contract, not by database
constraint.** `POST /api/hr/returns` is its only writer, and nothing in `src/`
updates or deletes it. `scripts/verify-doc6-key-register.ts` checks both
facts by reading the source. The staff DELETE route counts return events, so a
staff member with one gets the usual 409 rather than a Restrict error.

**No protected index or CHECK is involved,** so § Protected indexes needs no
new row.

**Fixture:** `scripts/verify-doc6-key-register.ts`, 48/48 on dev
`br-broad-wave-a6vpjdw0` against the applied schema. The throwaway org was
removed and the removal confirmed by re-query.

## 2026-10-15 — `20261015171226_ms1_milestones_foundation` (MS-1)

**APPLIED TO DEV ONLY.** Gary applied it on 2026-10-15 with `prisma migrate
deploy` from `froot/`, against host `ep-late-water-a6k53nv2` (branch
`br-broad-wave`), and reported "All migrations have been successfully
applied". **One discrepancy is recorded rather than smoothed over:** the
session's first `migrate diff --from-config-datasource --to-schema` after
Gary's first report still returned the whole migration, so dev did not yet
hold it at that moment. The session stopped and asked. Gary re-confirmed the
host and the apply, and the next diff returned `-- This is an empty
migration.` The most likely reading is that the first check ran before his
apply had landed. It is not proven. Staging and production get the migration
through `prisma migrate deploy` in the Vercel build, on Gary's push.

Prisma commands the session ran: `format`, `validate`, `generate`, and
`migrate diff` (five runs: two at the audit, one to generate this file, and
two level-checks after the apply). It ran no other prisma command.

| Statement | Kind |
|---|---|
| `Organization.milestonesEnabled` `BOOLEAN NOT NULL DEFAULT false` | additive; every org lands off |
| `StaffMember.startDate` `DATE` (nullable) | additive, nullable |
| `StaffMember.startDateManual` `BOOLEAN NOT NULL DEFAULT false` | additive |
| `CREATE TABLE "TenureMilestone"` + index `(organizationId, isArchived)` | additive |
| `CREATE TABLE "WageSnapshot"` + index `(organizationId, squareTeamMemberId, capturedAt)` | additive |
| FKs `TenureMilestone_organizationId_fkey`, `WageSnapshot_organizationId_fkey` `ON DELETE RESTRICT` | additive |

**No drops, no renames, no type changes, no backfill.** `startDate` stays null
until a Square import or resync fills it from the team member's `created_at`,
or someone types it in.

**No partial unique index, by ruling.** "No two active milestones share a
dayCount" is enforced in `src/lib/milestones-db.ts` (Gary, 2026-10-15). A
`WHERE NOT "isArchived"` index cannot be expressed in `schema.prisma`, so every
later `migrate diff` would propose dropping it.

**The pre-check was clean.** Before the schema edit, the audit's diff against
dev returned an empty migration, so this file holds only MS-1's change.

**Fixture:** `scripts/verify-ms1.ts`, 70 passed / 0 failed on dev
(`neon.branch_id` = `br-broad-wave-a6vpjdw0`), run after the apply was
confirmed level.

## 2026-10-15 — `20261015183554_ms1_start_date_square_archived_at` (MS-1, additions)

**APPLIED TO DEV ONLY.** Gary applied it on 2026-10-15 with `prisma migrate
deploy`, against host `ep-late-water-a6k53nv2` (branch `br-broad-wave`), and
reported "applied". The session then ran `migrate diff --from-config-datasource
--to-schema` against dev, which returned `-- This is an empty migration.` Dev
matches the schema. Staging and production get the migration through `prisma
migrate deploy` in the Vercel build, on Gary's push. **There is no prisma check
from this machine against staging.** No staging credentials are on disk, by
CLAUDE.md and as Gary agreed 2026-10-15. Gary checks staging's
`_prisma_migrations` in the Neon console before and after the deploy.

Prisma commands for this migration: `format`, `validate`, `generate`, and
`migrate diff` (twice: once to generate this file, once for the level-check
after the apply).

| Statement | Kind |
|---|---|
| `StaffMember.squareStartDate` `DATE` (nullable) | additive, nullable |
| `TenureMilestone.archivedAt` `TIMESTAMP(3)` (nullable) | additive, nullable |

**No drops, no renames, no type changes, no backfill.** The generated diff held
exactly these two statements, which also confirmed that dev already had
`20261015171226_ms1_milestones_foundation`. An archived milestone with a null
`archivedAt` counts for nobody (`src/lib/milestones.ts`). That only arises for
rows archived on dev before this column existed. Staging and production have
none, because MS-1 was never on them before this.

**Fixture:** `scripts/verify-ms1.ts`, 97 passed / 0 failed on dev
(`neon.branch_id` = `br-broad-wave-a6vpjdw0`), run after the apply was
confirmed level.

## 2026-10-16 — `20261016140411_ms2_milestone_settings` (MS-2)

**APPLIED TO DEV ONLY.** Gary applied it on 2026-10-16 with `prisma migrate
deploy`, against host `ep-late-water-a6k53nv2` (branch `br-broad-wave`), and
reported "All migrations have been successfully applied". The session then ran
`migrate diff --from-config-datasource --to-schema` against dev, which returned
`-- This is an empty migration.` Dev matches the schema. Staging and production
get the migration through `prisma migrate deploy` in the Vercel build, on Gary's
push. There is no prisma check from this machine against staging. Gary checks
staging's `_prisma_migrations` in the Neon console before and after the deploy.

Prisma commands for this migration: `format`, `validate`, `migrate diff` (three
times: the pre-build level check, generating this file, and the level check
after the apply), and `generate` (after the apply, to refresh the local client).

| Statement | Kind |
|---|---|
| `CREATE TABLE "MilestoneSettings"` (5 `INTEGER NOT NULL DEFAULT` columns, timestamps) | additive, new table |
| `UNIQUE INDEX "MilestoneSettings_organizationId_key"` | additive |
| FK `organizationId` → `Organization.id` (`ON DELETE RESTRICT`, TenureMilestone's shape) | additive |

**No drops, no renames, no type changes, no backfill.** Every org reads the code
defaults (`DEFAULT_MILESTONE_SETTINGS`, `src/lib/attendance-settings.ts`) until
an ADMIN first saves the On-time section. `scripts/verify-ms2.ts` asserts those
defaults equal the schema `@default`s.

**Fixture:** `scripts/verify-ms2.ts`, 87 passed / 0 failed on dev
(`neon.branch_id` = `br-broad-wave-a6vpjdw0`), run after the apply was confirmed
level and again inside the commit gate.

## 2026-10-16 — `20261016190415_ms3a_raise_settings` (MS-3a)

**APPLIED TO DEV ONLY.** Gary applied it on 2026-10-16 with `prisma migrate
deploy`, against host `ep-late-water-a6k53nv2` (branch `br-broad-wave`), and
reported "All migrations have been successfully applied". The session then ran
`migrate diff --from-config-datasource --to-schema` against dev, which returned
`-- This is an empty migration.` Dev matches the schema. Staging and production
get the migration through `prisma migrate deploy` in the Vercel build, on Gary's
push. There is no prisma check from this machine against staging. Gary checks
staging's `_prisma_migrations` in the Neon console before and after the deploy.

Prisma commands for this migration: `format`, `validate`, `migrate diff` (three
times: the pre-build level check in the audit, generating this file, and the
level check after the apply), and `generate` (to refresh the local client).

| Statement | Kind |
|---|---|
| `ALTER TABLE "MilestoneSettings" ADD COLUMN` × 5 (`raiseComplianceGate BOOLEAN NOT NULL DEFAULT true`; `raiseMinHoursPerWeek` 20, `raiseConsecutiveWeeks` 3, `raiseMinOnTimePct` 90, `raiseCooldownDays` 90 — `INTEGER NOT NULL DEFAULT`) | additive |
| `CREATE TABLE "MilestoneRaiseTraining"` (PK `milestoneSettingsId, trainingModuleId`, `createdAt`) | additive, new table |
| `CREATE TABLE "MilestoneRaiseDocument"` (PK `milestoneSettingsId, hrDocumentId`, `createdAt`) | additive, new table |
| `INDEX` on `trainingModuleId` and on `hrDocumentId` | additive |
| 4 FKs, all `ON DELETE CASCADE`: each join row → its `MilestoneSettings` row, and → its `TrainingModule` / `HrDocument` | additive |

**No drops, no renames, no type changes, no backfill.** Existing
`MilestoneSettings` rows take Gary's F13 defaults through the column defaults;
an org with no row reads `DEFAULT_RAISE_SETTINGS`
(`src/lib/raise-settings.ts`), which `scripts/verify-ms3.ts` asserts equal the
schema `@default`s. The cascades mean deleting a training module or document
silently removes it from an org's required list — archiving (the normal path)
leaves the row, and the read skips it.

**Fixture:** `scripts/verify-ms3.ts`, 92 passed / 0 failed on dev
(`neon.branch_id` = `br-broad-wave-a6vpjdw0`), run after the apply was confirmed
level and again inside the commit gate (work commit `3a3f210`).

## 2026-10-17 — `20261017002340_ms3b_last_raise` (MS-3b)

**APPLIED TO DEV ONLY.** Gary applied it on 2026-10-16 (Pacific) with `prisma
migrate deploy` against host `ep-late-water-a6k53nv2` and reported
"20261017002340_ms3b_last_raise applied". The folder's timestamp is UTC, which
had already rolled over to 10-17. The session then ran `migrate diff
--from-config-datasource --to-schema` against dev, which returned `-- This is
an empty migration.`, so dev matches the schema. Staging and production get the
migration through `prisma migrate deploy` in the Vercel build, on Gary's push.
Gary checks staging's `_prisma_migrations` in the Neon console before and after
the deploy.

Prisma commands for this migration: `validate`, `migrate diff` (three times:
the audit's level check, generating this file, and the level check after the
apply), and `generate`.

| Statement | Kind |
|---|---|
| `CREATE TABLE "StaffLastRaise"` (`id` PK, `organizationId`, `staffMemberId`, `lastRaiseDate DATE` nullable, `setByUserId`, `setAt TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP`) | additive, new table |
| `UNIQUE INDEX` on `staffMemberId`; `INDEX` on `organizationId` | additive |
| FK → `Organization` (`ON DELETE RESTRICT`), FK → `StaffMember` (`ON DELETE CASCADE`) | additive |

**No drops, no renames, no type changes, no backfill.** The table is empty
until an ADMIN enters a date.

**WHY A TABLE AND NOT `StaffMember` COLUMNS (Gary's G1 ruling, 2026-10-16).**
The MS-3b prompt planned three `StaffMember` columns. The audit
(`docs/prompts/2026-10-16_MS-3b_AUDIT.md`, B6) found thirty whole-row
`StaffMember` reads. One of them is `GET /api/staff`, which returns every
in-scope member to any MANAGER. So a raise date stored as a column would reach
MANAGERs who are not allowed to see pay. On its own table, no existing read can
load it. `scripts/verify-ms3b.ts` C6 and C7 pin it: only
`src/lib/raise-history.ts` names the model, and nothing `include`s the
relation. Clearing the date keeps the row, with `lastRaiseDate` NULL, so the
row still records who cleared it and when. The `StaffMember` cascade means
deleting a member (never the normal path, since termination keeps rows) also
removes their date.

**Fixture:** `scripts/verify-ms3b.ts`, 78 passed / 0 failed on dev
(`neon.branch_id` = `br-broad-wave-a6vpjdw0`). It ran after the apply and again
inside the commit gate (work commit `d2897ed`).

## 2026-10-17 — `20261017204956_ms4a_checklist_milestones` (MS-4a)

**APPLIED TO DEV ONLY.** Gary applied it on 2026-10-17 with `prisma migrate
deploy` against host `ep-late-water-a6k53nv2` and reported, exactly: *"Now
actually applied with migrate deploy. Host ep-late-water-a6k53nv2,
20261017204956_ms4a_checklist_milestones applied ("All migrations have been
successfully applied")."* The session then ran `migrate diff
--from-config-datasource --to-schema` against dev, which returned `-- This is
an empty migration.`, so dev matches the schema. **One earlier report did not
hold:** Gary's first "applied" message was followed by a level check that still
returned the full migration SQL, so the session stopped and built nothing; his
second, naming the host, was followed by an empty diff. The empty diff is the
evidence, not either message. Staging and production get the migration through
`prisma migrate deploy` in the Vercel build, on Gary's push. Gary checks
staging's `_prisma_migrations` in the Neon console before and after the deploy.

Prisma commands for this migration: `format`, `validate`, and `migrate diff`
(four times: the pre-edit level check, generating this file, the check that
found it not yet applied, and the level check after the apply). Gary ran
`migrate deploy` and `generate`.

| Statement | Kind |
|---|---|
| `ALTER TABLE "MilestoneSettings" ADD COLUMN "checklistMilestonesEnabled" BOOLEAN NOT NULL DEFAULT false` | additive |
| `CREATE TABLE "ChecklistMilestone"` (`id` PK, `organizationId`, `taskCount INTEGER`, `title`, `recognition`, `employeeMessage`, `isArchived` default false, `archivedAt` nullable, `createdAt`, `updatedAt`) | additive, new table |
| `INDEX` on `ChecklistMilestone(organizationId, isArchived)` | additive |
| `INDEX` on `TaskLog(completedByStaffId)` | additive, existing table |
| FK `ChecklistMilestone` → `Organization` (`ON DELETE RESTRICT`) | additive |

**No drops, no renames, no type changes, no backfill.** Every existing
`MilestoneSettings` row takes the switch OFF through the column default (F13,
Gary: "OFF by default"); an org with no row reads OFF too. The `TaskLog` index
serves the per-member named-task count on the Milestones tab (F0); it is
Claude's addition, not a ruling. Like `TenureMilestone`, no index enforces
"no two active milestones share a number" — that rule is in the write routes
(`src/lib/milestones-db.ts`), because a partial unique index is not
expressible in `schema.prisma`.

**Fixture:** `scripts/verify-ms4a.ts`, 52 passed / 0 failed on dev
(`neon.branch_id` = `br-broad-wave-a6vpjdw0`). It ran after the apply and again
before the work commit (`70365c6`).

## 2026-10-19 — `20261019005116_notify6_pipeline` (NOTIFY-6)

**APPLIED TO DEV ONLY.** Gary applied it on 2026-10-18 (PDT) with `prisma
migrate deploy` from `froot/` against host `ep-late-water-a6k53nv2` and
reported, exactly: *"I ran npx prisma migrate deploy myself from froot/. Host
ep-late-water-a6k53nv2. 20261019005116_notify6_pipeline applied ("All
migrations have been successfully applied")."* The session then ran `migrate
diff --from-config-datasource --to-schema` against dev, which returned `--
This is an empty migration.`, so dev matches the schema. **One earlier report
did not hold:** a reply-button message saying the migration was applied (its
text was Claude's, not Gary's) was followed by a level check that still
returned the full migration SQL, so the session stopped and built nothing. The
empty diff is the evidence. Staging and production get the migration through
`prisma migrate deploy` in the Vercel build, on Gary's push.

Timestamp note: the folder name is the UTC instant of generation
(`2026-10-19 00:51:16 UTC` = `2026-10-18 17:51:16 PDT`), so it carries the
next calendar day.

Prisma commands for this migration: `format`, `validate`, `generate`, and
`migrate diff` (four times: the audit level check, generating this file, the
check that found it not yet applied, and the level check after Gary's apply).
Gary ran `migrate deploy`.

| Statement | Kind |
|---|---|
| `CREATE TABLE "NotificationIntent"` (`id` PK, `organizationId`, `kind`, `dedupeKey`, `entityId?`, `eventAt`, `payload JSONB`, `state TEXT DEFAULT 'queued'`, `attempts INT DEFAULT 0`, `lastError?`, `nextAttemptAt?`, `sentAt?`, `createdAt`, `updatedAt`) | additive, new table |
| `UNIQUE (organizationId, kind, dedupeKey)`; `INDEX (state, nextAttemptAt)` | additive |
| `CREATE TABLE "NotificationDelivery"` (`id` PK, `intentId`, `recipient`, `userId?`, `messageId?`, `state`, `error?`, `createdAt`, `updatedAt`) | additive, new table |
| `UNIQUE (intentId, recipient)`; `INDEX (messageId)` | additive |
| `CREATE TABLE "NotificationMessage"` (`id` PK, `organizationId`, `kind`, `mode`, `provider`, `providerMessageId?`, `to`, `subject`, `status`, `error?`, `intentId?`, `createdAt`) | additive, new table |
| `UNIQUE (providerMessageId)`; `INDEX (organizationId, createdAt)`; `INDEX (intentId)` | additive |
| `CREATE TABLE "NotificationEvent"` (`id` PK, `messageId`, `type`, `reason?`, `at`, `createdAt`) | additive, new table |
| `UNIQUE (messageId, type)` | additive |
| FKs: Intent→Organization RESTRICT; Message→Organization RESTRICT; Delivery→Intent CASCADE; Delivery→Message SET NULL; Message→Intent SET NULL; Event→Message CASCADE | additive |

**No existing table altered, no enum type, no backfill.** States, kinds and
modes are `TEXT` (audit choice 1). The FK directions leave NOTIFY-8's P5 prune
room: nothing points from an intent to a prunable row, and pruning a message
nulls a delivery's `messageId` rather than failing. `PaceAlertLog` and the
Notification `AuditLog` rows are still written in parallel for one release
(NOTIFY-9 stops them).

**Fixture:** `scripts/verify-notify6.ts`, 72 passed / 0 failed on dev
(`neon.branch_id` = `br-broad-wave-a6vpjdw0`), run after the apply and before
the work commit (`3ffb3f6`).

## 2026-10-19 — `20261019211518_ms4b_milestone_alerts` (MS-4b)

**APPLIED TO DEV ONLY.** Gary applied it on 2026-10-19 with `prisma migrate
deploy` from `froot/` against host `ep-late-water-a6k53nv2` and reported,
exactly: *"I ran npx prisma migrate deploy myself from
/Users/garythomas/Claude_Projects/Froot/froot. Host ep-late-water-a6k53nv2.
Applying migration 20261019211518_ms4b_milestone_alerts — "All migrations have
been successfully applied." Check the diff and continue the build."* The
session then ran `migrate diff --from-config-datasource --to-schema` against
dev, which returned `-- This is an empty migration.`, so dev matches the
schema. **One earlier report did not hold:** Gary's first message saying it was
applied was followed by a level check that still returned both `ADD COLUMN`
statements, with `.env`'s only endpoint confirmed as `ep-late-water-a6k53nv2`.
The session stopped and built nothing until the second apply. The empty diff is
the evidence. Staging and production get the migration through `prisma migrate
deploy` in the Vercel build, on Gary's push.

Timestamp note: the folder name is the UTC instant of generation
(`2026-10-19 21:15:18 UTC` = `2026-10-19 14:15:18 PDT`).

Prisma commands for this migration: `validate`, `generate`, and `migrate diff`
(four times: the audit level check, generating this file, the check that found
it not yet applied, and the level check after Gary's apply). Gary ran `migrate
deploy`.

| Statement | Kind |
|---|---|
| `ALTER TABLE "Organization" ADD COLUMN "milestoneAlertsEnabled" BOOLEAN NOT NULL DEFAULT false` | additive |
| `ALTER TABLE "NotificationMessage" ADD COLUMN "intentIds" TEXT[] DEFAULT ARRAY[]::TEXT[]` | additive |

**Why each.** `milestoneAlertsEnabled` is F10's org switch (Gary, 2026-10-17:
*"org-level milestone email switch, off by default"*), a column because
NOTIFY-8's generic setting table does not exist. `intentIds` is N1(a) (Gary,
2026-10-19: *"add an intentIds list column to NotificationMessage so a dry-run
summary logs each milestone to each person once"*): a daily summary covers
several intents, `intentId` holds one, and dry-run writes no delivery rows
(R1), so this is the only record of what a dry-run summary covered. A
per-intent kind leaves it empty and keeps `intentId`. No FK: intents are kept
forever (P5). The `TEXT[]` column is nullable in SQL, which is how Prisma writes
every scalar list; the client always reads it as a list (`[]` default).

**No table created, nothing dropped or altered in type, no backfill.** Every
existing org reads `false`, so nothing emails on deploy.

**Fixture:** `scripts/verify-ms4b.ts`, 54 passed / 0 failed on dev
(`neon.branch_id` = `br-broad-wave-a6vpjdw0`), run after the apply and before
the work commit (`1bc01cf`).

## 2026-10-21 — `20261022040811_ms6_milestone_eligible` (MS-6)

**STAGING APPLY RECORDED — rider added 2026-10-24 by NOTIFY-SCHED (Gary's
instruction in the NOTIFY-SCHED prompt). The "APPLIED TO DEV ONLY" text below
is kept as written.**

| Branch | Applied | By |
|---|---|---|
| dev | see below | Gary, `npx prisma migrate deploy` |
| staging (`br-square-feather`) | 2026-10-22 04:58:40 UTC (21:58:40 PDT, 2026-10-21) | Vercel build (`prisma migrate deploy`) |
| production | not separately confirmed | — |

**APPLIED TO DEV ONLY, by Gary.** His report, recorded exactly: *"Migration
applied to dev. Go."* The session then ran `migrate diff
--from-config-datasource --to-schema prisma/schema.prisma --script` against
dev, which returned `-- This is an empty migration.`, with `.env`'s only
endpoint `ep-late-water-a6k53nv2` (dev). The empty diff is the evidence.
Staging and production get the migration through `prisma migrate deploy` in the
Vercel build, on Gary's push.

Timestamp note: the folder name is the UTC instant of generation
(`2026-10-22 04:08:11 UTC` = `2026-10-21 21:08:11 PDT`), so it reads a day
later than the session.

Prisma commands for this migration: `format`, `validate`, `generate` (twice),
and `migrate diff` (twice: generating this file, and the level check after
Gary's apply). `npm run build` also ran `prisma generate`. Gary ran `migrate
deploy`.

| Statement | Kind |
|---|---|
| `ALTER TABLE "StaffMember" ADD COLUMN "milestoneEligible" BOOLEAN NOT NULL DEFAULT true` | additive |

**Why.** MS-6 R1 (draft ruling in the session prompt,
`docs/prompts/2026-10-21_MS-6_milestone_eligibility.md`): one Milestones flag
per person. NOT NULL with default `true`, so every existing person stays in
Milestones until an ADMIN switches them off, and no query has to deal with a
NULL third state.

**No table created, nothing dropped or altered in type, no backfill.**

**Fixture:** `scripts/verify-ms6.ts`, 45 passed / 0 failed on dev
(`neon.branch_id` = `br-broad-wave-a6vpjdw0`), run after the apply and before
the work commit (`9d363c1`).

## 2026-10-23 — `20261023200000_notify12_recipients` (NOTIFY-12)

**APPLIED TO ALL THREE BRANCHES — rider added 2026-10-24 by
DOCS-CLEANUP-NOTIFY12; the "APPLIED TO DEV ONLY" text below is kept as written
and is now spent.**

| Branch | Applied | By | Parity query |
|---|---|---|---|
| dev | 2026-10-23 22:35:10 UTC (15:35:10 PDT) | Gary, `npx prisma migrate deploy` from `froot/` | 0 rows |
| staging | 2026-10-24 | Vercel build (`prisma migrate deploy`), staging deploy of Gary's push (tested on build `8648a2a`) | 0 rows |
| production | 2026-10-24 | Vercel build (`prisma migrate deploy`), production deploy of merge `9542b14` | 0 rows |

The parity query is the one recorded below. Staging and production readings are
Gary's, 2026-10-24.

**APPLIED TO DEV ONLY, by Gary.** His report, recorded exactly: *"I applied
the migration to dev at 22:35 UTC with migrate deploy from froot/. The parity
query on dev returned zero rows."* (22:35 UTC = 15:35 PDT.) The parity query
compares every org's `hrAckRecipients` with its hr.ack contact picks, both
ways; zero rows means the backfill matched the column on dev. The NOTIFY-12
build session then ran `migrate diff --from-config-datasource --to-schema
prisma/schema.prisma --script` against dev on 2026-10-24, which returned
`-- This is an empty migration.`, with `.env`'s endpoint
`ep-late-water-a6k53nv2` (dev). The hand-added CHECK constraint did not
register as drift. Staging and production get the migration through `prisma
migrate deploy` in the Vercel build, on Gary's push, and backfill themselves.

Prisma commands in the build session (steps 2–5): `generate` (once by hand;
`npm run build` also runs it) and `migrate diff` (the level check above).
The migration file was generated by the NOTIFY-12 schema session (step 1),
which reported its own commands. Gary ran `migrate deploy`.

| Statement | Kind |
|---|---|
| `ALTER TABLE "NotificationMessage" ADD COLUMN "recipientReasons" TEXT[] DEFAULT ARRAY[]::TEXT[]` | additive |
| `CREATE TABLE "NotificationContact"` + unique (`organizationId`, `email`) | additive |
| `CREATE TABLE "NotificationRecipientPick"` + index (`organizationId`, `kind`) + uniques (org, kind, user) and (org, kind, contact) | additive |
| Foreign keys: contact → org CASCADE; pick → org CASCADE, → user CASCADE, → contact RESTRICT | additive |
| **Hand-appended:** `CHECK (("userId" IS NULL) <> ("contactId" IS NULL))` on the pick | additive |
| **Hand-appended:** F1 backfill — `INSERT` every `hrAckRecipients` address (trimmed, lower-cased, de-duplicated, blanks dropped) as a contact named by its address, then `INSERT` an hr.ack pick for each, both `ON CONFLICT DO NOTHING` | data backfill |

**Why.** NOTIFY-12 (`docs/prompts/NOTIFY-RCPT_AUDIT.md`): one recipient model
for every email type — a role default from the kind's resolver plus
per-org, per-kind "Also send to" picks from an org address book.

**`Organization.hrAckRecipients` is NOT dropped** (additive-only schema): it is
preserved, no longer read by any send path, and refused for writes
(`PUT /api/hr/settings` returns 410). DEBT-121 drops it later.

**Rollback caveat** (audit F1). Reverted code reads the column again, which
still holds the pre-migration list; any picks edited after the migration would
be ignored after a revert.

**Fixture:** `scripts/verify-notify12.ts`, 54 passed / 0 failed on dev
(`neon.branch_id` = `br-broad-wave-a6vpjdw0`), run after the apply and inside
the work commit's gate (`146e94f`). Its section G replays this file's two
backfill `INSERT`s, scoped to one fixture org, and checks the result equals
the column as a set and that a second run adds nothing.

**Parity query** (added 2026-10-24 by the NOTIFY-12 PRE-PUSH-CHECK; it was
described above but not written down). Gary: *"Put your parity query in the
MIGRATIONS entry, not mine."* It compares every org's `hrAckRecipients` —
trimmed, lower-cased, blanks dropped, exactly as the backfill reads the column —
with its hr.ack contact picks, both ways. Read-only. **Zero rows = the backfill
matched the column.** Run it on each branch right after `migrate deploy` lands
there: an admin editing picks, or a fixture run, can legitimately make it drift
later.

```sql
-- NOTIFY-12 parity: every org's hrAckRecipients (trimmed, lower-cased, blanks
-- dropped) against its hr.ack contact picks, both ways. Zero rows = the F1
-- backfill matched the column. Read-only.
(
  SELECT o."id" AS "organizationId", lower(trim(a."addr")) AS "email", 'column only' AS "side"
  FROM "Organization" o
  CROSS JOIN LATERAL unnest(o."hrAckRecipients") AS a("addr")
  WHERE trim(a."addr") <> ''
  EXCEPT
  SELECT p."organizationId", c."email", 'column only'
  FROM "NotificationRecipientPick" p
  JOIN "NotificationContact" c ON c."id" = p."contactId"
  WHERE p."kind" = 'hr.ack'
)
UNION ALL
(
  SELECT p."organizationId", c."email", 'pick only'
  FROM "NotificationRecipientPick" p
  JOIN "NotificationContact" c ON c."id" = p."contactId"
  WHERE p."kind" = 'hr.ack'
  EXCEPT
  SELECT o."id", lower(trim(a."addr")), 'pick only'
  FROM "Organization" o
  CROSS JOIN LATERAL unnest(o."hrAckRecipients") AS a("addr")
  WHERE trim(a."addr") <> ''
);
```

**Provenance of the dev zero.** Gary's 2026-10-23 report ("The parity query on
dev returned zero rows") followed a different query he pasted at the start of
the NOTIFY-12 build session; that query does not drop blank entries, so a blank
address in the column would show there as "column only" although the backfill
skips blanks by design. The check re-ran both, read-only, on dev
(`neon.branch_id` = `br-broad-wave-a6vpjdw0`) on 2026-10-24: **0 rows each**
(two hr.ack picks on the branch at the time).

## 2026-10-24 — `20261024170855_notify_sched_schedules` (NOTIFY-SCHED, row NOTIFY-13)

**APPLIED TO DEV ONLY, by Gary.** His report, recorded exactly: *"I applied
20261024170855_notify_sched_schedules to dev (ep-late-water-a6k53nv2) with
migrate deploy from froot/."* No apply time was given. The build session then
ran `migrate diff --from-config-datasource --to-schema prisma/schema.prisma
--script` against dev, which returned `-- This is an empty migration.`, with
`.env`'s endpoint `ep-late-water-a6k53nv2` (dev). Staging and production get
the migration through `prisma migrate deploy` in the Vercel build, on Gary's
push.

Timestamp note: the folder name is the UTC instant of generation
(`2026-10-24 17:08:55 UTC` = `10:08:55 PDT`).

Prisma commands for this migration: `format`, `validate`, `migrate diff`
(three times: the level check before generating, generating this file, and the
level check after Gary's apply). `npm run build` also ran `prisma generate`.
Gary ran `migrate deploy`.

| Statement | Kind |
|---|---|
| `CREATE TABLE "NotificationSchedule"` + unique (`organizationId`, `kind`) | additive |
| `CREATE TABLE "NotificationScheduleRun"` + unique (`organizationId`, `kind`, `scopeKey`, `slotDate`) | additive |
| Foreign keys: both → `Organization` ON DELETE CASCADE | additive |

**Why.** NOTIFY-SCHED (`docs/prompts/NOTIFY-SCHED_AUDIT.md` § 9): one schedule
row per org and scheduled email type (no row = today's behaviour), and a
"slot evaluated" marker so an hourly runner evaluates each slot once.
`dayOfMonth` is nullable and unused by any kind today (Gary: "Keep
dayOfMonth.").

**No existing table altered, nothing dropped, no backfill.** `PaceAlertLog` is
untouched.

**Fixture:** `scripts/verify-notify-sched.ts`, 43 passed / 0 failed on dev
(`neon.branch_id` = `br-broad-wave-a6vpjdw0`), run after the apply and before
the work commit (`aca15ad`).

## 2026-10-26 — `20261026200000_doc8_document_due_dates` (DOC-8)

**APPLIED TO ALL THREE BRANCHES — rider added 2026-10-27 by PROMOTE-DOCS
DOC-8; the "APPLIED TO DEV ONLY" text below is kept as written and is now
spent.**

| Branch | Applied (`_prisma_migrations.finished_at`) | By |
|---|---|---|
| dev `br-broad-wave-a6vpjdw0` | 2026-10-26 21:11:55 UTC (14:11:55 PDT) | Gary, `npx prisma migrate deploy` from `froot/` |
| staging `br-square-feather-a63z92vz` | 2026-10-26 22:54:33 UTC (15:54:33 PDT) | Vercel build (`prisma migrate deploy`), staging deploy of Gary's push |
| production `br-sparkling-block-a620qvg4` | 2026-10-26 23:36:59 UTC (16:36:59 PDT) | Vercel build (`prisma migrate deploy`), production deploy of merge `0a239f6` |

Staging and production readings are Gary's, from the Neon console, 2026-10-26.

**APPLIED TO DEV ONLY, by Gary.** His report, recorded exactly: *"Applied to
dev — please re-check the columns and continue."* An earlier report (*"I
applied the DOC-8 migration to dev with migrate deploy."*) was premature. A
read on dev straight after it (`neon.branch_id` = `br-broad-wave-a6vpjdw0`)
found none of the three columns, and the newest `_prisma_migrations` row was
`20261024170855_notify_sched_schedules`. The session stopped. After the second
report, the same read on `br-broad-wave-a6vpjdw0` found all three columns and
the row `20261026200000_doc8_document_due_dates`, finished
`2026-10-26 21:11:55 UTC` (`14:11:55 PDT`). Staging and production get the
migration through `prisma migrate deploy` in the Vercel build, on Gary's push.

Timestamp note: the folder name is a hand-chosen `20:00:00 UTC` slot on the
day of generation, not the instant of generation.

Prisma commands for this migration: `format`, `validate`, `migrate diff`
(once, generating this file), and `generate` (once by hand, and again inside
`npm run build`). Gary ran `migrate deploy`. The dev reads above went through
the Prisma client in a tsx script, not the CLI.

| Statement | Kind |
|---|---|
| `ALTER TABLE "HrDocument" ADD COLUMN "signWithinDays" INTEGER` | additive, nullable |
| `ALTER TABLE "HrDocument" ADD COLUMN "signWithinDaysSetAt" TIMESTAMP(3)` | additive, nullable |
| `ALTER TABLE "HrDocumentCategory" ADD COLUMN "defaultSignWithinDays" INTEGER` | additive, nullable |

**Why.** DOC-8 (`docs/prompts/DOC-8_AUDIT.md` § 9; rulings in
`docs/DECISIONS.md` 2026-10-26): "sign within N days" per document, with a
category default copied at create. Null = no due date = the pre-DOC-8
behaviour. `signWithinDaysSetAt` is the launch-day floor for the clock (ruling 3).

**No CHECK constraint.** The 1–365 range is enforced by zod in the routes.
Prisma cannot express a CHECK, and one would join the § Protected indexes
watch list. **No backfill, nothing altered or dropped.**

**Fixture:** `scripts/verify-doc8-due-dates.ts`, 40 passed / 0 failed on dev
(`neon.branch_id` = `br-broad-wave-a6vpjdw0`), run after the apply and before
the work commit (`aa93e2b`).

## 2026-10-27 — `20261027230046_notify14_doc_digest` (NOTIFY-14)

**APPLIED TO ALL THREE BRANCHES — rider added 2026-10-28 by PROMOTE-DOCS
NOTIFY-14; the "APPLIED TO DEV ONLY" text below is kept as written and is now
spent.**

| Branch | Applied (`_prisma_migrations.finished_at`) | By |
|---|---|---|
| dev `br-broad-wave-a6vpjdw0` | 2026-10-27 23:02:52 UTC (16:02:52 PDT) | Gary, `npx prisma migrate deploy` from `froot/` |
| staging `br-square-feather-a63z92vz` | 2026-10-28 00:07:14 UTC (2026-10-27 17:07:14 PDT) | Vercel build (`prisma migrate deploy`), staging deploy of Gary's push |
| production `br-sparkling-block-a620qvg4` | 2026-10-28 03:29:44 UTC (2026-10-27 20:29:44 PDT) | Vercel build (`prisma migrate deploy`), production deploy of merge `cf717ca` |

Staging and production readings are Gary's, from the Neon console. The switch
is left Off for every org on production.

**APPLIED TO DEV ONLY, by Gary.** His report, recorded exactly: *"Applied to
dev. Please check the column yourself and continue."* The session then read
dev itself (`neon.branch_id` = `br-broad-wave-a6vpjdw0`, reported by the server
in the same query): `Organization.docDigestEnabled` is `boolean`, `NOT NULL`,
default `false`, and `_prisma_migrations` holds
`20261027230046_notify14_doc_digest`, finished `2026-10-27 23:02:52 UTC`
(`16:02:52 PDT`). Staging and production get it through `prisma migrate deploy`
in the Vercel build, on Gary's push.

Timestamp note: the folder name is the UTC instant of generation.

Prisma commands for this migration: `validate`, `format`, `migrate diff` (twice:
the first attempt could not reach dev from the sandbox and wrote nothing; the
second wrote this file), and `generate` (once by hand, and again inside
`npm run build`). Gary ran `migrate deploy`. The dev read above went through
`@neondatabase/serverless` in a one-off `node` command, not the Prisma CLI.

| Statement | Kind |
|---|---|
| `ALTER TABLE "Organization" ADD COLUMN "docDigestEnabled" BOOLEAN NOT NULL DEFAULT false` | additive, defaulted |

Every existing org lands on `false`, so the promotion sends nothing (F-5b's
argument). **No backfill, nothing altered or dropped.**

**Fixture:** `scripts/verify-notify14-doc-digest.ts`, 54/54 on dev
(`neon.branch_id` = `br-broad-wave-a6vpjdw0`), run after the apply and before
the work commit (`de21089`).

## 2026-10-28 — `20261028202919_doc7_annual_resign` (DOC-7)

**APPLIED TO DEV ONLY, by Gary.** His report, recorded exactly: *"The migration
is applied to dev, and it should check the columns itself."* The session then
read dev itself (`neon.branch_id` = `br-broad-wave-a6vpjdw0`, reported by the
server in the same query): `HrDocument.reSignEveryMonths` `integer` nullable,
`HrDocument.reSignEveryMonthsSetAt` `timestamp without time zone` nullable,
`HrDocumentAcknowledgment.renewal` and `HrSignedRecord.renewal` `integer`
`NOT NULL` default `0`; both unique indexes now end in `renewal`; and
`_prisma_migrations` holds `20261028202919_doc7_annual_resign`, finished
`2026-10-28 20:55:39 UTC` (`13:55:39 PDT`). Staging and production get it
through `prisma migrate deploy` in the Vercel build, on Gary's push.

| Branch | Applied (`_prisma_migrations.finished_at`) | By |
|---|---|---|
| dev `br-broad-wave-a6vpjdw0` | 2026-10-28 20:55:39 UTC (13:55:39 PDT) | Gary |
| staging `br-square-feather-a63z92vz` | 2026-10-28 23:38:28 UTC (16:38:28 PDT) | Vercel build, on Gary's push |
| production `br-sparkling-block-a620qvg4` | 2026-10-29 21:54:28 UTC (14:54:28 PDT) | Vercel build, at promotion (merge `849550d`) |

**Applied to staging and production** — rider 2026-10-29, PROMOTE-DOCS DOC-7.
Both `finished_at` values read by Gary from `_prisma_migrations` in the Neon
console on the named branch. Before this rider the staging and production
cells read "not yet"; the "APPLIED TO DEV ONLY" line above is spent, kept.

Timestamp note: the folder name is the UTC instant of generation.

Prisma commands for this migration: `format`, `validate`, `migrate diff` (once,
writing this file), and `generate` (once by hand before the dev read, and again
inside `npm run build`). Gary applied it. The dev read went through the app's
Prisma client in a one-off `npx tsx` script, deleted afterwards.

| Statement | Kind |
|---|---|
| `DROP INDEX "HrDocumentAcknowledgment_checkpointId_hrDocumentVersionId_s_key"` | index replaced (recreated below, one column wider) |
| `DROP INDEX "HrSignedRecord_hrDocumentVersionId_staffMemberId_signingCyc_key"` | index replaced (recreated below, one column wider) |
| `ALTER TABLE "HrDocument" ADD COLUMN "reSignEveryMonths" INTEGER, ADD COLUMN "reSignEveryMonthsSetAt" TIMESTAMP(3)` | additive, nullable |
| `ALTER TABLE "HrDocumentAcknowledgment" ADD COLUMN "renewal" INTEGER NOT NULL DEFAULT 0` | additive, defaulted |
| `ALTER TABLE "HrSignedRecord" ADD COLUMN "renewal" INTEGER NOT NULL DEFAULT 0` | additive, defaulted |
| `CREATE UNIQUE INDEX "HrDocumentAcknowledgment_…_s_key" (checkpointId, hrDocumentVersionId, staffMemberId, signingCycle, renewal)` | index recreated |
| `CREATE UNIQUE INDEX "HrSignedRecord_…_signingCyc_key" (hrDocumentVersionId, staffMemberId, signingCycle, renewal)` | index recreated |

**THE TWO INDEX SWAPS ARE HR-15b's SHAPE EXACTLY** (`20260723180000_hr15b_signing_cycles`
dropped and recreated the same two indexes to add `signingCycle`). Gary's F1
ruling (DECISIONS.md 2026-10-28, DOC-7) chose `NOT NULL DEFAULT 0` over the
prompt's "nullable only": a nullable column in a unique key lets duplicate
first signings past `skipDuplicates`, because NULLs are distinct. Every
existing row lands on `renewal = 0`, so the widened keys enforce exactly what
the old ones did on existing data. **No column dropped, no row altered, no
backfill.** Every existing document lands on "never expires". Both index names
are Prisma's own, so the schema still describes them and no protected-index
entry is needed.

**Fixture:** `scripts/verify-doc7-annual-resign.ts`, 78/78 on dev
(`neon.branch_id` = `br-broad-wave-a6vpjdw0`), run after the apply and before
the work commit (`60fee26`).

## 2026-10-30 — `20261030200242_l4a_labor_assignment` (L-4a)

**APPLIED TO DEV ONLY, by Gary.** His report, recorded exactly: *"Applied to
dev br-broad-wave. migrate status and migrate deploy output below."* No output
reached the session after that sentence, so none is quoted here. The session
then read dev itself (`neon.branch_id` =
`br-broad-wave-a6vpjdw0`, reported by the server in the same query): table
`LaborAssignment` with all ten columns `NOT NULL` (`date` is `date`,
`startMinutes`/`endMinutes` are `integer`), `LaborAssignment_minutes_check`
present, the three foreign keys with the ruled `ON DELETE` (organization
RESTRICT, store CASCADE, staff member RESTRICT), both indexes, 0 rows; and
`_prisma_migrations` holds `20261030200242_l4a_labor_assignment`, finished
`2026-10-30 20:07:38 UTC` (`13:07:38 PDT`), 77 applied in all. Staging and
production get it through `prisma migrate deploy` in the Vercel build, on
Gary's push.

| Branch | Applied (`_prisma_migrations.finished_at`) | By |
|---|---|---|
| dev `br-broad-wave-a6vpjdw0` | 2026-10-30 20:07:38 UTC (13:07:38 PDT) | Gary |
| staging `br-square-feather-a63z92vz` | 2026-10-30 20:23:50 UTC (13:23:50 PDT) | Vercel build, on Gary's push (build of `45fcf5f`) |
| production `br-sparkling-block-a620qvg4` | 2026-10-31 05:52:37 UTC (22:52:37 PDT) | Vercel build, at promotion (merge `a4a33b9`) |

**Applied to all three branches** — rider 2026-10-31, L-4 PROMOTION STAMP.
Production's time is the Vercel build log's "Applying migration
`20261030200242_l4a_labor_assignment`" line for the build of `a4a33b9`, whose
datasource was `ep-green-smoke-a6xthq4r` — production `br-sparkling-block`, per
Gary in the Neon console → Computes, 2026-10-30 22:57 PDT. It was read from the
log, not from `_prisma_migrations`. Staging is recorded as applied on the stamp
prompt's statement; no staging `finished_at` reached this session, so none is
written. Before this rider both cells read "not yet"; the "APPLIED TO DEV ONLY"
line above is spent, kept.

**Staging time filled** — rider 2026-10-31, BUG-17 PROMOTION STAMP. Source: the
Vercel staging build log for `45fcf5f`, line "Applying migration
`20261030200242_l4a_labor_assignment`" at 13:23:50.546 PDT (2026-10-30
20:23:50 UTC), as given in the stamp prompt. Like production's, it was read from
the build log, not from `_prisma_migrations`. The staging cell previously read
"applied — `finished_at` not read at this stamp"; the "no staging `finished_at`
reached this session" sentence above is spent, kept.

Timestamp note: the folder name is the UTC instant of generation.

Prisma commands for this migration: `format`, `validate`, `migrate diff` (once,
writing this file), and `generate` (once by hand after the apply, and again
inside `npm run build`). Gary applied it. The pre-diff branch check and the dev
read went through one-off Node scripts using `@neondatabase/serverless`,
read-only, kept in the session scratchpad and not in the repo.

| Statement | Kind |
|---|---|
| `CREATE TABLE "LaborAssignment"` (10 columns, `LaborAssignment_pkey`) | additive, new table |
| `CREATE INDEX "LaborAssignment_organizationId_storeId_date_idx"` | additive, new table |
| `CREATE INDEX "LaborAssignment_staffMemberId_date_idx"` | additive, new table (ruling 5) |
| `ADD CONSTRAINT "LaborAssignment_organizationId_fkey"` `ON DELETE RESTRICT` | on the new table |
| `ADD CONSTRAINT "LaborAssignment_storeId_fkey"` `ON DELETE CASCADE` | on the new table (ruling 3) |
| `ADD CONSTRAINT "LaborAssignment_staffMemberId_fkey"` `ON DELETE RESTRICT` | on the new table (ruling 3) |
| `ADD CONSTRAINT "LaborAssignment_minutes_check"` CHECK | **hand-written — see § Protected indexes** (ruling 2) |

**ADDITIVE ONLY: nothing touches an existing table.** The generated diff
contained no constraint churn on any other table, so the schema and dev
agreed before the edit. Every `ON DELETE` is either Prisma's own default for
the relation (organization) or stated in the schema (`onDelete: Cascade` on
store, `onDelete: Restrict` on staff member), so § Hand-authored FK `ON DELETE`
has nothing to mirror. The CHECK is the only object the schema cannot describe,
and it is now in § Protected indexes. Rulings: `docs/DECISIONS.md` "2026-10-30 —
L-4a: labor assignment data model (Gary)".

**Fixture:** `scripts/verify-l4a-labor-assignment.ts`, 24/24 on dev
(`neon.branch_id` = `br-broad-wave-a6vpjdw0`), run after the apply and before
the work commit (`9fc21d6`). It refuses any other branch and leaves no rows.

## 2026-11-01 — `20261101210000_n1_ingredient_nutrition` (N-1)

**On production at promotion (merge `bdbeb47`), stamped by
STAMP-bdbeb47-317ce2c; the "DEV ONLY" line below is spent, kept.**

**APPLIED TO DEV ONLY, by Gary.** Written by the N-1 PRE-PUSH-CHECK, not by
the N-1 docs commit (`2c2c0fa`), which carried no entry here — found as drift
at the check's Step 2 and added on Gary's instruction: *"Add the MIGRATIONS.md
entry in this check's single docs commit, as proposed."* The work commit
(`70baf2f`) records the dev apply as "applied to dev by Gary"; no apply output
and no `_prisma_migrations.finished_at` reached the check, and the check reads
no database, so no dev time is written. Staging and production get it through
`prisma migrate deploy` in the Vercel build, on Gary's push and at promotion.

| Branch | Applied (`_prisma_migrations.finished_at`) | By |
|---|---|---|
| dev `br-broad-wave-a6vpjdw0` | applied by Gary 2026-11-01 — finished_at not read at this check | Gary |
| staging `br-square-feather-a63z92vz` | applied — finished_at not read; staging evidence in the DEPLOY_LOG entry (STAMP-bdbeb47-317ce2c) | Vercel build, on Gary's push |
| production `br-sparkling-block-a620qvg4` | 2026-11-01 23:49:42 UTC (15:49:42 PST) | Vercel build, at promotion (merge `bdbeb47`) |

Timestamp note: the folder name is the UTC instant of generation.

| Statement | Kind |
|---|---|
| `CREATE TYPE "Allergen" AS ENUM (…)` (FDA major nine) | additive, new enum |
| `ALTER TABLE "Ingredient" ADD COLUMN "allergens" "Allergen"[] DEFAULT ARRAY[]` | additive, nullable with default |
| `ALTER TABLE "Ingredient" ADD COLUMN "nutritionExempt" BOOLEAN NOT NULL DEFAULT false` | additive, default fills existing rows |
| `CREATE TABLE "IngredientNutrition"` (23 columns, `IngredientNutrition_pkey`) | additive, new table |
| `CREATE UNIQUE INDEX "IngredientNutrition_ingredientId_key"` | additive, new table (1:1, ruling F4) |
| `ADD CONSTRAINT "IngredientNutrition_ingredientId_fkey"` `ON DELETE CASCADE` | on the new table |

**ADDITIVE ONLY: no DROP, no ALTER COLUMN, no RENAME** (checked against the
file at this check). The two `Ingredient` columns are the only change to an
existing table, and both carry defaults. The `ON DELETE CASCADE` is stated in
the schema (`onDelete: Cascade` on `IngredientNutrition.ingredient`), so
§ Hand-authored FK `ON DELETE` has nothing to mirror, and nothing here belongs
in § Protected indexes. Calories are `DOUBLE PRECISION` (`Float?`) — F4's
"stored as a decimal" means non-integer, per `docs/prompts/N-1_AUDIT.md`
(`Float?`, not the stub's `Int?`). Rulings: `docs/DECISIONS.md` "2026-11-01 —
N-1: ingredient nutrition & allergens, forks N1-F1–F6 and R-1–R-4 (Gary)".

**Fixture:** `scripts/verify-n1-nutrition.ts`, pure (no database), 39 checks,
all pass, per the work commit. Not re-run by this check.

Prisma commands for this migration: not recorded. The work commit message,
the row and `docs/prompts/N-1_AUDIT.md` list none (the file itself implies a
`migrate diff`); this check ran none.

## 2026-11-01 — `20261101230000_n1b_nutrition_proof` (N-1b)

**On production at promotion (merge `317ce2c`), stamped by
STAMP-bdbeb47-317ce2c; the "DEV ONLY" line below is spent, kept.**

**APPLIED TO DEV ONLY, by Gary**, after the N-1b Phase 2 STOP and before the
work commit `0962d72` (§ A migration STOPS the session). The session read no
`_prisma_migrations.finished_at`, so no dev time is written; the evidence that
dev has it is a read-only `migrate diff` against dev returning `-- This is an
empty migration.` at the start of Phase 3, and the N-1b fixture's database part
writing the new columns on `neon.branch_id = br-broad-wave-a6vpjdw0`.

| Branch | Applied (`_prisma_migrations.finished_at`) | By |
|---|---|---|
| dev `br-broad-wave-a6vpjdw0` | applied by Gary 2026-11-01 — finished_at not read | Gary |
| staging `br-square-feather-a63z92vz` | applied — finished_at not read; staging evidence in the DEPLOY_LOG entry (STAMP-bdbeb47-317ce2c) | Vercel build, on Gary's push |
| production `br-sparkling-block-a620qvg4` | 2026-11-02 02:49:41 UTC (2026-11-01 18:49:41 PST) | Vercel build, at promotion (merge `317ce2c`) |

**GENERATED AGAINST THE LIVE DEV DATABASE, after a clean baseline.** Before
`prisma/schema.prisma` was edited, the diff with no `-o` returned `-- This is
an empty migration.` against `ep-late-water-a6k53nv2` (dev) — so the file holds
only N-1b (the F-5b lesson above). Timestamp note: the folder name was chosen
for the session, not the UTC instant of generation.

| Statement | Kind |
|---|---|
| `CREATE TYPE "NutritionStatus" AS ENUM ('ESTIMATED', 'VERIFIED')` | additive, new enum |
| `ALTER TABLE "IngredientNutrition" ADD COLUMN "status" "NutritionStatus" NOT NULL DEFAULT 'ESTIMATED'` | additive; the default IS the backfill — every existing row becomes ESTIMATED as the column is added |
| `ADD COLUMN` × 11 nullable: `verifiedByUserId`, `verifiedAt`, `sourceUrl`, `labelFileUrl`, `labelFilePathname`, `labelFileName`, `labelContentType`, `labelSizeBytes` (INTEGER), `labelFileHash`, `labelUploadedByUserId`, `labelUploadedAt` | additive, nullable |

**ADDITIVE ONLY: no DROP, no ALTER COLUMN, no RENAME, no index, no foreign
key.** `verifiedByUserId` and `labelUploadedByUserId` are plain ids like the
existing `updatedByUserId`, not relations, so § Hand-authored FK `ON DELETE`
has nothing to mirror and § Protected indexes has nothing to add. Rulings:
`docs/DECISIONS.md` "2026-11-01 — N-1b: nutrition proof, Estimated/Verified,
forks N1B-F1–F8 and storage (Gary)" (heading read "— DRAFT" until the
N-1b PRE-PUSH-CHECK ratified it; pointer repaired there).

**Fixture:** `scripts/verify-n1b-proof.ts`, 47 checks, all pass, run against
the applied schema (its part 7 writes and reads the new columns on dev inside a
transaction that is always rolled back, and asserts nothing was left behind).

**Prisma commands for this migration, verbatim:**
`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
(baseline, empty; then the preview of this file) ·
`npx prisma format` · `npx prisma validate` ·
`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script -o prisma/migrations/20261101230000_n1b_nutrition_proof/migration.sql` ·
after Gary's apply: the same diff with no `-o` (empty) and `npx prisma generate`.
`npm run build` also runs `prisma generate`. No `migrate deploy`, `db execute`,
`migrate dev`, `migrate reset` or `migrate resolve` was run by the session.

## 2026-11-02 — `20261102220000_n1d_proof_only_nutrition` (N-1d)

**APPLIED TO DEV ONLY, by Gary**, after the N-1d Phase 2 STOP and before the
work commit `8e3d887` (§ A migration STOPS the session). Staging and production
get it from the Vercel build on Gary's push and at promotion.

**The first "applied" did not reach dev, and the check that caught it is worth
keeping.** Gary's first "Applied to dev" message arrived, and the N-1d fixture's
database part then failed with a null-constraint violation. A read-only
`migrate diff` against dev still generated both `DROP NOT NULL`s, and a
read-only SELECT on `neon.branch_id = br-broad-wave-a6vpjdw0` showed
`_prisma_migrations` with N-1 and N-1b but no N-1d row, both basis columns
`is_nullable = NO`, and no `IngredientNutrition_basis_together`. The session
committed nothing and stopped. After Gary's second "Applied to dev", the same
diff returned `-- This is an empty migration.` and the fixture passed 42/42 on
the same branch. Where the first deploy actually went was not established by
this session. The file was not edited between Phase 2 and the apply, so any
branch that holds it holds exactly this content. **Do not trust an "applied"
on its word: diff dev before the fixture, every time.**

| Branch | Applied (`_prisma_migrations.finished_at`) | By |
|---|---|---|
| dev `br-broad-wave-a6vpjdw0` | applied by Gary 2026-11-02 — finished_at not read | Gary |
| staging `br-square-feather-a63z92vz` | applied on Gary's push (staging tests passed before promotion, per the N-2 prompt) — finished_at not read | Vercel build |
| production `br-sparkling-block-a620qvg4` | **2026-11-02 21:19:42 UTC** (13:19:42 PST), promotion `22b8a7f` (Gary, as relayed in the N-2 prompt; stamped by N-2) | Vercel build |

**Backfill counts (N1D-F2b: "no audit row for the backfill; record the counts
in MIGRATIONS and DEPLOY_LOG").** The migration does not report a row count,
and the session queried no deployed branch. **Dev: unknown** — it was applied
before anyone counted. **Staging and production: to be counted by Gary in the
Neon console BEFORE the push**, with the query in
`docs/prompts/N-1d_AUDIT.md` § B.3, and written here and in the DEPLOY_LOG
entry at the PRE-PUSH-CHECK. Expected on production: 0 (Almond Milk and Coconut
Milk both carry documents, per the prompt).

| Branch | VERIFIED without a document (`to_reset`) | VERIFIED total |
|---|---|---|
| dev | unknown (applied before counting) | — |
| staging `br-square-feather-a63z92vz` | **0** | **1** |
| production `br-sparkling-block-a620qvg4` | **0** (was 1 before Gary uploaded Almond Milk's label document) | **2** |

**Counted by Gary in the Neon console, 2026-11-02, before the migration
reached either branch** (filled in at the N-1d PRE-PUSH-CHECK). The branch id on
each row was read from the server (`neon.branch_id`) in the same output as the
counts, not typed. Neither branch had the migration applied when counted, so on
both the backfill is expected to touch **0 rows**.

**The "Expected on production: 0" above was right in the end and wrong when it
was written.** The prompt said Almond Milk and Coconut Milk both carried
documents; the first production count returned `to_reset` **1**. Gary uploaded
Almond Milk's label document, and the recount returned 0 with `verified_total`
2. Had the push gone first, the backfill would have reset Almond Milk to
Estimated — correct by F2, but not what anyone expected. The sentence is kept as
written; this paragraph is the correction.

**GENERATED AGAINST THE LIVE DEV DATABASE, after a clean baseline.** Before
`prisma/schema.prisma` was edited, the diff with no `-o` returned `-- This is
an empty migration.` against `ep-late-water-a6k53nv2` (dev). The generated part
is two statements. Parts 2 and 3 are hand-authored and appended below it.

| Statement | Kind |
|---|---|
| `ALTER TABLE "IngredientNutrition" ALTER COLUMN "basisAmount" DROP NOT NULL, ALTER COLUMN "basisUnit" DROP NOT NULL` | generated; relaxes NOT NULL — nothing dropped |
| `ADD CONSTRAINT "IngredientNutrition_basis_together" CHECK (("basisAmount" IS NULL) = ("basisUnit" IS NULL))` | **hand-authored** (N1D-F1c); holds on every existing row, since all had both |
| `UPDATE "IngredientNutrition" SET "status" = 'ESTIMATED', "verifiedAt" = NULL, "verifiedByUserId" = NULL WHERE "status" = 'VERIFIED' AND "labelFileUrl" IS NULL` | **hand-authored** data backfill (N1D-F2); no AuditLog row (F2b) |

**The CHECK is invisible to Prisma, so it is added to § Protected indexes** —
Hazard 1 applies: a baseline squash would silently drop it. A proof-only row
also keeps all 15 nutrients null; that stronger rule is enforced in code
(`PROOF_ONLY_NUMBERS`, `src/lib/nutrition.ts`), not by the CHECK.

**Fixture:** `scripts/verify-n1d.ts`, 42 checks, all pass, against the applied
schema on dev. Its part 7 stores a proof-only row, asserts the CHECK refuses
half a basis (`23514`), and runs the backfill statement copied verbatim from
this file. Check 6c asserts the copy matches. The run is scoped to the
fixture's own rows, inside a transaction that is always rolled back.

**Prisma commands for this migration, verbatim:**
`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
(baseline, empty) · `npx prisma validate` ·
`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script -o prisma/migrations/20261102220000_n1d_proof_only_nutrition/migration.sql` ·
`npx prisma generate` · the same diff with no `-o` twice more (non-empty after
the first "applied"; empty after the second). `npm run build` also runs
`prisma generate`. No `migrate deploy`, `db execute`, `migrate dev`, `migrate
reset` or `migrate resolve` was run by the session.

## 2026-11-02 — `20261102230000_n2_nutrition_serving_settings` (N-2)

**APPLIED TO DEV ONLY, by Gary**, after the N-2 Phase 2 STOP and before the
work commit `d88ef4d` (§ A migration STOPS the session). Staging and production
get it from the Vercel build on Gary's push and at promotion.

**Dev was checked before the fixture, not taken on its word** (the N-1d
lesson above): after Gary's "Applied to dev", the shape diff against dev
returned `-- This is an empty migration.`, and a read-only SELECT on
`neon.branch_id = br-broad-wave-a6vpjdw0` returned the
`_prisma_migrations` row below.

| Branch | Applied (`_prisma_migrations.finished_at`) | By |
|---|---|---|
| dev `br-broad-wave-a6vpjdw0` | **2026-11-02 21:55:42 UTC** (13:55:42 PST) | Gary |
| staging `br-square-feather-a63z92vz` | applied on Gary's push (staging label checks passed before promotion, per the N-3 prompt) — finished_at not read | Vercel build |
| production `br-sparkling-block-a620qvg4` | **2026-11-02 22:44:23.510952 UTC** (14:44:23 PST) — 50 s after the promotion `8c94126` merge (22:43:33 UTC). Read by Gary in the Neon console, branch id from the server, at the N-3 PRE-PUSH-CHECK. (Was: "rides promotion `8c94126` … NOT yet observed — **finished_at OWED**: Gary reads it in the Neon console at the next PRE-PUSH-CHECK (stamped by N-3)" — spent.) | Vercel build |

**GENERATED AGAINST THE LIVE DEV DATABASE, after a clean baseline.** Before
`prisma/schema.prisma` was edited, the diff with no `-o` returned `-- This is
an empty migration.` against dev. Every statement is generated; nothing is
hand-authored, so nothing joins § Protected indexes. **Additive only — no
backfill, nothing dropped:**

| Statement | Kind |
|---|---|
| `ALTER TABLE "Organization" ADD COLUMN "nutritionServingFlOz" DOUBLE PRECISION` | nullable; NULL = the 12 fl oz default (R-1), so no backfill |
| `CREATE TABLE "NutritionSizeVolume"` + unique `(organizationId, variationName)` + FK to Organization (RESTRICT) | the size table (F3), one row per EXACT Square variation name (F6) |
| `CREATE TABLE "NutritionItemServing"` + unique `salesItemId` + index `organizationId` + FKs to Organization (RESTRICT) and SalesItem (**CASCADE**) | the per-item override; removed with its sales item |

**Fixture:** `scripts/verify-n2-label.ts`, 52 checks, all pass, against the
applied schema on dev `br-broad-wave-a6vpjdw0`. Its part 10 creates a fixture
org with a serving size, two sales items, two size-table rows and a "per item"
override; asserts the duplicate-name refusal (`P2002`), reads them back
through `loadServingSettings`, resolves both items, and asserts the override
cascades with its sales item — inside a transaction that is always rolled
back (10f checks nothing leaked). Part 9 asserts the migration file drops
nothing.

**Prisma commands for this migration, verbatim:**
`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
(baseline, empty) · `npx prisma validate` · `npx prisma format` ·
`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script -o prisma/migrations/20261102230000_n2_nutrition_serving_settings/migration.sql` ·
`npx prisma generate` · the same diff with no `-o` once more after Gary's
apply (empty). `npm run build` also runs `prisma generate`. No `migrate
deploy`, `db execute`, `migrate dev`, `migrate reset` or `migrate resolve` was
run by the session.

## 2026-11-02 — `20261103000000_n3_public_menu` (N-3)

**APPLIED TO DEV ONLY, by Gary**, after the N-3 Phase 2 STOP and before the
work commit `68571da` (§ A migration STOPS the session). Staging and production
get it from the Vercel build on Gary's push and at promotion. The timestamp is
`20261103000000` although the work was done 2026-11-02 — chosen only to sort
after N-2's `20261102230000`; it is a name, not a clock reading.

**Dev was checked before the fixture, not taken on its word:** after Gary's
"Applied to dev", a read-only SELECT returned the `_prisma_migrations` row below
with `neon.branch_id = br-broad-wave-a6vpjdw0` from the same query, and the
shape diff against dev returned `-- This is an empty migration.`.

| Branch | Applied (`_prisma_migrations.finished_at`) | By |
|---|---|---|
| dev `br-broad-wave-a6vpjdw0` | **2026-11-02 23:06:55 UTC** (15:06:55 PST) | Gary |
| staging `br-square-feather-a63z92vz` | applied on Gary's push (`/menu/keva-juice-staging` checks passed before promotion, per the STAMP-a00fa1e prompt) — finished_at not read. (Was: "not yet — on Gary's push" — spent.) | Vercel build |
| production `br-sparkling-block-a620qvg4` | **2026-11-03 00:09:51.972546 UTC** (2026-11-02 16:09:51 PST) — 43 s after the promotion `a00fa1e` merge (00:09:09 UTC). Read by Gary in the Neon console, branch id from the server in the same output, recorded by STAMP-a00fa1e. (Was: "not yet — at promotion" — spent.) | Vercel build |

**GENERATED AGAINST THE LIVE DEV DATABASE, after a clean baseline** (the diff
with no `-o` returned `-- This is an empty migration.` before
`prisma/schema.prisma` was edited; datasource host `ep-late-water-a6k53nv2`,
the dev endpoint). Every statement is generated; nothing is hand-authored, so
nothing joins § Protected indexes. **Additive only — no backfill, nothing
dropped, no existing table altered:**

| Statement | Kind |
|---|---|
| `CREATE TABLE "PublicMenu"` + unique `organizationId` + unique `slug` + FK to Organization (RESTRICT) | one public menu per org; `enabled` DEFAULT false (N3-F3); slug unique ACROSS orgs, stored lowercase by the route |
| `CREATE TABLE "PublicMenuCategory"` (PK `publicMenuId, squareCategoryId`) + FKs to PublicMenu (**CASCADE**) and SquareCategory (**CASCADE**) | included menu groups, keyed on the SquareCategory ROW, not the name |
| `CREATE TABLE "PublicMenuHiddenItem"` (PK `publicMenuId, squareItemId`) + FK to PublicMenu (**CASCADE**) | hidden items by Square item id; no FK (there is no Square item table) |

No row in `PublicMenu` = the menu is off, so nothing is public on any branch
until an ADMIN saves the publish page with the menu on.

**Fixture:** `scripts/verify-n3-public.ts`, 47 checks, all pass, against the
applied schema on dev `br-broad-wave-a6vpjdw0`. Its part 9 creates two fixture
orgs ("N-3 Fixture Org"), a SquareCategory and a PublicMenu; asserts the menu
is off by default, the slug is unique across orgs (`P2002`), one menu per org
(`P2002`), an included group is listed once (`P2002`) and must be a real
SquareCategory row (`P2003`), and that groups and hidden items cascade with the
menu — inside a transaction that is always rolled back (9i checks nothing
leaked). 9a asserts the migration file only creates.

**Prisma commands for this migration, verbatim:**
`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
(baseline, empty) · `npx prisma format` · `npx prisma validate` ·
`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script -o prisma/migrations/20261103000000_n3_public_menu/migration.sql` ·
`npx prisma generate` · the same diff with no `-o` once more after Gary's
apply (empty). `npm run build` also runs `prisma generate`. No `migrate
deploy`, `db execute`, `migrate dev`, `migrate reset` or `migrate resolve` was
run by the session.

## 2026-11-02 — `20261103010000_n1e_label_inbox` (N-1e)

**APPLIED TO DEV ONLY, by Gary**, after the N-1e Phase 2 STOP and before the
work commit `218e984` (§ A migration STOPS the session). Staging and production
get it from the Vercel build on Gary's push and at promotion. The timestamp is
`20261103010000` although the work was done 2026-11-02 — chosen only to sort
after N-3's `20261103000000`; it is a name, not a clock reading.

**THE FIRST "APPLIED TO DEV" DID NOT LAND ON DEV — caught by the check, not by
the fixture.** After Gary's first "Applied to dev", the shape diff against the
dev datasource (`ep-late-water-a6k53nv2`, both `.env` URLs; `env | grep -c
DATABASE_URL` printed `0`) still returned the full `CREATE TYPE` / `CREATE
TABLE` / index / FK script, so the session stopped before any Phase 3 code.
Where that first apply went was not determined by the session. Gary re-applied
("Datasource ep-late-water-a6k53nv2"); the same diff then returned `-- This is
an empty migration.`. **This is why the diff is re-run after every "applied":
the word is not the check.**

| Branch | Applied (`_prisma_migrations.finished_at`) | By |
|---|---|---|
| dev `br-broad-wave-a6vpjdw0` | applied (second attempt), 2026-11-02 — `finished_at` NOT read by the session; the evidence is the empty shape diff and the fixture's part 9 printing `neon.branch_id = br-broad-wave-a6vpjdw0` against the new table | Gary |
| staging `br-square-feather-a63z92vz` | applied on Gary's push (`/nutrition/labels` inbox staging pass completed before promotion, per the STAMP-4dbfa03 prompt) — finished_at not read. (Was: "not yet — on Gary's push" — spent.) | Vercel build |
| production `br-sparkling-block-a620qvg4` | **2026-11-03 17:08:19.627415 UTC** (09:08:19 PST) — 32 s after the promotion `4dbfa03` merge (17:07:47 UTC). Read by Gary in the Neon console, branch id from the server in the same output, recorded by STAMP-4dbfa03. (Was: "not yet — at promotion" — spent.) | Vercel build |

**Pre-push measurement, recorded at the N-1e PRE-PUSH-CHECK (2026-11-03):**
`n1e_applied = 0` on staging `br-square-feather-a63z92vz` and on production
`br-sparkling-block-a620qvg4` — measured by Gary in the Neon console before the
check, branch id read from the server. Neither branch had the migration before
the push.

**GENERATED AGAINST THE LIVE DEV DATABASE, after a clean baseline** (the diff
with no `-o` returned `-- This is an empty migration.` before
`prisma/schema.prisma` was edited; datasource host `ep-late-water-a6k53nv2`,
the dev endpoint). Every statement is generated; nothing is hand-authored, so
nothing joins § Protected indexes. **Additive only — no backfill, nothing
dropped, no existing table altered:**

| Statement | Kind |
|---|---|
| `CREATE TYPE "NutritionInboxStatus"` (`UPLOADED`, `READ`, `FAILED`, `APPLIED`, `DISCARDED`) | inbox item lifecycle; no "reading" state (N1E-F3: reads are driven from the open page) |
| `CREATE TABLE "NutritionLabelInboxItem"` + index `(organizationId, status, createdAt)` + FK to Organization (RESTRICT) | one row per dropped or fetched label file (N1E-F1). `ingredientId` / `suggestedIngredientId` are plain columns, NOT foreign keys — a soft-deleted ingredient is caught at Apply; `readAuditId` points at the AuditLog row holding the transcription (one copy) |

No rows exist on any branch until an ADMIN drops a file on `/nutrition/labels`.

**Fixture:** `scripts/verify-n1e.ts`, 84 checks, all pass, against the applied
schema on dev `br-broad-wave-a6vpjdw0`. Its part 9 creates an "N-1e Fixture
Org" and an inbox row (default `UPLOADED`, no ingredient), and AuditLog rows to
prove the 24 h reuse window (found at 23 h, not at 25 h) and that dialog and
inbox reads share ONE 30/hour pool — inside a transaction that is always
rolled back (9g checks nothing leaked). 8d asserts the migration file is
additive.

**Prisma commands for this migration, verbatim:**
`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
(baseline, empty) · `npx prisma validate` · `npx prisma format` ·
`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script -o prisma/migrations/20261103010000_n1e_label_inbox/migration.sql` ·
the same diff with no `-o` after Gary's first apply (NOT empty — the full
script) · the same diff after his re-apply (empty) · `npx prisma generate`.
`npm run build` also runs `prisma generate`. No `migrate deploy`, `db execute`,
`migrate dev`, `migrate reset` or `migrate resolve` was run by the session.

## 2026-11-03 — `20261103020000_n5_square_modifiers` (N-5)

**APPLIED TO DEV ONLY, by Gary**, after the N-5 Phase 2 STOP and before the
work commit `a9ff45e` (§ A migration STOPS the session). Staging and production
get it from the Vercel build on Gary's push and at promotion. The timestamp is
`20261103020000` — chosen only to sort after N-1e's `20261103010000`; it is a
name, not a clock reading.

After Gary's "Applied to dev: 20261103020000_n5_square_modifiers (Datasource
ep-late-water-a6k53nv2)", the shape diff against the dev datasource (host
`ep-late-water-a6k53nv2`, both `.env` URLs; `env | grep -c DATABASE_URL`
printed `0`) returned `-- This is an empty migration.` — the check, not the
word.

| Branch | Applied (`_prisma_migrations.finished_at`) | By |
|---|---|---|
| dev `br-broad-wave-a6vpjdw0` | applied 2026-11-03 — `finished_at` NOT read by the session; the evidence is the empty shape diff and the fixture's part 7 printing `neon.branch_id = br-broad-wave-a6vpjdw0` against the new tables | Gary |
| staging `br-square-feather-a63z92vz` | applied on Gary's push (the staging Sync from Square — 234 categories, 1,271 sales items, 595 modifiers — and the Recipes → Modifiers tab ran against it before promotion, per the STAMP-3ea8112-FIXTURES prompt) — finished_at not read. (Was: "not yet — on Gary's push" — spent.) | Vercel build |
| production `br-sparkling-block-a620qvg4` | **2026-11-03 21:54:06.247507 UTC** (13:54:06 PST) — 61 s after the promotion `3ea8112` merge (21:53:05 UTC). Read by Gary in the Neon console, branch id from the server, recorded by STAMP-3ea8112-FIXTURES. (Was: "not yet — at promotion" — spent.) | Vercel build |

**GENERATED AGAINST THE LIVE DEV DATABASE, after a clean baseline** (the diff
with no `-o` returned `-- This is an empty migration.` before
`prisma/schema.prisma` was edited; datasource host `ep-late-water-a6k53nv2`).
Every statement is generated; nothing is hand-authored, so nothing joins
§ Protected indexes. **Additive only — no backfill, nothing dropped; the one
existing table touched gains a nullable column:**

| Statement | Kind |
|---|---|
| `ALTER TABLE "Recipe" ADD COLUMN "squareModifierId" TEXT` + unique index + FK to SquareModifier (SET NULL) | a recipe may belong to a Square modifier; at most one of salesItemId / squareModifierId (enforced in the API) |
| `CREATE TABLE "SquareModifierList"` + unique `(organizationId, squareModifierListId)` + FK to Organization (RESTRICT) | synced, read-only |
| `CREATE TABLE "SquareModifier"` + unique `(organizationId, squareModifierId)` + index `(modifierListId)` + FKs to Organization and SquareModifierList (RESTRICT) | synced, read-only; `recipeStatus` is Froot's |
| `CREATE TABLE "SquareItemModifierList"` + unique `(organizationId, squareItemId, modifierListId)` + index `(organizationId, squareItemId)` + FKs to Organization (RESTRICT) and SquareModifierList (CASCADE) | item ↔ list links, keyed by the Square ITEM id; rewritten wholesale on each sync |

No rows exist on any branch until an ADMIN runs "Sync from Square".

**Fixture:** `scripts/verify-n5-modifiers.ts`, 51 checks, all pass, against the
applied schema on dev `br-broad-wave-a6vpjdw0`. Its part 7 creates an "N-5
Fixture Org", syncs a canned catalog, attaches a modifier recipe with a
negative line, re-syncs with a modifier gone (swept to isDeleted, recipe and
MAPPED kept; NON_RECIPE survives), and re-adds it — inside a transaction that
is always rolled back (7i checks nothing leaked). 6j asserts the migration file
is additive.

**Prisma commands for this migration, verbatim:**
`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
(baseline, empty) · `npx prisma format` · `npx prisma validate` ·
`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script -o prisma/migrations/20261103020000_n5_square_modifiers/migration.sql` ·
the same diff with no `-o` after Gary's apply (empty) · `npx prisma generate`.
`npm run build` also runs `prisma generate`. No `migrate deploy`, `db execute`,
`migrate dev`, `migrate reset` or `migrate resolve` was run by the session.

## 2026-11-04 — `20261104010000_n5b_sales_modifier_cache` (N-5b)

**APPLIED TO DEV ONLY, by Gary**, at the N-5b migration STOP and before the
work commit (§ A migration STOPS the session). Staging and production get it
from the Vercel build on Gary's push and at promotion. The timestamp is
`20261104010000` — chosen only to sort after N-5's `20261103020000`; it is a
name, not a clock reading.

| Branch | Applied (`_prisma_migrations.finished_at`) | By |
|---|---|---|
| dev `br-broad-wave-a6vpjdw0` | **2026-11-04 18:49:26.220683 UTC** (10:49:26 PST) — read by the session from `_prisma_migrations` in the same query as `current_setting('neon.branch_id', true)` | Gary |
| staging `br-square-feather-a63z92vz` | not yet — on Gary's push | Vercel build |
| production `br-sparkling-block-a620qvg4` | not yet — at promotion | Vercel build |

After Gary's "go", the shape diff against the dev datasource (host
`ep-late-water-a6k53nv2`; `env | grep -c DATABASE_URL` printed `0`) returned
`-- This is an empty migration.` **No baseline empty diff was taken BEFORE
`schema.prisma` was edited** (N-5 took one); the generated file contains only
the N-5b statements below, which is the evidence that dev had no other drift.
Every statement is generated; nothing is hand-authored, so nothing joins
§ Protected indexes. **Additive only — nothing dropped, no backfill; the one
existing table touched gains a NOT NULL column with a default:**

| Statement | Kind |
|---|---|
| `ALTER TABLE "SalesPeriodCache" ADD COLUMN "modifiersCaptured" BOOLEAN NOT NULL DEFAULT false` | R1b: every existing row reads false = "cached before N-5b, no add-on data"; every N-5b sync sets true inside the BUG-7 guarded upsert |
| `CREATE TABLE "SalesModifierCache"` + unique `(storeId, date, squareModifierId)` + index `(storeId, date)` + FKs to Organization (RESTRICT) and Store (CASCADE) | per store-day Σ (line qty × modifier qty); replaced per won store-day inside `writeSalesCache`, never appended |

No `SalesModifierCache` rows exist on any branch until a sync runs on the new
code. Gary's ruled one-time 28-day backfill (R1) is a re-sync of each linked
store's last 28 days ("Sync sales for this range", Inventory → Reports) after
promotion.

**Fixture:** `scripts/verify-n5b-modifier-usage.ts`, 36 checks, all pass,
against the applied schema on dev `br-broad-wave-a6vpjdw0` (Square stubbed;
throwaway "ZZ N-5b Fixture" org + store, deleted). S1 asserts the migration
file is additive.

**Prisma commands for this migration, verbatim:** `npx prisma format` ·
`npx prisma validate` ·
`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script -o prisma/migrations/20261104010000_n5b_sales_modifier_cache/migration.sql` ·
`npx prisma generate` (after Gary's apply) · the same diff with no `-o` after
the apply (empty). `npm run build` also runs `prisma generate`. No
`migrate deploy`, `db execute`, `migrate dev`, `migrate reset` or
`migrate resolve` was run by the session.

## 2026-11-04 — `20261104020000_tpl3_task_retired_at` (TPL-3)

**APPLIED TO DEV ONLY, by Gary**, at the TPL-3 migration STOP and before the
work commit (§ A migration STOPS the session). Staging and production get it
from the Vercel build on Gary's push and at promotion. The timestamp is
`20261104020000` — chosen only to sort after N-5b's `20261104010000`; it is a
name, not a clock reading.

| Branch | Applied (`_prisma_migrations.finished_at`) | By |
|---|---|---|
| dev `br-broad-wave-a6vpjdw0` | **2026-11-05 00:57:03.600728 UTC** (2026-11-04 16:57:03 PST) — read by the session from `_prisma_migrations` in the same query as `current_setting('neon.branch_id', true)` | Gary |
| staging `br-square-feather-a63z92vz` | not yet — on Gary's push | Vercel build |
| production `br-sparkling-block-a620qvg4` | not yet — at promotion *(spent, kept: see below)* | Vercel build |

**Production: APPLIED 2026-11-04 via vercel-build at promotion merge `6a6e2af`.**
Read by Gary in the Neon console on the production branch (he confirmed
"production"; `neon.branch_id` was not selected), pasted result:
`finished_at` = **2026-11-05 01:31:25.350596 UTC** (2026-11-04 17:31:25 PST),
`rolled_back_at` = null. The Vercel build log was not read. **Staging:** this
promotion did not read or record a `finished_at`. The staging row above is
still "not yet" as written, and that is unverified, not a claim that it is
unapplied. Staging deploys of `b6123e9` ran the same vercel-build.

The diff against the dev datasource (`env | grep -c DATABASE_URL` printed `0`)
generated exactly one statement, which is the evidence dev had no other drift.
No baseline empty diff was taken before `schema.prisma` was edited. After the
apply, the same diff with no `-o` returned `-- This is an empty migration.`
Generated, not hand-authored, so nothing joins § Protected indexes.
**Additive only — nothing dropped, no backfill, no default:**

| Statement | Kind |
|---|---|
| `ALTER TABLE "Task" ADD COLUMN "retiredAt" TIMESTAMP(3)` | nullable; every existing row reads NULL = live, which is exactly what each was before TPL-3. Set by PATCH `/api/templates/[id]` when a removed task has TaskLog history |

**Fixture:** `scripts/verify-tpl3.ts`, 42 checks, all pass, against the
applied schema on dev `br-broad-wave-a6vpjdw0` (throwaway `fixture-tpl3-*`
org, deleted; leftover count asserted 0).

**Prisma commands for this migration, verbatim:** `npx prisma format` ·
`npx prisma validate` ·
`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script -o prisma/migrations/20261104020000_tpl3_task_retired_at/migration.sql` ·
`npx prisma generate` (after Gary's apply, twice — the first output was
truncated by `tail`) · the same diff with no `-o` after the apply (empty).
`npm run build` also runs `prisma generate`. No `migrate deploy`,
`db execute`, `migrate dev`, `migrate reset` or `migrate resolve` was run by
the session.

## 2026-11-05 — `0_init` (DEBT-125 baseline squash; closes BUG-25)

**STATUS: MARKED ON ALL BRANCHES (dev, staging, production), 2026-11-05.
Promoted in merge `ba38ed2`** (DEPLOY_LOG `ba38ed2 — 2026-11-05 — DEBT-125`).
Rollback: `git revert -m 1 ba38ed2` does NOT remove the `0_init` rows below;
rolling back the squash needs a planning session, not a revert alone.
Stamped by PROMOTE-DOCS_2026-11-05_DEBT-125. The previous status line, spent
and kept: "BUILT. MARKED ON DEV ONLY (2026-11-05); staging and production NOT
marked. … Work commit `1c85892` on `staging`, not pushed."

Phase 3 rehearsal passed (DEPLOY_LOG). See § 2a for what was built, the
marking INSERT, and the recovery UPDATE.

| Branch | `0_init` row (`_prisma_migrations`) | By |
|---|---|---|
| dev `br-broad-wave-a6vpjdw0` | **MARKED 2026-11-05**, right after Phase 3 B (Gary's ruling). id `ad30c396-8451-4f30-8109-158b65b16dff`. A local `migrate deploy` after it found nothing pending. `finished_at` not recorded | Gary, console |
| staging `br-square-feather-a63z92vz` | **MARKED 2026-11-05**, before the push that carried `1c85892`. id `85cb75ea-8670-4cde-b5ba-255a713543f4`, 87 ledger rows. The `9213f4c` staging build on `ep-odd-rain-a6gr4xmm`: "1 migration found", then "No pending migrations to apply". `finished_at` not recorded | Gary, console |
| production `br-sparkling-block-a620qvg4` | **MARKED 2026-11-05**, before the `ba38ed2` promotion. Checksum `0e7d39aa…b752e4c717`, 1 step, 87 ledger rows. id not recorded. Production build for `ba38ed2`, Gary's words: "ba38ed2 went Ready on production; build log showed no pending migrations." | Gary, console |

**Archive.** The 86 entries above this one name migrations that now live in
`prisma/migrations_archive/<name>/`. Their verbatim command lines
(`-o prisma/migrations/<name>/…`) are kept as they were run and are not
rewritten. Read `prisma/migrations/` in them as `prisma/migrations_archive/`.
The count is **86**, not the 87 the DEBT-125 prompt said.

**Before the build (2026-11-05, Gary in the Neon console):**
- § 7 B of `docs/prompts/DEBT-125_AUDIT.md` was run on all three branches:
  86 ledger rows each, latest `20261104020000_tpl3_task_retired_at`, 0
  open-failed rows, tpl3 checksum `943b2b39…9704` (proving the sha256
  checksum formula), exactly the 3 partial indexes and 5 CHECKs, no
  triggers, functions, views or sequences, `plpgsql` only, PostgreSQL 18.6.
- **Staging drift repaired:** `receivedAt TIMESTAMP(3)` (nullable, no
  default) was missing on `PurchaseOrder` and `PurchaseOrderLine`. Gary
  added both with `ADD COLUMN IF NOT EXISTS` on `br-square-feather`
  (DEBT-125 R4). No migration: neither table was ever created by one.
- Full-column fingerprint afterwards, the same on all three branches: 1356
  columns, `6b6bdfe6cbc90ee531e105bbd0ad0343`.

**Fixture:** `scripts/verify-debt125.ts`, pure, all checks pass. A mutation
run (one CHECK deleted from `0_init`) failed 3 checks as it should, and the
file was restored byte-identical.

**Prisma commands the session ran, verbatim:**
- `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
  (gate on dev; empty)
- `npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script -o <scratchpad>/0_init.regen.sql`
  (byte-identical to the Phase 1 candidate)
- `npx prisma validate`
- `npm run build`, which runs `prisma generate`

**Not run:** Phase 2 step 4's `--from-migrations` diff (F2). The session ran no
`migrate deploy`, `migrate dev`, `migrate reset`, `migrate resolve` or
`db execute`.

## 2026-11-06 — `20261106230000_notify_taskcomm_kind_settings` (NOTIFY-4)

**SHIPPED 2026-11-06 in merge `0ee6965`** (DEPLOY_LOG `0ee6965 — 2026-11-06 —
NOTIFY-4`). **The FIRST migration after the DEBT-125 squash**, sitting beside
`0_init` in `prisma/migrations/`. Applied to dev by Gary at the NOTIFY-4
migration STOP, before the work commit `652ea75` (§ A migration STOPS the
session). The timestamp `20261106230000` is a name, not a clock reading.
**Written after the fact** on 2026-11-06 by
PROMOTE-DOCS_2026-11-06_NOTIFY-16_NOTIFY-4, on Gary's instruction ("Write the
entry"). The NOTIFY-4 session wrote no entry here. Every fact below comes from
the NOTIFY-4 ROADMAP row, its DEPLOY_LOG entry and the promotion prompt. None
was re-measured by this session.

| Branch | Applied (`_prisma_migrations.finished_at`) | By |
|---|---|---|
| dev `br-broad-wave-a6vpjdw0` | **2026-11-06 23:37:11 UTC** (15:37 PST), "ledger finished", as recorded in the NOTIFY-4 row and DEPLOY_LOG entry. Whether `neon.branch_id` was selected with it is not recorded | Gary |
| staging `br-square-feather-a63z92vz` | applied in the `5c24e02` staging build log (endpoint `ep-odd-rain-a6gr4xmm`): "2 migrations found … successfully applied". This is the first evidence that `migrate deploy` works on the squashed baseline. `finished_at` not read | Vercel build |
| production `br-sparkling-block-a620qvg4` | applied via vercel-build at promotion merge `0ee6965`. **The production build-log migration lines were NOT pasted to chat, and no `finished_at` was read.** The evidence is Gary's report that the build went Ready and the new card loads on production /settings/notifications. That page reads `NotificationKindSettings`, so it could not load without the table | Vercel build |

**Additive only.** It creates one new table and no existing table is
altered. There is no backfill, and nothing is dropped. The `sendToStores`
column was removed from the schema before the SQL was regenerated (Gary,
"Change to the migration"):

| Statement | Kind |
|---|---|
| `CREATE TABLE "NotificationKindSettings"` (`id`, `organizationId`, `kind`, `enabled` default false, `subject`, `body`, `sendToAdmins` default true, `sendToManagers` default true, `thresholdPct`, `updatedByUserId`, `createdAt`, `updatedAt`) | per-org, per-kind email settings. **No row = off**, so the Tasks and Communication email starts OFF for every org on every branch |
| `CREATE UNIQUE INDEX` `(organizationId, kind)` | one settings row per org per kind |
| FK `organizationId` → `Organization` `ON DELETE CASCADE` | the settings go with the org |

**Blast radius beyond the new kind.** The dispatcher's `loadOrg` selects
`notificationKindSettings` for EVERY email kind. Any email send on a branch
the migration had not reached would fail. All three branches now have it.

**Rollback.** `git revert -m 1 0ee6965`. The table STAYS on every branch
(additive-only schema); the reverted code simply stops reading it. A revert
changes files, never a ledger.

**Fixture:** `scripts/verify-notify-taskcomm.ts` against the applied schema
on dev `br-broad-wave-a6vpjdw0`: 69/69 at `652ea75`, 86/86 after `12c5474`,
94/94 after `f042fd4`.

**Prisma commands for this migration, verbatim** — from the NOTIFY-4 build
session's own report in chat on 2026-11-06, when it regenerated the
migration, as relayed by Gary (not found in the repo):
`npx prisma format` · `npx prisma validate` ·
`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script -o prisma/migrations/20261106230000_notify_taskcomm_kind_settings/migration.sql`.
Gary applied it to dev himself with `npx prisma migrate deploy`; the session
did not. `npm run build` also runs `prisma generate`. (Was: "NOT RECORDED",
written by this entry's first commit `b969223` because the commands were not
in the repo. Corrected the same day on Gary's relay; spent.)

## 2026-11-10 — `20261110200000_tab3_display_layouts` (TAB-3)

**SHIPPED 2026-11-10 in merge `8417fc3`** (DEPLOY_LOG `8417fc3 — 2026-11-10 —
TAB-3`; the TAB-9 entry carries the merge facts), with the whole Tablet mode
series, TAB-1 → TAB-9. Stamped post-merge 2026-11-10 on `staging` by
PROMOTE-DOCS_2026-11-10_TAB (prepended; nothing below is edited). The two
OWED cells in the table below are spent, kept. Per branch at this stamp:

- **production `br-sparkling-block-a620qvg4`:** applied to production via
  `vercel-build` at promotion `8417fc3` — **CONFIRMED by Gary 2026-11-10
  from the production build log:** "Production build log shows
  20261110200000_tab3_display_layouts applied". No build-log lines were
  pasted and no `finished_at` was read. (Was: "pending Gary's confirmation
  from the production build log", in `28c38ec`; spent.)
- **staging `br-square-feather-a63z92vz`:** applied by the Vercel build on
  Gary's push. The evidence is Gary's verdict on the series, "Everything is
  tested and working great": the TAB-3 staging test list included test (0),
  the `_prisma_migrations` row with a `finished_at`. No `finished_at` value
  was pasted.

**Rollback (whole series):** `git revert -m 1 8417fc3`. The two columns stay
on every branch (additive-only); leaving them after a code revert is harmless.

**APPLIED TO DEV ONLY, by Gary**, after the TAB-3 Phase 2 STOP and before the
work commit `c38d998` (§ A migration STOPS the session). Staging and production
get it from the Vercel build on Gary's push and at promotion. The timestamp
`20261110200000` is a name, not a clock reading.

**Dev was checked before the fixture, not taken on its word.**
- **After Gary's first "Migration applied to dev":** the shape diff against
  dev still printed both `ADD COLUMN` statements. A read-only ledger query on
  `neon.branch_id = br-broad-wave-a6vpjdw0` found no TAB-3 row (newest:
  NOTIFY-4) and zero matching columns. Nothing was committed, and Gary was
  told.
- **After his second report:** the diff returned
  `-- This is an empty migration.`, and the same query returned the row and
  columns below.

| Branch | Applied (`_prisma_migrations.finished_at`) | By |
|---|---|---|
| dev `br-broad-wave-a6vpjdw0` | **2026-11-10 18:14:08.611 UTC** (10:14:08 PST). Read by the session (read-only `$queryRaw`, branch id from the server), together with `information_schema`: both columns `jsonb`, nullable | Gary |
| staging `br-square-feather-a63z92vz` | OWED — the Vercel build on Gary's push | Vercel build |
| production `br-sparkling-block-a620qvg4` | OWED — at promotion (TAB series promotes only once it's finished, per Gary 2026-11-10) | Vercel build |

**GENERATED AGAINST THE LIVE DEV DATABASE.** No empty-diff baseline was run
before `prisma/schema.prisma` was edited. Instead, the generated file carries
the two TAB-3 columns and nothing else, which shows dev matched the schema in
every other respect at generation. The first attempt failed with "Can't reach
database server" (a Neon cold start) and wrote no file. The retry succeeded.
Every statement is generated, and nothing is hand-authored. **Additive only.
Nothing is backfilled or dropped:**

| Statement | Kind |
|---|---|
| `ALTER TABLE "Organization" ADD COLUMN "dashboardLayout" JSONB` | nullable, no default. NULL = Froot's default desktop layout (TAB-3 ruling 2), so every existing org needs no backfill and renders exactly as before |
| `ADD COLUMN "tabletLayout" JSONB` (same statement) | nullable, no default. NULL = Tasks + Messages, no stat strip |

**Blast radius (the NOTIFY-2a shape).** Every `prisma.organization` read
without a `select` now selects both columns. On a branch the migration has not
reached, those reads fail, and they sit behind nearly every page. The Vercel
build applies it before the new code serves. Locally, dev must have it before
`npm run dev` is useful again.

**Rollback.** `git revert` the work commit. The columns STAY on every branch
(additive-only schema), and the reverted code simply stops reading them.

**Fixture:** `scripts/verify-tab3-layout.ts`. Part 7 runs against the applied
schema inside an always-rolled-back transaction, and prints `neon.branch_id`
from the server. Before Gary's apply, cases 1–21 pass and part 7 fails on dev
`br-broad-wave-a6vpjdw0` with "The column `(not available)` does not exist".
That failure is the gate. **After the apply: 28/28** on dev
`br-broad-wave-a6vpjdw0`, at the work commit `c38d998`. The count is 28
rather than 26 because cases 12b and 12c (Gary's F6 refinement) were added
before the commit.

**Prisma commands for this migration, verbatim:**

- `npx prisma validate`
- `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script -o prisma/migrations/20261110200000_tab3_display_layouts/migration.sql`
  (once refused, unreachable; then succeeded)
- `npx prisma generate`
- after each of Gary's two apply reports, the same diff with no `-o`
  (the first not empty, the second empty)

`npm run build` also runs `prisma generate`. The session ran no
`migrate deploy`, `db execute`, `migrate dev`, `migrate reset` or
`migrate resolve`.

## 2026-11-10 — `20261111050000_tab4_tablet_pin` (TAB-4)

**SHIPPED 2026-11-11 in merge `c21fe51`** (DEPLOY_LOG `c21fe51 — 2026-11-10 —
TAB-4`; the TAB-12 entry carries the merge facts), with TAB-7, TAB-8, TAB-10,
TAB-11 and TAB-12. Stamped post-merge 2026-11-11 on `staging` by the TAB-13
promotion pass (late: `c21fe51` got no docs pass when it was made;
prepended, nothing below is edited). The two OWED cells in the table below
are superseded by this stamp, kept. Per branch at this stamp:

- **production `br-sparkling-block-a620qvg4`: EVIDENCE PENDING.** Gary's
  ruling for this record: production-branch evidence with the branch column,
  or "evidence pending", not "applied". No `_prisma_migrations` row or
  `information_schema` read was taken on this branch: the Neon console showed
  a login page to this session. **Supporting, not branch-identified:** the
  production build log of deployment `froot-1kpsm7gn1` (built from
  `c21fe51`; `vercel inspect --logs`, read by this pass, host redacted)
  shows `prisma migrate deploy` → "4 migrations found", "Applying migration
  `20261111050000_tab4_tablet_pin`", "All migrations have been successfully
  applied", at 2026-11-11T20:02:32Z. To close: the read-only query below on
  `br-sparkling-block`, branch id from the server (R4).
  `SELECT current_setting('neon.branch_id', true) AS neon_branch, migration_name, finished_at FROM "_prisma_migrations" WHERE migration_name = '20261111050000_tab4_tablet_pin';`
- **staging `br-square-feather-a63z92vz`:** applied by the Vercel build on
  Gary's push (TAB-4 PRE-PUSH-CHECK `7397e35`). No `finished_at` read.
  Indirect: on 2026-11-11 the staging server answered
  GET `/api/stores/[id]/tablet-tasks` with `pinRequired: false`, which
  selects `Organization.tabletPinRequired` (`tablet-tasks/read.ts:48`) and
  would fail without the column.

**APPLIED TO DEV ONLY, by Gary**, with `npx prisma migrate deploy`, after the
TAB-4 build STOP and before the work commit `0064bf9` (§ A migration STOPS the
session). Staging and production get it from the Vercel build on Gary's push
and at promotion. The timestamp `20261111050000` is a name, not a clock
reading.

**Dev was checked before the fixture, not taken on its word.**
- **After Gary's first "applied to dev":** the fixture's database part failed
  with "The column `tabletPinRequired` does not exist". A read-only check on
  BOTH `.env` connection strings (`DATABASE_URL`, the app's, and
  `DATABASE_URL_UNPOOLED`, the Prisma CLI's) found the same branch,
  `br-broad-wave-a6vpjdw0`, with no TAB-4 ledger row (newest tab-series row:
  `20261110200000_tab3_display_layouts`) and no column. Nothing was
  committed, and Gary was told. Gary then checked staging, production and
  `preview/main` in the Neon console: none had the row or the column. It had
  not been run anywhere.
- **After his second report:** the same read-only check returned the row and
  all five columns below, and `migrate diff` of dev against the schema
  returned `-- This is an empty migration.`

| Branch | Applied (`_prisma_migrations.finished_at`) | By |
|---|---|---|
| dev `br-broad-wave-a6vpjdw0` | **2026-11-11 05:04:48.251 UTC** (2026-11-10 21:04:48 PST). Read by the session (read-only query, branch id from the server), together with `information_schema`: `Organization.tabletPinRequired`, `StaffMember.pinHash`, `pinSetAt`, `pinFailedAttempts`, `pinLockedUntil` all present | Gary |
| staging `br-square-feather-a63z92vz` | OWED — the Vercel build on Gary's push | Vercel build |
| production `br-sparkling-block-a620qvg4` | OWED — at promotion | Vercel build |

**GENERATED AGAINST THE LIVE DEV DATABASE**, with:

```
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script -o prisma/migrations/20261111050000_tab4_tablet_pin/migration.sql
```

The generated file carries the TAB-4 columns and nothing else, which shows
dev matched the schema in every other respect at generation. Every statement
is generated; nothing is hand-authored. **Additive only. Nothing is
backfilled or dropped:**

| Statement | Kind |
|---|---|
| `ALTER TABLE "Organization" ADD COLUMN "tabletPinRequired" BOOLEAN NOT NULL DEFAULT false` | the per-org switch (Q1); every existing org lands OFF |
| `ALTER TABLE "StaffMember" ADD COLUMN "pinFailedAttempts" INTEGER NOT NULL DEFAULT 0` | the lockout counter (Q9) |
| `ADD COLUMN "pinHash" TEXT` (same statement) | nullable; scrypt over HMAC(`TABLET_PIN_PEPPER`, pin). **Rotating `TABLET_PIN_PEPPER` invalidates every PIN** |
| `ADD COLUMN "pinLockedUntil" TIMESTAMP(3)` | nullable; the 5-minute lock |
| `ADD COLUMN "pinSetAt" TIMESTAMP(3)` | nullable; "has a PIN" for every screen, so nothing but the verify path reads the hash |

**Blast radius (the NOTIFY-2a shape).** Every `prisma.organization` and
`prisma.staffMember` read without a `select` now selects the new columns
(except `pinHash`, which the client omits globally). On a branch the migration
has not reached, those reads fail, and they sit behind nearly every page. The
Vercel build applies it before the new code serves. Locally, dev must have it
before `npm run dev` is useful.

**Rollback.** `git revert` the work commit. The columns STAY on every branch
(additive-only schema), and the reverted code simply stops reading them.

**Fixture:** `scripts/verify-tab4-pin.ts`, part C on dev
`br-broad-wave-a6vpjdw0` (it prints `neon.branch_id` from the server). Before
the apply: parts A and B 58/58, part C failed on the missing column — the
gate. **After the apply: 78/78**, three runs (part C grew by C16 and B by
B14/B15, the 5th-PIN race checks Gary asked for, before the commit). The
TAB-3 and CHK-15 database parts also failed before the apply (every
`Organization` read selects the new column) and pass after: 28/28 each.

**Prisma commands run by the session, verbatim:** `npx prisma format`,
`npx prisma validate`, `npx prisma generate` (twice), the `migrate diff -o`
above, and `npx prisma migrate diff --from-config-datasource --to-schema
prisma/schema.prisma --script` (the empty-diff check). `npm run build` also
runs `prisma generate`. The session ran no `migrate deploy`, `db execute`,
`migrate dev`, `migrate reset` or `migrate resolve`.
