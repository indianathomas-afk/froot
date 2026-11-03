-- CreateEnum
CREATE TYPE "NutritionInboxStatus" AS ENUM ('UPLOADED', 'READ', 'FAILED', 'APPLIED', 'DISCARDED');

-- CreateTable
CREATE TABLE "NutritionLabelInboxItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "NutritionInboxStatus" NOT NULL DEFAULT 'UPLOADED',
    "fileUrl" TEXT,
    "filePathname" TEXT,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "fileHash" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "suggestedIngredientId" TEXT,
    "ingredientId" TEXT,
    "readAuditId" TEXT,
    "readError" TEXT,
    "uploadedByUserId" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NutritionLabelInboxItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NutritionLabelInboxItem_organizationId_status_createdAt_idx" ON "NutritionLabelInboxItem"("organizationId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "NutritionLabelInboxItem" ADD CONSTRAINT "NutritionLabelInboxItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
