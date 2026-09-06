-- AlterTable
ALTER TABLE "TrainingLesson" ADD COLUMN     "linkedHrDocumentId" TEXT;

-- CreateIndex
CREATE INDEX "TrainingLesson_linkedHrDocumentId_idx" ON "TrainingLesson"("linkedHrDocumentId");

-- AddForeignKey
ALTER TABLE "TrainingLesson" ADD CONSTRAINT "TrainingLesson_linkedHrDocumentId_fkey" FOREIGN KEY ("linkedHrDocumentId") REFERENCES "HrDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
