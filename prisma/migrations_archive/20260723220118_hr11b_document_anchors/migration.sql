-- CreateEnum
CREATE TYPE "HrAnchorMarkType" AS ENUM ('Initial', 'PrintedName', 'DateStamp', 'Store', 'SignatureStamp');

-- CreateEnum
CREATE TYPE "HrAnchorPlacement" AS ENUM ('Right', 'Above', 'Below');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "hrDateStampFormat" TEXT NOT NULL DEFAULT 'dateOnly';

-- CreateTable
CREATE TABLE "DocumentAnchor" (
    "id" TEXT NOT NULL,
    "hrDocumentVersionId" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "width" DOUBLE PRECISION,
    "pageRotation" INTEGER NOT NULL DEFAULT 0,
    "anchorText" TEXT NOT NULL,
    "markType" "HrAnchorMarkType" NOT NULL,
    "placement" "HrAnchorPlacement" NOT NULL DEFAULT 'Right',
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "generatedCheckpointId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentAnchor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentAnchor_hrDocumentVersionId_idx" ON "DocumentAnchor"("hrDocumentVersionId");

-- AddForeignKey
ALTER TABLE "DocumentAnchor" ADD CONSTRAINT "DocumentAnchor_hrDocumentVersionId_fkey" FOREIGN KEY ("hrDocumentVersionId") REFERENCES "HrDocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
