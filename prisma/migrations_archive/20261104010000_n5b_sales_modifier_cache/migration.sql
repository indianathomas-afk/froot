-- AlterTable
ALTER TABLE "SalesPeriodCache" ADD COLUMN     "modifiersCaptured" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SalesModifierCache" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "squareModifierId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "SalesModifierCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesModifierCache_storeId_date_idx" ON "SalesModifierCache"("storeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SalesModifierCache_storeId_date_squareModifierId_key" ON "SalesModifierCache"("storeId", "date", "squareModifierId");

-- AddForeignKey
ALTER TABLE "SalesModifierCache" ADD CONSTRAINT "SalesModifierCache_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesModifierCache" ADD CONSTRAINT "SalesModifierCache_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
