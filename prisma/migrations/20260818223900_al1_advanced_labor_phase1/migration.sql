-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "squareLaborEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SquareTimecard" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "squareTimecardId" TEXT NOT NULL,
    "squareTeamMemberId" TEXT NOT NULL,
    "squareLocationId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "squareVersion" INTEGER NOT NULL,
    "squareCreatedAt" TIMESTAMP(3) NOT NULL,
    "squareUpdatedAt" TIMESTAMP(3) NOT NULL,
    "breakPaidMinutes" INTEGER NOT NULL DEFAULT 0,
    "breakUnpaidMinutes" INTEGER NOT NULL DEFAULT 0,
    "wageTitle" TEXT,
    "wageJobId" TEXT,
    "wageHourlyRate" DECIMAL(10,2),
    "wageTipEligible" BOOLEAN,
    "declaredCashTips" DECIMAL(10,2),
    "timezone" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SquareTimecard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SquareLaborSyncState" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "lastSyncStartedAt" TIMESTAMP(3),
    "lastSyncOkAt" TIMESTAMP(3),
    "lastWindowStart" DATE,
    "lastWindowEnd" DATE,
    "lastTimecardCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SquareLaborSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SquareTimecard_storeId_startAt_idx" ON "SquareTimecard"("storeId", "startAt");

-- CreateIndex
CREATE INDEX "SquareTimecard_organizationId_syncedAt_idx" ON "SquareTimecard"("organizationId", "syncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SquareTimecard_organizationId_squareTimecardId_key" ON "SquareTimecard"("organizationId", "squareTimecardId");

-- CreateIndex
CREATE UNIQUE INDEX "SquareLaborSyncState_storeId_key" ON "SquareLaborSyncState"("storeId");

-- CreateIndex
CREATE INDEX "SquareLaborSyncState_organizationId_idx" ON "SquareLaborSyncState"("organizationId");

-- AddForeignKey
ALTER TABLE "SquareTimecard" ADD CONSTRAINT "SquareTimecard_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquareTimecard" ADD CONSTRAINT "SquareTimecard_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquareLaborSyncState" ADD CONSTRAINT "SquareLaborSyncState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquareLaborSyncState" ADD CONSTRAINT "SquareLaborSyncState_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
