import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import {
  calendarDenialBody,
  calendarDenialStatus,
  requireCalendar,
  resolveEventStoreWrite,
} from "@/lib/calendar-access"
import { CALENDAR_PRIORITIES, CALENDAR_RECURRENCES, normalizeCategory } from "@/lib/calendar"

// CAL-1 — edit and archive. Both are calendar.manage (ruling 5).

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  category: z.string().trim().min(1).optional(),
  priority: z.enum(CALENDAR_PRIORITIES).optional(),
  recurrence: z.enum(CALENDAR_RECURRENCES).optional(),
  startDate: z.string().regex(DATE).optional(),
  dueTime: z.string().regex(TIME).nullish(),
  endDate: z.string().regex(DATE).nullish(),
  appliesTo: z.enum(["all", "specific"]).optional(),
  storeIds: z.array(z.string()).optional(),
  notes: z.string().trim().max(5000).nullish(),
  url: z.string().trim().url().max(2000).nullish(),
})

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireCalendar("calendar.manage")
  if (!access.ok) return NextResponse.json(calendarDenialBody(access.reason), { status: calendarDenialStatus(access.reason) })

  const { id } = await params
  const existing = await prisma.calendarEvent.findFirst({
    where: { id, organizationId: access.org.id },
    include: { storeAssignments: { select: { storeId: true } } },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.issues }, { status: 400 })
  }
  const body = parsed.data

  let category: string | undefined
  if (body.category !== undefined) {
    const normalized = normalizeCategory(body.category)
    if (!normalized) return NextResponse.json({ error: `Unknown category: ${body.category}` }, { status: 400 })
    category = normalized
  }

  const nextStartDate = body.startDate ?? dateStr(existing.startDate)
  const nextEndDate =
    body.endDate === undefined ? (existing.endDate ? dateStr(existing.endDate) : null) : body.endDate ?? null
  if (nextEndDate && nextEndDate < nextStartDate) {
    return NextResponse.json({ error: "endDate cannot be before startDate" }, { status: 400 })
  }

  // ── CAL-2, B11 — THE SAME BOUND AS POST, AND IT MUST BE HERE TOO ────────────
  // A rule applied only at create is a rule anyone can step around with one
  // edit. resolveEventStoreWrite() is the single expression of it: ADMIN
  // org-wide, non-ADMIN bounded to their assignments, and a non-ADMIN's "All
  // stores" RESOLVED to an explicit list so the bound lives on the row.
  let nextAppliesTo = body.appliesTo ?? existing.appliesTo
  let nextStoreIds: string[] | undefined
  if (body.storeIds !== undefined || body.appliesTo !== undefined) {
    const requested =
      nextAppliesTo === "specific"
        ? body.storeIds ?? existing.storeAssignments.map((a) => a.storeId)
        : []
    if (nextAppliesTo === "specific" && requested.length === 0) {
      return NextResponse.json({ error: "Pick at least one store, or choose all stores" }, { status: 400 })
    }
    const orgStoreIds = (
      await prisma.store.findMany({ where: { organizationId: access.org.id }, select: { id: true } })
    ).map((st) => st.id)
    const scoped = resolveEventStoreWrite(access, nextAppliesTo, requested, orgStoreIds)
    if (!scoped) {
      return NextResponse.json(
        { error: "One or more of those stores is not one you can schedule for" },
        { status: 403 }
      )
    }
    nextAppliesTo = scoped.appliesTo
    nextStoreIds = scoped.storeIds
  }

  // ── THE RE-DERIVE PREDICATE ────────────────────────────────────────────────
  // Computed from the PARSED BODY AGAINST THE LOADED ROW, never from which keys
  // the client happened to send. A client that PATCHes `recurrence: "Weekly"`
  // onto an event that is already Weekly has changed nothing and must not lose
  // its open occurrences; one that renames the event has changed nothing about
  // the schedule either.
  const priorStoreIds = [...existing.storeAssignments.map((a) => a.storeId)].sort()
  const scheduleChanged =
    nextStartDate !== dateStr(existing.startDate) ||
    nextEndDate !== (existing.endDate ? dateStr(existing.endDate) : null) ||
    (body.recurrence !== undefined && body.recurrence !== existing.recurrence) ||
    (body.dueTime !== undefined && (body.dueTime ?? null) !== existing.dueTime) ||
    nextAppliesTo !== existing.appliesTo ||
    (nextStoreIds !== undefined && JSON.stringify([...nextStoreIds].sort()) !== JSON.stringify(priorStoreIds))

  // Reported back so the detail view can say "one in-progress checklist kept"
  // rather than leaving the operator to wonder why one date did not move.
  let keptStarted = 0

  const updated = await prisma.$transaction(async (tx) => {
    const event = await tx.calendarEvent.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(category !== undefined ? { category } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.recurrence !== undefined ? { recurrence: body.recurrence } : {}),
        ...(body.startDate !== undefined ? { startDate: new Date(`${body.startDate}T00:00:00.000Z`) } : {}),
        ...(body.dueTime !== undefined ? { dueTime: body.dueTime ?? null } : {}),
        ...(body.endDate !== undefined
          ? { endDate: body.endDate ? new Date(`${body.endDate}T00:00:00.000Z`) : null }
          : {}),
        // B11: nextAppliesTo, not body.appliesTo — a non-ADMIN's "all" has been
        // resolved to "specific" above and the stored value must carry that.
        ...(body.appliesTo !== undefined ? { appliesTo: nextAppliesTo } : {}),
        ...(body.notes !== undefined ? { notes: body.notes ?? null } : {}),
        ...(body.url !== undefined ? { url: body.url ?? null } : {}),
      },
    })

    if (nextStoreIds !== undefined) {
      await tx.calendarEventStoreAssignment.deleteMany({ where: { eventId: id } })
      if (nextStoreIds.length > 0) {
        await tx.calendarEventStoreAssignment.createMany({
          data: nextStoreIds.map((storeId) => ({ eventId: id, storeId })),
        })
      }
    }

    // OPEN OCCURRENCES ARE DELETED AND THE NEXT CRON RE-DERIVES THEM.
    // COMPLETED ROWS ARE NEVER TOUCHED — they record work that happened, and no
    // edit to a schedule can unmake it. This is also why the cron reads the
    // latest terminal dueDate rather than counting rows: deleting the open one
    // leaves the completion history intact and the next date still correct.
    //
    // ── CAL-2 — AND NEITHER IS AN OCCURRENCE WHOSE CHECKLIST SOMEBODY STARTED
    // A reminder's Open occurrence is a row with nothing in it, so dropping it
    // costs nobody anything. A SCHEDULED one owns a Checklist, and that
    // checklist may already have task logs against it — somebody is standing in
    // a store part-way through the work. Deleting the occurrence would
    // SetNull the link (the FK safety net) and strand their half-done checklist
    // as untracked litter, which is the exact thing DEBT-61 is about and the
    // exact thing this phase closed.
    //
    // So: started scheduled occurrences are KEPT and reported, and the cron
    // picks the new schedule up once they reach a terminal state. Unstarted
    // ones go, and their checklist goes with them — nothing was lost, and
    // leaving an unstarted checklist behind would be litter of a new kind.
    if (scheduleChanged) {
      const open = await tx.calendarOccurrence.findMany({
        where: { eventId: id, status: "Open" },
        select: { id: true, checklist: { select: { id: true, _count: { select: { taskLogs: true } } } } },
      })
      const started = open.filter((o) => (o.checklist?._count.taskLogs ?? 0) > 0)
      const droppable = open.filter((o) => (o.checklist?._count.taskLogs ?? 0) === 0)

      keptStarted = started.length

      if (droppable.length > 0) {
        const checklistIds = droppable.map((o) => o.checklist?.id).filter((v): v is string => !!v)
        if (checklistIds.length > 0) {
          await tx.checklist.deleteMany({ where: { id: { in: checklistIds } } })
        }
        await tx.calendarOccurrence.deleteMany({ where: { id: { in: droppable.map((o) => o.id) } } })
      }
    }

    return event
  })

  return NextResponse.json({ ...updated, reDerived: scheduleChanged, keptStarted })
}

// DELETE = ARCHIVE, preserve-and-mark. The event's Open occurrences go with it
// — an archived reminder must stop appearing in the banner immediately rather
// than waiting for someone to complete work that is no longer wanted. Completed
// rows stay, so the history of what was done survives the archive.
//
// ── CAL-2, RULING 6 — ARCHIVING A TEMPLATE-BACKED EVENT DOES NOT ARCHIVE THE
// TEMPLATE ───────────────────────────────────────────────────────────────────
// "Stop scheduling this" is not "retire this template", and the calendar does
// not get to make that decision on an operator's behalf. The cascade runs the
// OTHER way only: archiving a TEMPLATE archives its events (see
// api/templates/archive-cascade.ts).
//
// THE CHECKLISTS ALREADY GENERATED ARE LEFT ALONE, including an Open
// occurrence's, which SetNulls its link as the row is deleted. That is the one
// place this phase knowingly produces an untracked checklist, and it is the
// right trade: somebody may be part-way through it, and deleting work because a
// schedule was retired is worse than leaving a row day close will no longer
// judge. It is a hand-archived event, not a cron path, so it is a deliberate
// act with a person behind it.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireCalendar("calendar.manage")
  if (!access.ok) return NextResponse.json(calendarDenialBody(access.reason), { status: calendarDenialStatus(access.reason) })

  const { id } = await params
  const existing = await prisma.calendarEvent.findFirst({
    where: { id, organizationId: access.org.id },
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.$transaction([
    prisma.calendarEvent.update({ where: { id }, data: { isArchived: true } }),
    prisma.calendarOccurrence.deleteMany({ where: { eventId: id, status: "Open" } }),
  ])

  return NextResponse.json({ success: true })
}
