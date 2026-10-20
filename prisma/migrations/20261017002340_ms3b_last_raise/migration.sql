-- CreateTable
CREATE TABLE "StaffLastRaise" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "staffMemberId" TEXT NOT NULL,
    "lastRaiseDate" DATE,
    "setByUserId" TEXT NOT NULL,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffLastRaise_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffLastRaise_staffMemberId_key" ON "StaffLastRaise"("staffMemberId");

-- CreateIndex
CREATE INDEX "StaffLastRaise_organizationId_idx" ON "StaffLastRaise"("organizationId");

-- AddForeignKey
ALTER TABLE "StaffLastRaise" ADD CONSTRAINT "StaffLastRaise_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffLastRaise" ADD CONSTRAINT "StaffLastRaise_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
