-- AlterTable
ALTER TABLE "SquareTeamMemberWage" ADD COLUMN     "compConfidential" BOOLEAN NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────────
-- COMP-1 BACKFILL. Ruling 1 (Gary, 2026-08-28): the flag is per-person and
-- admin-set thereafter, but the migration SEEDS IT ON for salaried people and
-- for admins so coverage exists on day one rather than after a manual sweep.
--
-- BOTH STATEMENTS ARE POSITIVE TESTS OVER NULLABLE COLUMNS, DELIBERATELY.
-- "payType" is String? and "annualRate" is Decimal?. A negation over either
-- (NOT / <> ) is not NULL-aware in SQL and would silently skip every row whose
-- column is NULL -- the exact species of defect recorded at length in
-- src/lib/labor-salaried.ts for LaborSalariedPerson.exempt. Never rewrite these
-- WHERE clauses as negations.
--
-- IT IS ALSO IDEMPOTENT-SAFE: every row starts false from the DEFAULT above, and
-- these only ever set true, so a re-run cannot un-flag anyone.

-- 1. Salaried people. Square's own vocabulary is 'SALARY' (NOT the Froot
--    LaborPayType enum) -- see the schema comment on "payType". A row carrying
--    an annual figure without the SALARY label is still salaried comp, which is
--    why the OR is there rather than a single equality test.
UPDATE "SquareTeamMemberWage"
   SET "compConfidential" = true
 WHERE "payType" = 'SALARY' OR "annualRate" IS NOT NULL;

-- 2. Admins. Ruling 7 (Gary, 2026-08-28) -- THE NARROWER READING, CHOSEN
--    DELIBERATELY: this reaches admins who are synced Square team members with a
--    wage row. An admin with no wage row has no roster comp to hide and is
--    correctly untouched; there is nothing about them for this flag to mask.
--
--    The join is StaffMember -> User over StaffMember."userId" (String? @unique)
--    to User."id", verified against prisma/schema.prisma before this SQL was
--    written. Org-scoped on the StaffMember hop so a shared Square member cannot
--    be flagged by another tenant's admin.
UPDATE "SquareTeamMemberWage" w
   SET "compConfidential" = true
  FROM "StaffMember" s
  JOIN "User" u ON u."id" = s."userId"
 WHERE s."squareTeamMemberId" = w."squareTeamMemberId"
   AND s."organizationId"     = w."organizationId"
   AND u."role" = 'ADMIN';
