-- CreateEnum
CREATE TYPE "NutritionStatus" AS ENUM ('ESTIMATED', 'VERIFIED');

-- AlterTable
ALTER TABLE "IngredientNutrition" ADD COLUMN     "labelContentType" TEXT,
ADD COLUMN     "labelFileHash" TEXT,
ADD COLUMN     "labelFileName" TEXT,
ADD COLUMN     "labelFilePathname" TEXT,
ADD COLUMN     "labelFileUrl" TEXT,
ADD COLUMN     "labelSizeBytes" INTEGER,
ADD COLUMN     "labelUploadedAt" TIMESTAMP(3),
ADD COLUMN     "labelUploadedByUserId" TEXT,
ADD COLUMN     "sourceUrl" TEXT,
ADD COLUMN     "status" "NutritionStatus" NOT NULL DEFAULT 'ESTIMATED',
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedByUserId" TEXT;
