-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "calendarEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "url" TEXT,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'Standard',
    "recurrence" TEXT NOT NULL DEFAULT 'None',
    "startDate" DATE NOT NULL,
    "dueTime" TEXT,
    "endDate" DATE,
    "appliesTo" TEXT NOT NULL DEFAULT 'all',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEventStoreAssignment" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,

    CONSTRAINT "CalendarEventStoreAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEventAttachment" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarEventAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarOccurrence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "completedAt" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "completedByStaffId" TEXT,
    "notes" TEXT,
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarEvent_organizationId_isArchived_idx" ON "CalendarEvent"("organizationId", "isArchived");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEventStoreAssignment_eventId_storeId_key" ON "CalendarEventStoreAssignment"("eventId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEventAttachment_eventId_key" ON "CalendarEventAttachment"("eventId");

-- CreateIndex
CREATE INDEX "CalendarOccurrence_organizationId_storeId_status_dueDate_idx" ON "CalendarOccurrence"("organizationId", "storeId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarOccurrence_eventId_storeId_dueDate_key" ON "CalendarOccurrence"("eventId", "storeId", "dueDate");

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventStoreAssignment" ADD CONSTRAINT "CalendarEventStoreAssignment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventStoreAssignment" ADD CONSTRAINT "CalendarEventStoreAssignment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventAttachment" ADD CONSTRAINT "CalendarEventAttachment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarOccurrence" ADD CONSTRAINT "CalendarOccurrence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarOccurrence" ADD CONSTRAINT "CalendarOccurrence_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarOccurrence" ADD CONSTRAINT "CalendarOccurrence_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarOccurrence" ADD CONSTRAINT "CalendarOccurrence_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarOccurrence" ADD CONSTRAINT "CalendarOccurrence_completedByStaffId_fkey" FOREIGN KEY ("completedByStaffId") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
