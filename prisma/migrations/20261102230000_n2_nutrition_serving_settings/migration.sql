-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "nutritionServingFlOz" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "NutritionSizeVolume" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "variationName" TEXT NOT NULL,
    "volumeFlOz" DOUBLE PRECISION NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NutritionSizeVolume_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NutritionItemServing" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "salesItemId" TEXT NOT NULL,
    "perItem" BOOLEAN NOT NULL DEFAULT false,
    "volumeFlOz" DOUBLE PRECISION,
    "servingFlOz" DOUBLE PRECISION,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NutritionItemServing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NutritionSizeVolume_organizationId_variationName_key" ON "NutritionSizeVolume"("organizationId", "variationName");

-- CreateIndex
CREATE UNIQUE INDEX "NutritionItemServing_salesItemId_key" ON "NutritionItemServing"("salesItemId");

-- CreateIndex
CREATE INDEX "NutritionItemServing_organizationId_idx" ON "NutritionItemServing"("organizationId");

-- AddForeignKey
ALTER TABLE "NutritionSizeVolume" ADD CONSTRAINT "NutritionSizeVolume_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NutritionItemServing" ADD CONSTRAINT "NutritionItemServing_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NutritionItemServing" ADD CONSTRAINT "NutritionItemServing_salesItemId_fkey" FOREIGN KEY ("salesItemId") REFERENCES "SalesItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
