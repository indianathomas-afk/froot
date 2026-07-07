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
Your local `.env` currently points at PRODUCTION. `prisma migrate dev` can offer
to WIPE the database it's pointed at — never point it at prod.

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
```bash
# 1. edit prisma/schema.prisma
# 2. create + apply migration against the dev branch:
npx prisma migrate dev --name add_recipe_table
# 3. commit the migration folder WITH the code that uses it
# 4. push staging → Vercel build runs `prisma migrate deploy` on the staging DB
# 5. test on staging → merge to main → same SQL runs on prod
```

Rules:
- Never `db push` against staging or prod again.
- Never run `migrate dev` against staging or prod (it's the dev-only command).
- A migration file, once pushed, is immutable — fix mistakes with a new migration.
