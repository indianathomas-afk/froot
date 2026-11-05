-- CreateEnum
CREATE TYPE "Allergen" AS ENUM ('MILK', 'EGGS', 'FISH', 'CRUSTACEAN_SHELLFISH', 'TREE_NUTS', 'PEANUTS', 'WHEAT', 'SOYBEANS', 'SESAME');

-- AlterTable
ALTER TABLE "Ingredient" ADD COLUMN     "allergens" "Allergen"[] DEFAULT ARRAY[]::"Allergen"[],
ADD COLUMN     "nutritionExempt" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "IngredientNutrition" (
    "id" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "basisAmount" DOUBLE PRECISION NOT NULL,
    "basisUnit" TEXT NOT NULL,
    "calories" DOUBLE PRECISION,
    "totalFatG" DOUBLE PRECISION,
    "saturatedFatG" DOUBLE PRECISION,
    "transFatG" DOUBLE PRECISION,
    "cholesterolMg" DOUBLE PRECISION,
    "sodiumMg" DOUBLE PRECISION,
    "totalCarbG" DOUBLE PRECISION,
    "dietaryFiberG" DOUBLE PRECISION,
    "totalSugarsG" DOUBLE PRECISION,
    "addedSugarsG" DOUBLE PRECISION,
    "proteinG" DOUBLE PRECISION,
    "vitaminDMcg" DOUBLE PRECISION,
    "calciumMg" DOUBLE PRECISION,
    "ironMg" DOUBLE PRECISION,
    "potassiumMg" DOUBLE PRECISION,
    "sourceNote" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngredientNutrition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IngredientNutrition_ingredientId_key" ON "IngredientNutrition"("ingredientId");

-- AddForeignKey
ALTER TABLE "IngredientNutrition" ADD CONSTRAINT "IngredientNutrition_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
