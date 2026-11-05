-- CreateTable
CREATE TABLE "StoreIngredientPar" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "parLevel" DOUBLE PRECISION,
    "reorderPoint" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreIngredientPar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoreIngredientPar_organizationId_idx" ON "StoreIngredientPar"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreIngredientPar_storeId_ingredientId_key" ON "StoreIngredientPar"("storeId", "ingredientId");

-- AddForeignKey
ALTER TABLE "StoreIngredientPar" ADD CONSTRAINT "StoreIngredientPar_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreIngredientPar" ADD CONSTRAINT "StoreIngredientPar_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreIngredientPar" ADD CONSTRAINT "StoreIngredientPar_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
