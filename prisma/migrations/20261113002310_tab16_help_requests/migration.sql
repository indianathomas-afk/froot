-- AlterTable
ALTER TABLE "NotificationKindSettings" ADD COLUMN     "tabletAddContacts" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "TeamMessage" ADD COLUMN     "helpEmail" JSONB,
ADD COLUMN     "helpReason" TEXT,
ADD COLUMN     "taskId" TEXT;

-- CreateIndex
CREATE INDEX "TeamMessage_storeId_taskId_createdAt_idx" ON "TeamMessage"("storeId", "taskId", "createdAt");

-- AddForeignKey
ALTER TABLE "TeamMessage" ADD CONSTRAINT "TeamMessage_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
