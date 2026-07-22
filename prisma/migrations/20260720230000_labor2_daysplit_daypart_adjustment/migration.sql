-- CreateTable
CREATE TABLE "LaborDaySplit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "weightBps" INTEGER NOT NULL,
    "isOverride" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaborDaySplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaborDaypart" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT,
    "name" TEXT NOT NULL,
    "startLocalMinutes" INTEGER NOT NULL,
    "endLocalMinutes" INTEGER NOT NULL,
    "minHeadcount" INTEGER NOT NULL DEFAULT 1,
    "requiresSupervisor" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaborDaypart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaborDayAdjustment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "adjustmentPct" DECIMAL(5,2) NOT NULL,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaborDayAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LaborDaySplit_organizationId_storeId_idx" ON "LaborDaySplit"("organizationId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "LaborDaySplit_storeId_weekday_key" ON "LaborDaySplit"("storeId", "weekday");

-- CreateIndex
CREATE INDEX "LaborDaypart_organizationId_idx" ON "LaborDaypart"("organizationId");

-- CreateIndex
CREATE INDEX "LaborDayAdjustment_organizationId_storeId_idx" ON "LaborDayAdjustment"("organizationId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "LaborDayAdjustment_storeId_date_key" ON "LaborDayAdjustment"("storeId", "date");

-- AddForeignKey
ALTER TABLE "LaborDaySplit" ADD CONSTRAINT "LaborDaySplit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborDaySplit" ADD CONSTRAINT "LaborDaySplit_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborDaypart" ADD CONSTRAINT "LaborDaypart_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborDaypart" ADD CONSTRAINT "LaborDaypart_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborDayAdjustment" ADD CONSTRAINT "LaborDayAdjustment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborDayAdjustment" ADD CONSTRAINT "LaborDayAdjustment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
