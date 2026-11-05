-- CreateTable
CREATE TABLE "LaborSalariedPerson" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "squareTeamMemberId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "weeklyCost" DECIMAL(10,2) NOT NULL,
    "weeklyHours" INTEGER NOT NULL,
    "exempt" BOOLEAN,
    "squareAnnualRateSeen" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaborSalariedPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaborSalariedAllocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "allocationBps" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaborSalariedAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LaborSalariedPerson_organizationId_idx" ON "LaborSalariedPerson"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "LaborSalariedPerson_organizationId_squareTeamMemberId_key" ON "LaborSalariedPerson"("organizationId", "squareTeamMemberId");

-- CreateIndex
CREATE INDEX "LaborSalariedAllocation_organizationId_storeId_idx" ON "LaborSalariedAllocation"("organizationId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "LaborSalariedAllocation_personId_storeId_key" ON "LaborSalariedAllocation"("personId", "storeId");

-- AddForeignKey
ALTER TABLE "LaborSalariedPerson" ADD CONSTRAINT "LaborSalariedPerson_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborSalariedAllocation" ADD CONSTRAINT "LaborSalariedAllocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborSalariedAllocation" ADD CONSTRAINT "LaborSalariedAllocation_personId_fkey" FOREIGN KEY ("personId") REFERENCES "LaborSalariedPerson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborSalariedAllocation" ADD CONSTRAINT "LaborSalariedAllocation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
