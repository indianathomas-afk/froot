-- CreateTable
CREATE TABLE "PublicMenu" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "slug" TEXT NOT NULL,
    "disclaimer" TEXT,
    "crossContactNotice" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicMenu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicMenuCategory" (
    "publicMenuId" TEXT NOT NULL,
    "squareCategoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicMenuCategory_pkey" PRIMARY KEY ("publicMenuId","squareCategoryId")
);

-- CreateTable
CREATE TABLE "PublicMenuHiddenItem" (
    "publicMenuId" TEXT NOT NULL,
    "squareItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicMenuHiddenItem_pkey" PRIMARY KEY ("publicMenuId","squareItemId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicMenu_organizationId_key" ON "PublicMenu"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicMenu_slug_key" ON "PublicMenu"("slug");

-- AddForeignKey
ALTER TABLE "PublicMenu" ADD CONSTRAINT "PublicMenu_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicMenuCategory" ADD CONSTRAINT "PublicMenuCategory_publicMenuId_fkey" FOREIGN KEY ("publicMenuId") REFERENCES "PublicMenu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicMenuCategory" ADD CONSTRAINT "PublicMenuCategory_squareCategoryId_fkey" FOREIGN KEY ("squareCategoryId") REFERENCES "SquareCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicMenuHiddenItem" ADD CONSTRAINT "PublicMenuHiddenItem_publicMenuId_fkey" FOREIGN KEY ("publicMenuId") REFERENCES "PublicMenu"("id") ON DELETE CASCADE ON UPDATE CASCADE;
