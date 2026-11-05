-- AlterTable
ALTER TABLE "FormField" ADD COLUMN     "options" JSONB;

-- AlterTable
ALTER TABLE "FormSubmission" ADD COLUMN     "consentText" TEXT,
ADD COLUMN     "consentVersion" TEXT,
ADD COLUMN     "definitionHash" TEXT,
ADD COLUMN     "employeeSignedAt" TIMESTAMP(3),
ADD COLUMN     "employeeTypedName" TEXT,
ADD COLUMN     "formTitle" TEXT,
ADD COLUMN     "formVersionNumber" INTEGER,
ADD COLUMN     "generatedAt" TIMESTAMP(3),
ADD COLUMN     "signedPdfHash" TEXT,
ADD COLUMN     "signedPdfPathname" TEXT,
ADD COLUMN     "staffName" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'PendingSupervisor',
ADD COLUMN     "storeName" TEXT,
ADD COLUMN     "supervisorIpAddress" TEXT,
ADD COLUMN     "supervisorSignedAt" TIMESTAMP(3),
ADD COLUMN     "supervisorTypedName" TEXT,
ADD COLUMN     "supervisorUserAgent" TEXT,
ADD COLUMN     "supervisorUserId" TEXT;

-- AlterTable
ALTER TABLE "HrDocument" ADD COLUMN     "bodyText" TEXT;

-- AlterTable
ALTER TABLE "HrDocumentVersion" ADD COLUMN     "definitionSnapshot" JSONB;

-- CreateIndex
CREATE INDEX "FormSubmission_hrDocumentVersionId_idx" ON "FormSubmission"("hrDocumentVersionId");
