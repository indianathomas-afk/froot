-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "instagramAccessToken" TEXT,
ADD COLUMN     "instagramConnectedAt" TIMESTAMP(3),
ADD COLUMN     "instagramEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "instagramTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "instagramUserId" TEXT,
ADD COLUMN     "instagramUsername" TEXT;
