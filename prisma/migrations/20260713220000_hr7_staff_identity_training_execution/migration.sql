-- AlterTable
ALTER TABLE "PendingInvite" ADD COLUMN     "staffMemberId" TEXT;

-- AlterTable
ALTER TABLE "StaffMember" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "terminatedAt" TIMESTAMP(3),
ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "TrainingAssignment" ADD COLUMN     "certPdfHash" TEXT,
ADD COLUMN     "certPdfPathname" TEXT,
ADD COLUMN     "certifiedByUserId" TEXT,
ADD COLUMN     "trainerTypedName" TEXT;

-- AlterTable
ALTER TABLE "TrainingLessonProgress" ADD COLUMN     "authMethod" "HrAuthMethod",
ADD COLUMN     "completedByUserId" TEXT;

-- CreateTable
CREATE TABLE "TrainingQuizAttempt" (
    "id" TEXT NOT NULL,
    "trainingAssignmentId" TEXT NOT NULL,
    "questionsSnapshot" JSONB NOT NULL,
    "passThresholdSnapshot" INTEGER NOT NULL,
    "answers" JSONB NOT NULL,
    "scorePct" INTEGER,
    "status" TEXT NOT NULL,
    "authMethod" "HrAuthMethod" NOT NULL,
    "attestedByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingQuizAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrainingQuizAttempt_trainingAssignmentId_idx" ON "TrainingQuizAttempt"("trainingAssignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffMember_userId_key" ON "StaffMember"("userId");

-- AddForeignKey
ALTER TABLE "StaffMember" ADD CONSTRAINT "StaffMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingQuizAttempt" ADD CONSTRAINT "TrainingQuizAttempt_trainingAssignmentId_fkey" FOREIGN KEY ("trainingAssignmentId") REFERENCES "TrainingAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
