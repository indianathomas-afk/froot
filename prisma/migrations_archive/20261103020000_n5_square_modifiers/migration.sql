-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "squareModifierId" TEXT;

-- CreateTable
CREATE TABLE "SquareModifierList" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "squareModifierListId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ordinal" INTEGER,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SquareModifierList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SquareModifier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "squareModifierId" TEXT NOT NULL,
    "modifierListId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceCents" INTEGER,
    "ordinal" INTEGER,
    "onByDefault" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "recipeStatus" TEXT NOT NULL DEFAULT 'UNMAPPED',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SquareModifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SquareItemModifierList" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "squareItemId" TEXT NOT NULL,
    "modifierListId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SquareItemModifierList_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SquareModifierList_organizationId_squareModifierListId_key" ON "SquareModifierList"("organizationId", "squareModifierListId");

-- CreateIndex
CREATE INDEX "SquareModifier_modifierListId_idx" ON "SquareModifier"("modifierListId");

-- CreateIndex
CREATE UNIQUE INDEX "SquareModifier_organizationId_squareModifierId_key" ON "SquareModifier"("organizationId", "squareModifierId");

-- CreateIndex
CREATE INDEX "SquareItemModifierList_organizationId_squareItemId_idx" ON "SquareItemModifierList"("organizationId", "squareItemId");

-- CreateIndex
CREATE UNIQUE INDEX "SquareItemModifierList_organizationId_squareItemId_modifier_key" ON "SquareItemModifierList"("organizationId", "squareItemId", "modifierListId");

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_squareModifierId_key" ON "Recipe"("squareModifierId");

-- AddForeignKey
ALTER TABLE "SquareModifierList" ADD CONSTRAINT "SquareModifierList_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquareModifier" ADD CONSTRAINT "SquareModifier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquareModifier" ADD CONSTRAINT "SquareModifier_modifierListId_fkey" FOREIGN KEY ("modifierListId") REFERENCES "SquareModifierList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquareItemModifierList" ADD CONSTRAINT "SquareItemModifierList_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquareItemModifierList" ADD CONSTRAINT "SquareItemModifierList_modifierListId_fkey" FOREIGN KEY ("modifierListId") REFERENCES "SquareModifierList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_squareModifierId_fkey" FOREIGN KEY ("squareModifierId") REFERENCES "SquareModifier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
