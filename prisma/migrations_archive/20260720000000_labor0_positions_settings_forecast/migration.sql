-- CreateEnum
CREATE TYPE "LaborPayType" AS ENUM ('HOURLY', 'SALARIED');

-- CreateEnum
CREATE TYPE "LaborDenominator" AS ENUM ('IN_STORE', 'TOTAL_WITH_DELIVERY');

-- CreateEnum
CREATE TYPE "SalesForecastSource" AS ENUM ('MANUAL', 'LAST_YEAR', 'TREND');

-- CreateTable
CREATE TABLE "LaborPosition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payType" "LaborPayType" NOT NULL DEFAULT 'HOURLY',
    "defaultHourlyRate" DECIMAL(10,2) NOT NULL,
    "impliedWeeklyHours" INTEGER,
    "isSupervisory" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaborPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaborSettings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT,
    "laborTargetPct" DECIMAL(5,2) NOT NULL DEFAULT 20.00,
    "roundingIncrement" DECIMAL(10,2) NOT NULL DEFAULT 1000.00,
    "denominator" "LaborDenominator" NOT NULL DEFAULT 'TOTAL_WITH_DELIVERY',
    "plannedBlendedRate" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaborSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesForecast" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "projectedStoreSales" DECIMAL(10,2) NOT NULL,
    "projectedDelivery" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "source" "SalesForecastSource" NOT NULL DEFAULT 'MANUAL',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesForecast_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LaborPosition_organizationId_idx" ON "LaborPosition"("organizationId");

-- CreateIndex
CREATE INDEX "LaborSettings_organizationId_idx" ON "LaborSettings"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "LaborSettings_organizationId_storeId_key" ON "LaborSettings"("organizationId", "storeId");

-- CreateIndex
-- Partial unique index enforcing a single org-default row (storeId IS NULL),
-- which the composite unique above cannot guarantee because Postgres treats
-- NULLs as distinct. Not expressible in the Prisma datamodel (no WHERE on
-- @@unique), so it lives only here: future `migrate diff` output must PRESERVE
-- this index — never let a generated diff drop it. See LABOR.md.
CREATE UNIQUE INDEX "LaborSettings_org_default_key" ON "LaborSettings"("organizationId") WHERE "storeId" IS NULL;

-- CreateIndex
CREATE INDEX "SalesForecast_organizationId_storeId_idx" ON "SalesForecast"("organizationId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesForecast_storeId_weekStart_key" ON "SalesForecast"("storeId", "weekStart");

-- AddForeignKey
ALTER TABLE "LaborPosition" ADD CONSTRAINT "LaborPosition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborSettings" ADD CONSTRAINT "LaborSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborSettings" ADD CONSTRAINT "LaborSettings_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesForecast" ADD CONSTRAINT "SalesForecast_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesForecast" ADD CONSTRAINT "SalesForecast_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
