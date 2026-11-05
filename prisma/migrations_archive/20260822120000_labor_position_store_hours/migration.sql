-- CreateTable
CREATE TABLE "LaborPositionStoreHours" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "laborPositionId" TEXT NOT NULL,
    "weeklyHours" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaborPositionStoreHours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LaborPositionStoreHours_organizationId_storeId_idx" ON "LaborPositionStoreHours"("organizationId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "LaborPositionStoreHours_storeId_laborPositionId_key" ON "LaborPositionStoreHours"("storeId", "laborPositionId");

-- AddForeignKey
ALTER TABLE "LaborPositionStoreHours" ADD CONSTRAINT "LaborPositionStoreHours_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborPositionStoreHours" ADD CONSTRAINT "LaborPositionStoreHours_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborPositionStoreHours" ADD CONSTRAINT "LaborPositionStoreHours_laborPositionId_fkey" FOREIGN KEY ("laborPositionId") REFERENCES "LaborPosition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
