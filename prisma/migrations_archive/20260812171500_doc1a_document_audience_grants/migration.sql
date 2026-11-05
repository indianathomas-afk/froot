-- DOC-1 Phase A — document audience grants.
--
-- ADDITIVE ONLY. No column is dropped and no existing row is rewritten.
-- HrDocument.appliesTo changes its DEFAULT, not its data: every document that
-- predates this migration keeps "all" and keeps reaching everyone. Only rows
-- created afterwards start closed.
--
-- The Prisma model HrDocumentStoreAssignment was renamed to HrDocumentGrant in
-- the same commit, with @@map holding the physical table name — which is why
-- there is no rename statement anywhere below. Existing rows are all valid
-- STORE grants under the new granteeType default.
--
-- THE LAST TWO STATEMENTS ARE HAND-WRITTEN AND `prisma migrate diff` CANNOT SEE
-- THEM. A future generated diff will propose dropping both. Do not let it —
-- see docs/MIGRATIONS.md.

-- AlterTable
ALTER TABLE "HrDocument" ALTER COLUMN "appliesTo" SET DEFAULT 'selected';

-- AlterTable
ALTER TABLE "HrDocumentStoreAssignment" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "granteeType" TEXT NOT NULL DEFAULT 'STORE',
ADD COLUMN     "staffMemberId" TEXT,
ALTER COLUMN "storeId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "HrDocumentStoreAssignment_staffMemberId_idx" ON "HrDocumentStoreAssignment"("staffMemberId");

-- AddForeignKey
ALTER TABLE "HrDocumentStoreAssignment" ADD CONSTRAINT "HrDocumentStoreAssignment_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex (HAND-WRITTEN — invisible to `prisma migrate diff`)
-- STAFF-row uniqueness. The @@unique([hrDocumentId, storeId]) above cannot
-- cover STAFF rows: their storeId is NULL, Postgres treats NULLs as distinct,
-- so (doc, NULL) never collides with itself and a document could accumulate
-- duplicate grants to the same person. Partial, so it constrains STAFF rows
-- only and leaves the STORE key alone.
CREATE UNIQUE INDEX "HrDocumentStoreAssignment_staff_grant_key"
  ON "HrDocumentStoreAssignment"("hrDocumentId", "staffMemberId")
  WHERE "granteeType" = 'STAFF';

-- AddConstraint (HAND-WRITTEN — invisible to `prisma migrate diff`)
-- Row shape, per Gary's R2: a STORE row carries a store and no staff member, a
-- STAFF row carries a staff member and no store, and neither ever carries both
-- or neither. Every pre-existing row satisfies this by construction — storeId
-- was NOT NULL until the statement above, and staffMemberId is a new column, so
-- all of them are STORE-shaped under the granteeType default.
ALTER TABLE "HrDocumentStoreAssignment" ADD CONSTRAINT "hrdoc_grant_shape" CHECK (
  ("granteeType" = 'STORE' AND "storeId" IS NOT NULL AND "staffMemberId" IS NULL)
  OR
  ("granteeType" = 'STAFF' AND "staffMemberId" IS NOT NULL AND "storeId" IS NULL)
);
