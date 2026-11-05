-- AlterTable
ALTER TABLE "CalendarEvent" ADD COLUMN     "templateId" TEXT;

-- AlterTable
ALTER TABLE "Checklist" ADD COLUMN     "calendarOccurrenceId" TEXT;

-- CreateIndex
CREATE INDEX "CalendarEvent_templateId_idx" ON "CalendarEvent"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "Checklist_calendarOccurrenceId_key" ON "Checklist"("calendarOccurrenceId");

-- AddForeignKey
ALTER TABLE "Checklist" ADD CONSTRAINT "Checklist_calendarOccurrenceId_fkey" FOREIGN KEY ("calendarOccurrenceId") REFERENCES "CalendarOccurrence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
