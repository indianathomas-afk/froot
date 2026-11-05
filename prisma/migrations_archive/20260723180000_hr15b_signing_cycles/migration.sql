-- DropIndex
DROP INDEX "HrDocumentAcknowledgment_checkpointId_hrDocumentVersionId_s_key";

-- DropIndex
DROP INDEX "HrSignedRecord_hrDocumentVersionId_staffMemberId_key";

-- AlterTable
ALTER TABLE "HrDocumentAcknowledgment" ADD COLUMN     "signingCycle" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "HrSignedRecord" ADD COLUMN     "signingCycle" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "StaffMember" ADD COLUMN     "rehiredAt" TIMESTAMP(3),
ADD COLUMN     "signingCycle" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE UNIQUE INDEX "HrDocumentAcknowledgment_checkpointId_hrDocumentVersionId_s_key" ON "HrDocumentAcknowledgment"("checkpointId", "hrDocumentVersionId", "staffMemberId", "signingCycle");

-- CreateIndex
CREATE UNIQUE INDEX "HrSignedRecord_hrDocumentVersionId_staffMemberId_signingCyc_key" ON "HrSignedRecord"("hrDocumentVersionId", "staffMemberId", "signingCycle");
