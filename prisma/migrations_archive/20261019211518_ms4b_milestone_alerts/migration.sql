-- AlterTable
ALTER TABLE "NotificationMessage" ADD COLUMN     "intentIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "milestoneAlertsEnabled" BOOLEAN NOT NULL DEFAULT false;
