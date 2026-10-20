-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "milestonesEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StaffMember" ADD COLUMN     "startDate" DATE,
ADD COLUMN     "startDateManual" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TenureMilestone" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dayCount" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "recognition" TEXT NOT NULL,
    "employeeMessage" TEXT NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenureMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WageSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "squareTeamMemberId" TEXT NOT NULL,
    "payType" TEXT,
    "hourlyRate" DECIMAL(10,2),
    "annualRate" DECIMAL(12,2),
    "jobId" TEXT,
    "wageVersion" INTEGER,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WageSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenureMilestone_organizationId_isArchived_idx" ON "TenureMilestone"("organizationId", "isArchived");

-- CreateIndex
CREATE INDEX "WageSnapshot_organizationId_squareTeamMemberId_capturedAt_idx" ON "WageSnapshot"("organizationId", "squareTeamMemberId", "capturedAt");

-- AddForeignKey
ALTER TABLE "TenureMilestone" ADD CONSTRAINT "TenureMilestone_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WageSnapshot" ADD CONSTRAINT "WageSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
