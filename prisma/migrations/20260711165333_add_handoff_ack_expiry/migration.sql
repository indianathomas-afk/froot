-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "handoffNoteExpireDays" INTEGER NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE "TeamMessage" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "acknowledgedByUserId" TEXT,
ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "TeamMessage" ADD CONSTRAINT "TeamMessage_acknowledgedByUserId_fkey" FOREIGN KEY ("acknowledgedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
