-- CreateTable
CREATE TABLE "HrSignedRecord" (
    "id" TEXT NOT NULL,
    "hrDocumentVersionId" TEXT NOT NULL,
    "staffMemberId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "signedPdfPathname" TEXT NOT NULL,
    "signedPdfHash" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrSignedRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HrSignedRecord_staffMemberId_idx" ON "HrSignedRecord"("staffMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "HrSignedRecord_hrDocumentVersionId_staffMemberId_key" ON "HrSignedRecord"("hrDocumentVersionId", "staffMemberId");

-- AddForeignKey
ALTER TABLE "HrSignedRecord" ADD CONSTRAINT "HrSignedRecord_hrDocumentVersionId_fkey" FOREIGN KEY ("hrDocumentVersionId") REFERENCES "HrDocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrSignedRecord" ADD CONSTRAINT "HrSignedRecord_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "StaffMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
