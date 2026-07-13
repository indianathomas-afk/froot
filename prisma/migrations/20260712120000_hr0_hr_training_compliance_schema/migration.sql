-- CreateEnum
CREATE TYPE "HrCheckpointType" AS ENUM ('Field', 'Initial', 'Signature', 'Acknowledgment');

-- CreateEnum
CREATE TYPE "HrAckMethod" AS ENUM ('Field', 'Initial', 'Signature', 'ReadReceipt', 'Attested');

-- CreateEnum
CREATE TYPE "HrAuthMethod" AS ENUM ('ClerkSession', 'Kiosk', 'ManagerAttested');

-- CreateTable
CREATE TABLE "HrDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "appliesTo" TEXT NOT NULL DEFAULT 'all',
    "requiresAcknowledgment" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "linkedFormId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrDocumentStoreAssignment" (
    "id" TEXT NOT NULL,
    "hrDocumentId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,

    CONSTRAINT "HrDocumentStoreAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrDocumentVersion" (
    "id" TEXT NOT NULL,
    "hrDocumentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "fileHash" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "uploadedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrDocumentCheckpoint" (
    "id" TEXT NOT NULL,
    "hrDocumentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "HrCheckpointType" NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "pageRef" INTEGER,
    "attestationText" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "HrDocumentCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrDocumentAcknowledgment" (
    "id" TEXT NOT NULL,
    "checkpointId" TEXT NOT NULL,
    "hrDocumentVersionId" TEXT NOT NULL,
    "staffMemberId" TEXT,
    "userId" TEXT,
    "checkpointName" TEXT NOT NULL,
    "checkpointType" TEXT NOT NULL,
    "documentTitle" TEXT NOT NULL,
    "documentVersionNumber" INTEGER NOT NULL,
    "documentFileHash" TEXT NOT NULL,
    "staffName" TEXT NOT NULL,
    "storeName" TEXT,
    "attestationText" TEXT,
    "method" "HrAckMethod" NOT NULL,
    "typedName" TEXT,
    "signatureImageUrl" TEXT,
    "fieldValue" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "authMethod" "HrAuthMethod" NOT NULL,
    "consentGiven" BOOLEAN NOT NULL,
    "consentText" TEXT,
    "consentVersion" TEXT,

    CONSTRAINT "HrDocumentAcknowledgment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormField" (
    "id" TEXT NOT NULL,
    "hrDocumentId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FormField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormSubmission" (
    "id" TEXT NOT NULL,
    "hrDocumentVersionId" TEXT NOT NULL,
    "staffMemberId" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "employeeSignatureUrl" TEXT,
    "supervisorSignatureUrl" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "FormSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagerNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "staffMemberId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagerNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingModule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subject" TEXT,
    "description" TEXT,
    "appliesTo" TEXT NOT NULL DEFAULT 'all',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingModuleStoreAssignment" (
    "id" TEXT NOT NULL,
    "trainingModuleId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,

    CONSTRAINT "TrainingModuleStoreAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingLesson" (
    "id" TEXT NOT NULL,
    "trainingModuleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "info" TEXT,
    "videoUrl" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TrainingLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingResource" (
    "id" TEXT NOT NULL,
    "trainingLessonId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,

    CONSTRAINT "TrainingResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingQuiz" (
    "id" TEXT NOT NULL,
    "trainingModuleId" TEXT NOT NULL,
    "passThreshold" INTEGER NOT NULL DEFAULT 80,
    "questions" JSONB NOT NULL,

    CONSTRAINT "TrainingQuiz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingAssignment" (
    "id" TEXT NOT NULL,
    "trainingModuleId" TEXT NOT NULL,
    "staffMemberId" TEXT NOT NULL,
    "assignedByUserId" TEXT NOT NULL,
    "trainerUserId" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'NotStarted',
    "hoursLogged" DOUBLE PRECISION,
    "certifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingLessonProgress" (
    "id" TEXT NOT NULL,
    "trainingAssignmentId" TEXT NOT NULL,
    "trainingLessonId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedByStaffId" TEXT,

    CONSTRAINT "TrainingLessonProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HrDocument_organizationId_idx" ON "HrDocument"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "HrDocumentStoreAssignment_hrDocumentId_storeId_key" ON "HrDocumentStoreAssignment"("hrDocumentId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "HrDocumentVersion_hrDocumentId_versionNumber_key" ON "HrDocumentVersion"("hrDocumentId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "HrDocumentAcknowledgment_checkpointId_hrDocumentVersionId_s_key" ON "HrDocumentAcknowledgment"("checkpointId", "hrDocumentVersionId", "staffMemberId");

-- CreateIndex
CREATE INDEX "FormSubmission_staffMemberId_idx" ON "FormSubmission"("staffMemberId");

-- CreateIndex
CREATE INDEX "ManagerNote_staffMemberId_createdAt_idx" ON "ManagerNote"("staffMemberId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ManagerNote_organizationId_idx" ON "ManagerNote"("organizationId");

-- CreateIndex
CREATE INDEX "TrainingModule_organizationId_idx" ON "TrainingModule"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingModuleStoreAssignment_trainingModuleId_storeId_key" ON "TrainingModuleStoreAssignment"("trainingModuleId", "storeId");

-- CreateIndex
CREATE INDEX "TrainingAssignment_staffMemberId_idx" ON "TrainingAssignment"("staffMemberId");

-- CreateIndex
CREATE INDEX "TrainingAssignment_trainingModuleId_idx" ON "TrainingAssignment"("trainingModuleId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingLessonProgress_trainingAssignmentId_trainingLessonI_key" ON "TrainingLessonProgress"("trainingAssignmentId", "trainingLessonId");

-- AddForeignKey
ALTER TABLE "HrDocument" ADD CONSTRAINT "HrDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDocumentStoreAssignment" ADD CONSTRAINT "HrDocumentStoreAssignment_hrDocumentId_fkey" FOREIGN KEY ("hrDocumentId") REFERENCES "HrDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDocumentStoreAssignment" ADD CONSTRAINT "HrDocumentStoreAssignment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDocumentVersion" ADD CONSTRAINT "HrDocumentVersion_hrDocumentId_fkey" FOREIGN KEY ("hrDocumentId") REFERENCES "HrDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDocumentCheckpoint" ADD CONSTRAINT "HrDocumentCheckpoint_hrDocumentId_fkey" FOREIGN KEY ("hrDocumentId") REFERENCES "HrDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDocumentAcknowledgment" ADD CONSTRAINT "HrDocumentAcknowledgment_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "HrDocumentCheckpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDocumentAcknowledgment" ADD CONSTRAINT "HrDocumentAcknowledgment_hrDocumentVersionId_fkey" FOREIGN KEY ("hrDocumentVersionId") REFERENCES "HrDocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormField" ADD CONSTRAINT "FormField_hrDocumentId_fkey" FOREIGN KEY ("hrDocumentId") REFERENCES "HrDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_hrDocumentVersionId_fkey" FOREIGN KEY ("hrDocumentVersionId") REFERENCES "HrDocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "StaffMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagerNote" ADD CONSTRAINT "ManagerNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagerNote" ADD CONSTRAINT "ManagerNote_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingModule" ADD CONSTRAINT "TrainingModule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingModuleStoreAssignment" ADD CONSTRAINT "TrainingModuleStoreAssignment_trainingModuleId_fkey" FOREIGN KEY ("trainingModuleId") REFERENCES "TrainingModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingModuleStoreAssignment" ADD CONSTRAINT "TrainingModuleStoreAssignment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingLesson" ADD CONSTRAINT "TrainingLesson_trainingModuleId_fkey" FOREIGN KEY ("trainingModuleId") REFERENCES "TrainingModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingResource" ADD CONSTRAINT "TrainingResource_trainingLessonId_fkey" FOREIGN KEY ("trainingLessonId") REFERENCES "TrainingLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingQuiz" ADD CONSTRAINT "TrainingQuiz_trainingModuleId_fkey" FOREIGN KEY ("trainingModuleId") REFERENCES "TrainingModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingAssignment" ADD CONSTRAINT "TrainingAssignment_trainingModuleId_fkey" FOREIGN KEY ("trainingModuleId") REFERENCES "TrainingModule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingAssignment" ADD CONSTRAINT "TrainingAssignment_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "StaffMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingLessonProgress" ADD CONSTRAINT "TrainingLessonProgress_trainingAssignmentId_fkey" FOREIGN KEY ("trainingAssignmentId") REFERENCES "TrainingAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingLessonProgress" ADD CONSTRAINT "TrainingLessonProgress_trainingLessonId_fkey" FOREIGN KEY ("trainingLessonId") REFERENCES "TrainingLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingLessonProgress" ADD CONSTRAINT "TrainingLessonProgress_completedByStaffId_fkey" FOREIGN KEY ("completedByStaffId") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
