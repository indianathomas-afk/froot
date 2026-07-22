-- CreateEnum
CREATE TYPE "LaborDailySplitPolicy" AS ENUM ('FLOOR_FIRST', 'SALES_WEIGHTED');

-- AlterTable
ALTER TABLE "LaborSettings" ADD COLUMN     "dailySplitPolicy" "LaborDailySplitPolicy" NOT NULL DEFAULT 'FLOOR_FIRST';

-- CreateTable
CREATE TABLE "WeeklyDayHours" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "date" DATE NOT NULL,
    "hoursOverride" DECIMAL(6,2) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyDayHours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeeklyDayHours_organizationId_storeId_weekStart_idx" ON "WeeklyDayHours"("organizationId", "storeId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyDayHours_storeId_date_key" ON "WeeklyDayHours"("storeId", "date");

-- AddForeignKey
ALTER TABLE "WeeklyDayHours" ADD CONSTRAINT "WeeklyDayHours_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyDayHours" ADD CONSTRAINT "WeeklyDayHours_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
