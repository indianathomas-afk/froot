-- CreateTable
CREATE TABLE "NotificationKindSettings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "subject" TEXT,
    "body" TEXT,
    "sendToAdmins" BOOLEAN NOT NULL DEFAULT true,
    "sendToManagers" BOOLEAN NOT NULL DEFAULT true,
    "thresholdPct" INTEGER,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationKindSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationKindSettings_organizationId_kind_key" ON "NotificationKindSettings"("organizationId", "kind");

-- AddForeignKey
ALTER TABLE "NotificationKindSettings" ADD CONSTRAINT "NotificationKindSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
