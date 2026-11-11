-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "tabletPinRequired" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StaffMember" ADD COLUMN     "pinFailedAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pinHash" TEXT,
ADD COLUMN     "pinLockedUntil" TIMESTAMP(3),
ADD COLUMN     "pinSetAt" TIMESTAMP(3);
