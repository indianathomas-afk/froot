-- CreateTable
CREATE TABLE "MilestoneSettings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "onTimeRedBelow" INTEGER NOT NULL DEFAULT 80,
    "onTimeGreenAtOrAbove" INTEGER NOT NULL DEFAULT 90,
    "onTimeLookbackDays" INTEGER NOT NULL DEFAULT 30,
    "onTimeMinShifts" INTEGER NOT NULL DEFAULT 5,
    "onTimeGraceMinutes" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MilestoneSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MilestoneSettings_organizationId_key" ON "MilestoneSettings"("organizationId");

-- AddForeignKey
ALTER TABLE "MilestoneSettings" ADD CONSTRAINT "MilestoneSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
