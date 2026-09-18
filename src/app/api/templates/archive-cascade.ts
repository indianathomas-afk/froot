import { prisma } from "@/lib/prisma"

// CAL-2 — RULING 6, AS REWORDED BY R4 (Gary, 2026-09-18).
//
// ARCHIVING A TEMPLATE ARCHIVES ITS CALENDAR EVENTS AND DELETES THEIR OPEN
// OCCURRENCES. Deactivating one does not: `isActive = false` is REVERSIBLE, the
// materialise cron skips an inactive template's events and reports
// `skippedInactiveTemplate`, nothing is archived or deleted, and reactivation
// resumes generation on the next run. Two controls, two behaviours.
//
// ── WHY THIS IS A SHARED FUNCTION AND NOT TWO COPIES ─────────────────────────
// THERE ARE TWO ARCHIVE SITES AND THE SECOND ONE IS EASY TO MISS. The template
// form archives one template through PATCH /api/templates/[id]; the /templates
// grid's bulk bar archives several through PATCH /api/templates — a DIFFERENT
// ROUTE FILE, reached from a different control, writing the same column with
// updateMany. A cascade added to only the first would be correct for the button
// nobody uses in bulk and absent for the one they do.
//
// This is CLAUDE.md § "Verifying a guard covers every path" at write time
// rather than at audit time: the sites were found by following the CALLERS of
// the archive control, not by grepping for the word "archive". DEBT-65 is the
// same lesson on the same column — two writers, one flag each, and a fix aimed
// at the wrong one.
//
// COMPLETED OCCURRENCES ARE NEVER TOUCHED, and neither are the Checklists any
// occurrence created. They record work that happened, and archiving a
// DEFINITION cannot unmake it — the same rule DELETE /api/calendar/events/[id]
// already follows for an event archived on its own.
//
// UN-ARCHIVING DOES NOT REVERSE THIS, and there is deliberately no function for
// it. The Open occurrences are deleted, not flagged, so restoring the events
// would restore a schedule with a hole in it. The archive was a decision;
// undoing it means adding the template to the calendar again, which is one
// click and is honest about what it is doing.

/** Archive every calendar event for these templates and drop their Open
 *  occurrences. Call INSIDE the same transaction as the template write, so a
 *  template can never be archived with its events left live. */
export function archiveCalendarEventsForTemplates(
  orgId: string,
  templateIds: string[]
) {
  return [
    prisma.calendarEvent.updateMany({
      where: { templateId: { in: templateIds }, organizationId: orgId, isArchived: false },
      data: { isArchived: true },
    }),
    prisma.calendarOccurrence.deleteMany({
      where: {
        organizationId: orgId,
        status: "Open",
        event: { templateId: { in: templateIds } },
      },
    }),
  ]
}
