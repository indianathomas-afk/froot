-- CreateTable
CREATE TABLE "PaceAlertLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "pacePct" DOUBLE PRECISION NOT NULL,
    "thresholdPct" DOUBLE PRECISION NOT NULL,
    "recipients" TEXT[],
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaceAlertLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaceAlertLog_storeId_month_key" ON "PaceAlertLog"("storeId", "month");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_entityType_createdAt_idx" ON "AuditLog"("organizationId", "entityType", "createdAt");

-- AddForeignKey
ALTER TABLE "PaceAlertLog" ADD CONSTRAINT "PaceAlertLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaceAlertLog" ADD CONSTRAINT "PaceAlertLog_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
