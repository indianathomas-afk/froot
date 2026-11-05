-- CreateEnum
CREATE TYPE "GoalBasisType" AS ENUM ('SQUARE_LAST_YEAR', 'IMPORT', 'MANUAL');

-- CreateTable
CREATE TABLE "GoalPlan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "basisType" "GoalBasisType" NOT NULL,
    "basisTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "increasePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "goalTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "importFileUrl" TEXT,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoalPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyGoal" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "basisAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "goalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isOverride" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DailyGoal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GoalPlan_organizationId_year_idx" ON "GoalPlan"("organizationId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "GoalPlan_storeId_year_key" ON "GoalPlan"("storeId", "year");

-- CreateIndex
CREATE INDEX "DailyGoal_planId_idx" ON "DailyGoal"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyGoal_storeId_date_key" ON "DailyGoal"("storeId", "date");

-- AddForeignKey
ALTER TABLE "GoalPlan" ADD CONSTRAINT "GoalPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalPlan" ADD CONSTRAINT "GoalPlan_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyGoal" ADD CONSTRAINT "DailyGoal_planId_fkey" FOREIGN KEY ("planId") REFERENCES "GoalPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyGoal" ADD CONSTRAINT "DailyGoal_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
