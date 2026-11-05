-- CreateTable
CREATE TABLE "SquareScheduledShift" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "squareScheduledShiftId" TEXT NOT NULL,
    "squareVersion" INTEGER NOT NULL,
    "squareCreatedAt" TIMESTAMP(3) NOT NULL,
    "squareUpdatedAt" TIMESTAMP(3) NOT NULL,
    "draftLocationId" TEXT NOT NULL,
    "draftJobId" TEXT NOT NULL,
    "draftStartAt" TIMESTAMP(3) NOT NULL,
    "draftEndAt" TIMESTAMP(3) NOT NULL,
    "draftTimezone" TEXT NOT NULL,
    "draftIsDeleted" BOOLEAN NOT NULL,
    "draftTeamMemberId" TEXT,
    "draftNotes" TEXT,
    "publishedLocationId" TEXT,
    "publishedJobId" TEXT,
    "publishedStartAt" TIMESTAMP(3),
    "publishedEndAt" TIMESTAMP(3),
    "publishedTimezone" TEXT,
    "publishedIsDeleted" BOOLEAN,
    "publishedTeamMemberId" TEXT,
    "publishedNotes" TEXT,
    "effectiveLocationId" TEXT NOT NULL,
    "effectiveJobId" TEXT NOT NULL,
    "effectiveStartAt" TIMESTAMP(3) NOT NULL,
    "effectiveEndAt" TIMESTAMP(3) NOT NULL,
    "effectiveTimezone" TEXT NOT NULL,
    "effectiveIsDeleted" BOOLEAN NOT NULL,
    "effectiveTeamMemberId" TEXT,
    "effectiveSource" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SquareScheduledShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SquareScheduleSyncState" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "lastSyncStartedAt" TIMESTAMP(3),
    "lastSyncOkAt" TIMESTAMP(3),
    "lastWindowStart" DATE,
    "lastWindowEnd" DATE,
    "lastShiftCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SquareScheduleSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SquareJobColor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "squareJobId" TEXT NOT NULL,
    "colorKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SquareJobColor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SquareScheduledShift_storeId_effectiveStartAt_idx" ON "SquareScheduledShift"("storeId", "effectiveStartAt");

-- CreateIndex
CREATE INDEX "SquareScheduledShift_organizationId_syncedAt_idx" ON "SquareScheduledShift"("organizationId", "syncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SquareScheduledShift_organizationId_squareScheduledShiftId_key" ON "SquareScheduledShift"("organizationId", "squareScheduledShiftId");

-- CreateIndex
CREATE UNIQUE INDEX "SquareScheduleSyncState_storeId_key" ON "SquareScheduleSyncState"("storeId");

-- CreateIndex
CREATE INDEX "SquareScheduleSyncState_organizationId_idx" ON "SquareScheduleSyncState"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SquareJobColor_organizationId_squareJobId_key" ON "SquareJobColor"("organizationId", "squareJobId");

-- AddForeignKey
ALTER TABLE "SquareScheduledShift" ADD CONSTRAINT "SquareScheduledShift_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquareScheduledShift" ADD CONSTRAINT "SquareScheduledShift_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquareScheduleSyncState" ADD CONSTRAINT "SquareScheduleSyncState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquareScheduleSyncState" ADD CONSTRAINT "SquareScheduleSyncState_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquareJobColor" ADD CONSTRAINT "SquareJobColor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
