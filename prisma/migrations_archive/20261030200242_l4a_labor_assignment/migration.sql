-- CreateTable
CREATE TABLE "LaborAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "staffMemberId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaborAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LaborAssignment_organizationId_storeId_date_idx" ON "LaborAssignment"("organizationId", "storeId", "date");

-- CreateIndex
CREATE INDEX "LaborAssignment_staffMemberId_date_idx" ON "LaborAssignment"("staffMemberId", "date");

-- AddForeignKey
ALTER TABLE "LaborAssignment" ADD CONSTRAINT "LaborAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborAssignment" ADD CONSTRAINT "LaborAssignment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborAssignment" ADD CONSTRAINT "LaborAssignment_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "StaffMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── HAND-APPENDED BELOW THIS LINE (L-4a). migrate diff did not generate it. ───
-- Ruling 2, Gary 2026-10-30 ("Ratify all as written"; docs/DECISIONS.md
-- "2026-10-30 — L-4a: labor assignment data model (Gary)"): no assignment
-- crosses midnight in L-4, and 0 <= startMinutes < endMinutes <= 1440.
-- Row-local, so a CHECK can express it; OVERLAP between rows cannot be, and is
-- L-4b's write routes (ruling 1).
--
-- THIS CONSTRAINT IS INVISIBLE TO prisma/schema.prisma AND WILL BE DROPPED BY
-- A BASELINE SQUASH. Prisma does not model CHECK constraints and ignores them in
-- later diffs, so it does not register as drift. Listed in docs/MIGRATIONS.md
-- § Protected indexes — re-append it from there if `0_init` is regenerated.
-- A new, empty table: no existing row can fail it.
ALTER TABLE "LaborAssignment" ADD CONSTRAINT "LaborAssignment_minutes_check"
    CHECK ("startMinutes" >= 0 AND "startMinutes" < "endMinutes" AND "endMinutes" <= 1440);
