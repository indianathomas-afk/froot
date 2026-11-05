-- AlterTable
ALTER TABLE "MilestoneSettings" ADD COLUMN     "raiseComplianceGate" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "raiseConsecutiveWeeks" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "raiseCooldownDays" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "raiseMinHoursPerWeek" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "raiseMinOnTimePct" INTEGER NOT NULL DEFAULT 90;

-- CreateTable
CREATE TABLE "MilestoneRaiseTraining" (
    "milestoneSettingsId" TEXT NOT NULL,
    "trainingModuleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MilestoneRaiseTraining_pkey" PRIMARY KEY ("milestoneSettingsId","trainingModuleId")
);

-- CreateTable
CREATE TABLE "MilestoneRaiseDocument" (
    "milestoneSettingsId" TEXT NOT NULL,
    "hrDocumentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MilestoneRaiseDocument_pkey" PRIMARY KEY ("milestoneSettingsId","hrDocumentId")
);

-- CreateIndex
CREATE INDEX "MilestoneRaiseTraining_trainingModuleId_idx" ON "MilestoneRaiseTraining"("trainingModuleId");

-- CreateIndex
CREATE INDEX "MilestoneRaiseDocument_hrDocumentId_idx" ON "MilestoneRaiseDocument"("hrDocumentId");

-- AddForeignKey
ALTER TABLE "MilestoneRaiseTraining" ADD CONSTRAINT "MilestoneRaiseTraining_milestoneSettingsId_fkey" FOREIGN KEY ("milestoneSettingsId") REFERENCES "MilestoneSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneRaiseTraining" ADD CONSTRAINT "MilestoneRaiseTraining_trainingModuleId_fkey" FOREIGN KEY ("trainingModuleId") REFERENCES "TrainingModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneRaiseDocument" ADD CONSTRAINT "MilestoneRaiseDocument_milestoneSettingsId_fkey" FOREIGN KEY ("milestoneSettingsId") REFERENCES "MilestoneSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneRaiseDocument" ADD CONSTRAINT "MilestoneRaiseDocument_hrDocumentId_fkey" FOREIGN KEY ("hrDocumentId") REFERENCES "HrDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
