// ─────────────────────────────────────────────────────────────────────────────
// CAL-2b — S5-D78's "started" rule, in ONE place, for every path that deletes
// an Open calendar occurrence.
//
// WHY THIS FILE EXISTS. CAL-2 gave an Open occurrence a Checklist. CAL-2's
// PATCH re-derive learned what that costs (deviation S5-D78) and handled it
// inline; the two ARCHIVE paths did not, and the FK's `onDelete: SetNull` — the
// safety net, never the policy — quietly turned every deleted occurrence into
// an unlinked, never-started, Pending checklist that day close then skips as
// `frequencyExcluded`. Observed on staging 2026-09-18: archiving one event left
// 12 of them. That is DEBT-61's litter, recreated by the feature that closed
// DEBT-61.
//
// So the rule is extracted rather than copied a third and fourth time. THE
// DEFINITION OF "STARTED" IS THE THING THAT MUST NOT FORK: if two paths
// disagree about whether somebody has begun the work, one of them deletes
// a checklist with task logs on it.
// ─────────────────────────────────────────────────────────────────────────────

import type { Prisma } from "@prisma/client"

/** The SELECT `isStarted()` reads. Exported with the predicate so a caller
 *  cannot fetch a narrower row and silently make every occurrence unstarted. */
export const STARTED_SELECT = {
  id: true,
  checklist: { select: { id: true, _count: { select: { taskLogs: true } } } },
} satisfies Prisma.CalendarOccurrenceSelect

export type OccurrenceWithChecklist = {
  id: string
  checklist: { id: string; _count: { taskLogs: number } } | null
}

/**
 * S5-D78's definition of STARTED WORK, and the only one.
 *
 * A TaskLog row is somebody standing in a store ticking something off. One is
 * enough: the row is the evidence, and there is no smaller unit of "begun".
 * A checklist with none has recorded nothing, so deleting it destroys nothing —
 * which is the whole reason the unstarted half can be cleaned up at all.
 *
 * An occurrence with NO checklist is a plain reminder and is never "started";
 * it has nothing to clean up either way.
 */
export function isStarted(o: OccurrenceWithChecklist): boolean {
  return (o.checklist?._count.taskLogs ?? 0) > 0
}

/** What a cascade did, so the route can report it and a staging run can be
 *  read from the response rather than from SQL. */
export type OccurrenceCleanupReport = {
  occurrencesDeleted: number
  checklistsDeleted: number
  checklistsKept: number
}

/**
 * DELETE EVERY Open OCCURRENCE MATCHING `where`, TAKING THE UNSTARTED
 * CHECKLISTS WITH THEM.
 *
 * This is the ARCHIVE shape of the rule, and it differs from PATCH's on
 * purpose. PATCH re-derives a schedule, so it KEEPS a started occurrence — the
 * date still has to happen. An archive is TERMINAL (ruling 6): every Open
 * occurrence goes, started or not, because the schedule itself is being
 * retired. What S5-D78 decides here is only the fate of the CHECKLIST:
 *
 *   unstarted → deleted with the occurrence. Nothing was recorded, and leaving
 *               it behind is the DEBT-61 litter this phase exists to stop.
 *   started    → KEPT, and unlinked by the FK's SetNull. It carries work that
 *               happened, and retiring a schedule cannot unmake it. It becomes
 *               an untracked checklist, which is the deliberate trade CAL-2
 *               already wrote down at DELETE /api/calendar/events/[id] — now
 *               narrowed from "every checklist" to "the ones somebody started".
 *
 * MUST RUN INSIDE THE CALLER'S TRANSACTION. The read and the two deletes are
 * one decision; split across transactions, a task log written between them
 * would be deleted by a predicate that no longer holds.
 */
export async function deleteOpenOccurrencesWithCleanup(
  tx: Prisma.TransactionClient,
  where: Prisma.CalendarOccurrenceWhereInput
): Promise<OccurrenceCleanupReport> {
  const open = await tx.calendarOccurrence.findMany({
    where: { ...where, status: "Open" },
    select: STARTED_SELECT,
  })
  if (open.length === 0) {
    return { occurrencesDeleted: 0, checklistsDeleted: 0, checklistsKept: 0 }
  }

  const droppableChecklistIds = open
    .filter((o) => !isStarted(o))
    .map((o) => o.checklist?.id)
    .filter((v): v is string => !!v)

  if (droppableChecklistIds.length > 0) {
    await tx.checklist.deleteMany({ where: { id: { in: droppableChecklistIds } } })
  }
  // AFTER the checklists, so the rows are already gone rather than SetNulled on
  // the way past. Same net state either way; this order means an interrupted
  // transaction can only ever roll back, never leave a half-cleaned link.
  await tx.calendarOccurrence.deleteMany({ where: { id: { in: open.map((o) => o.id) } } })

  return {
    occurrencesDeleted: open.length,
    checklistsDeleted: droppableChecklistIds.length,
    checklistsKept: open.filter(isStarted).length,
  }
}
