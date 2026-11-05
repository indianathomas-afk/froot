-- DropIndex
DROP INDEX "HrDocumentAcknowledgment_checkpointId_hrDocumentVersionId_s_key";

-- DropIndex
DROP INDEX "HrSignedRecord_hrDocumentVersionId_staffMemberId_signingCyc_key";

-- AlterTable
ALTER TABLE "HrDocument" ADD COLUMN     "reSignEveryMonths" INTEGER,
ADD COLUMN     "reSignEveryMonthsSetAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "HrDocumentAcknowledgment" ADD COLUMN     "renewal" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "HrSignedRecord" ADD COLUMN     "renewal" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "HrDocumentAcknowledgment_checkpointId_hrDocumentVersionId_s_key" ON "HrDocumentAcknowledgment"("checkpointId", "hrDocumentVersionId", "staffMemberId", "signingCycle", "renewal");

-- CreateIndex
CREATE UNIQUE INDEX "HrSignedRecord_hrDocumentVersionId_staffMemberId_signingCyc_key" ON "HrSignedRecord"("hrDocumentVersionId", "staffMemberId", "signingCycle", "renewal");
