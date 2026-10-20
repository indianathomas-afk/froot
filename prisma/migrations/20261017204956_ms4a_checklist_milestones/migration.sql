-- AlterTable
ALTER TABLE "MilestoneSettings" ADD COLUMN     "checklistMilestonesEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ChecklistMilestone" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskCount" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "recognition" TEXT NOT NULL,
    "employeeMessage" TEXT NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChecklistMilestone_organizationId_isArchived_idx" ON "ChecklistMilestone"("organizationId", "isArchived");

-- CreateIndex
CREATE INDEX "TaskLog_completedByStaffId_idx" ON "TaskLog"("completedByStaffId");

-- AddForeignKey
ALTER TABLE "ChecklistMilestone" ADD CONSTRAINT "ChecklistMilestone_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
