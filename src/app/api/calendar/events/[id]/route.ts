import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { calendarDenialBody, calendarDenialStatus, requireCalendar } from "@/lib/calendar-access"
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

  const nextAppliesTo = body.appliesTo ?? existing.appliesTo
  let nextStoreIds: string[] | undefined
  if (body.storeIds !== undefined || body.appliesTo !== undefined) {
    if (nextAppliesTo === "specific") {
      const requested = body.storeIds ?? existing.storeAssignments.map((a) => a.storeId)
      if (requested.length === 0) {
        return NextResponse.json({ error: "Pick at least one store, or choose all stores" }, { status: 400 })
      }
      const owned = await prisma.store.findMany({
        where: { id: { in: requested }, organizationId: access.org.id },
        select: { id: true },
      })
      if (owned.length !== requested.length) {
        return NextResponse.json({ error: "One or more stores are not in this organization" }, { status: 400 })
      }
      nextStoreIds = owned.map((s) => s.id)
    } else {
      nextStoreIds = []
    }
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
        ...(body.appliesTo !== undefined ? { appliesTo: body.appliesTo } : {}),
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
    // latest COMPLETED dueDate rather than counting rows: deleting the open one
    // leaves the completion history intact and the next date still correct.
    if (scheduleChanged) {
      await tx.calendarOccurrence.deleteMany({ where: { eventId: id, status: "Open" } })
    }

    return event
  })

  return NextResponse.json({ ...updated, reDerived: scheduleChanged })
}

// DELETE = ARCHIVE, preserve-and-mark. The event's Open occurrences go with it
// — an archived reminder must stop appearing in the banner immediately rather
// than waiting for someone to complete work that is no longer wanted. Completed
// rows stay, so the history of what was done survives the archive.
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
