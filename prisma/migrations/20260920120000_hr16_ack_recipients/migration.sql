-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "hrAckRecipients" TEXT[] DEFAULT ARRAY[]::TEXT[];
