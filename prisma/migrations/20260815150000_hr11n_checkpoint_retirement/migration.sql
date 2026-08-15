-- AlterTable
ALTER TABLE "HrDocumentCheckpoint" ADD COLUMN     "retiredAt" TIMESTAMP(3),
ADD COLUMN     "retiredByUserId" TEXT,
ADD COLUMN     "retiredReason" TEXT;
