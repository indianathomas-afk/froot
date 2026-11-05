-- AlterTable
ALTER TABLE "HrDocument" ADD COLUMN     "externalUrl" TEXT,
ADD COLUMN     "instructionsHtml" TEXT,
ADD COLUMN     "instructionsVideoUrl" TEXT;

-- ─── HAND-WRITTEN BELOW THIS LINE — NOT GENERATED, NOT REGENERABLE ──────────
--
-- DOC-3 ruling 1: a Link is the kind that carries a URL, and only a Link
-- carries one. Both directions, which is why this is an equality of two
-- predicates rather than a pair of IF/THEN clauses:
--
--     kind = 'Link'  ⇔  "externalUrl" IS NOT NULL
--
-- It is TOTAL, never NULL. "kind" is NOT NULL and `IS NOT NULL` is itself a
-- total predicate, so the expression is always true or always false and never
-- the third value a CHECK would silently pass.
--
-- EVERY EXISTING ROW SATISFIES IT WITH NO BACKFILL. Pre-DOC-3 rows are
-- Acknowledgment / FillableForm / Reference with a NULL "externalUrl", so both
-- sides read FALSE and FALSE = FALSE is TRUE. The ALTER cannot fail on data.
--
-- WHAT THIS DOES *NOT* CONSTRAIN, said here because the schema comment is the
-- only other place it is written: "a Link has zero HrDocumentVersion rows".
-- That clause is CROSS-TABLE and a row-local CHECK cannot express it — it
-- would take a trigger. It is enforced in the create route instead.
--
-- THIS CONSTRAINT IS INVISIBLE TO prisma/schema.prisma AND WILL BE DROPPED BY
-- A BASELINE SQUASH. `0_init` is regenerated FROM the schema, the schema has no
-- CHECK support, so a database rebuilt from it comes up with this missing and
-- nothing failing loudly. Same hazard class as `hrdoc_grant_shape`. It is
-- listed in docs/MIGRATIONS.md § Protected indexes and in that file's `0_init`
-- re-append checklist; if you are regenerating the baseline, that table is the
-- list to re-append from.
ALTER TABLE "HrDocument" ADD CONSTRAINT "hrdoc_link_shape"
  CHECK (("kind" = 'Link') = ("externalUrl" IS NOT NULL));
