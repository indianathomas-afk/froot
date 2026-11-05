-- AlterTable
ALTER TABLE "HrDocument" ADD COLUMN     "signWithinDays" INTEGER,
ADD COLUMN     "signWithinDaysSetAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "HrDocumentCategory" ADD COLUMN     "defaultSignWithinDays" INTEGER;
