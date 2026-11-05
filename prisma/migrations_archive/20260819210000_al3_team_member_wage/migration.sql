-- CreateTable
CREATE TABLE "SquareTeamMemberWage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "squareTeamMemberId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
    "allLocations" BOOLEAN NOT NULL DEFAULT false,
    "locationIds" TEXT[],
    "jobTitle" TEXT,
    "jobId" TEXT,
    "payType" TEXT,
    "jobAssignmentCount" INTEGER NOT NULL DEFAULT 0,
    "hourlyRate" DECIMAL(10,2),
    "annualRate" DECIMAL(12,2),
    "squareWeeklyHours" INTEGER,
    "isOvertimeExempt" BOOLEAN,
    "wageVersion" INTEGER,
    "squareUpdatedAt" TIMESTAMP(3),
    "weeklyHoursOverride" INTEGER,
    "isSupervisory" BOOLEAN,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SquareTeamMemberWage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SquareTeamMemberWage_organizationId_syncedAt_idx" ON "SquareTeamMemberWage"("organizationId", "syncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SquareTeamMemberWage_organizationId_squareTeamMemberId_key" ON "SquareTeamMemberWage"("organizationId", "squareTeamMemberId");

-- AddForeignKey
ALTER TABLE "SquareTeamMemberWage" ADD CONSTRAINT "SquareTeamMemberWage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
