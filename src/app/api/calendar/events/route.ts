import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import {
  calendarDenialBody,
  calendarDenialStatus,
  requireCalendar,
  resolveStoreScope,
} from "@/lib/calendar-access"
import {
  CALENDAR_PRIORITIES,
  CALENDAR_RECURRENCES,
  normalizeCategory,
  projectDueDates,
  type ProjectableEvent,
} from "@/lib/calendar"

// CAL-1 — the month grid's read, and the create.
//
// GATE ORDER IS THE SAME IN EVERY FILE UNDER api/calendar: auth → org → MODULE
// → capability → Zod → org-scoped query. requireCalendar() owns the first four;
// the module gate sits ahead of the capability so a disabled org answers 404 to
// everyone, ADMIN included (see calendar-access.ts).
//
// EVERY ROUTE ENFORCES. The nav item and the popover are UX, and PERM-2's whole
// lesson is that a page-level gate over an unguarded route is the defect. The
// modal is not the gate.

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

const createSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    category: z.string().trim().min(1),
    priority: z.enum(CALENDAR_PRIORITIES).default("Standard"),
    recurrence: z.enum(CALENDAR_RECURRENCES).default("None"),
    startDate: z.string().regex(DATE),
    dueTime: z.string().regex(TIME).nullish(),
    endDate: z.string().regex(DATE).nullish(),
    appliesTo: z.enum(["all", "specific"]).default("all"),
    storeIds: z.array(z.string()).default([]),
    notes: z.string().trim().max(5000).nullish(),
    url: z.string().trim().url().max(2000).nullish(),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    message: "endDate cannot be before startDate",
    path: ["endDate"],
  })
  .refine((v) => v.appliesTo === "all" || v.storeIds.length > 0, {
    message: "Pick at least one store, or choose all stores",
    path: ["storeIds"],
  })

/** A calendar date string from a @db.Date column. The column has no time, so
 *  this is a slice and never a timezone conversion — the reason the three date
 *  columns are DATE in the first place (S5-D77). */
function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// GET /api/calendar/events?storeId=&from=&to=
// Returns the events in scope, the dates each one is PROJECTED to fall due in
// the window (ruling 3 — future dates are derived, never stored), and the real
// occurrence rows that exist in that window.
export async function GET(req: Request) {
  const access = await requireCalendar("calendar.view")
  if (!access.ok) return NextResponse.json(calendarDenialBody(access.reason), { status: calendarDenialStatus(access.reason) })

  const { searchParams } = new URL(req.url)
  const from = searchParams.get("from") ?? ""
  const to = searchParams.get("to") ?? ""
  if (!DATE.test(from) || !DATE.test(to) || to < from) {
    return NextResponse.json({ error: "from and to must be YYYY-MM-DD, with to on or after from" }, { status: 400 })
  }

  const orgStores = await prisma.store.findMany({
    where: { organizationId: access.org.id, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })
  // NEVER FROM THE URL: a non-admin asking for a store outside their
  // assignments gets [], not that store (getUserStoreScope()'s contract).
  const storeIds = resolveStoreScope(access, searchParams.get("storeId"), orgStores.map((s) => s.id))
  if (storeIds.length === 0) return NextResponse.json({ stores: orgStores, events: [], occurrences: [] })

  const events = await prisma.calendarEvent.findMany({
    where: {
      organizationId: access.org.id,
      isArchived: false,
      OR: [{ appliesTo: "all" }, { storeAssignments: { some: { storeId: { in: storeIds } } } }],
    },
    include: { storeAssignments: { select: { storeId: true } }, attachment: true },
    orderBy: { createdAt: "asc" },
  })

  const occurrences = await prisma.calendarOccurrence.findMany({
    where: {
      organizationId: access.org.id,
      storeId: { in: storeIds },
      dueDate: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) },
    },
    orderBy: { dueDate: "asc" },
  })

  return NextResponse.json({
    stores: orgStores,
    events: events.map((e) => {
      const projectable: ProjectableEvent = {
        recurrence: e.recurrence,
        startDate: dateStr(e.startDate),
        endDate: e.endDate ? dateStr(e.endDate) : null,
      }
      return {
        id: e.id,
        title: e.title,
        notes: e.notes,
        url: e.url,
        category: e.category,
        priority: e.priority,
        recurrence: e.recurrence,
        startDate: projectable.startDate,
        dueTime: e.dueTime,
        endDate: projectable.endDate,
        appliesTo: e.appliesTo,
        storeIds: e.storeAssignments.map((a) => a.storeId),
        attachment: e.attachment,
        // Ruling 3: projected, not stored.
        projectedDates: projectDueDates(projectable, from, to),
      }
    }),
    occurrences: occurrences.map((o) => ({
      id: o.id,
      eventId: o.eventId,
      storeId: o.storeId,
      dueDate: dateStr(o.dueDate),
      dueAt: o.dueAt.toISOString(),
      status: o.status,
      completedAt: o.completedAt?.toISOString() ?? null,
      notes: o.notes,
      photoUrl: o.photoUrl,
    })),
  })
}

// POST /api/calendar/events — calendar.manage (ruling 5).
export async function POST(req: Request) {
  const access = await requireCalendar("calendar.manage")
  if (!access.ok) return NextResponse.json(calendarDenialBody(access.reason), { status: calendarDenialStatus(access.reason) })

  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.issues }, { status: 400 })
  }
  const body = parsed.data

  // REJECTS BY NAME rather than folding an unknown value to "other" — a
  // mis-stored category would render in the wrong colour forever and nothing
  // would ever look wrong.
  const category = normalizeCategory(body.category)
  if (!category) return NextResponse.json({ error: `Unknown category: ${body.category}` }, { status: 400 })

  // Every named store must be in THIS org. Ruling 2: every occurrence belongs
  // to exactly one store, and an id from another tenant would fan out there.
  let storeIds: string[] = []
  if (body.appliesTo === "specific") {
    const owned = await prisma.store.findMany({
      where: { id: { in: body.storeIds }, organizationId: access.org.id },
      select: { id: true },
    })
    if (owned.length !== body.storeIds.length) {
      return NextResponse.json({ error: "One or more stores are not in this organization" }, { status: 400 })
    }
    storeIds = owned.map((s) => s.id)
  }

  const event = await prisma.calendarEvent.create({
    data: {
      organizationId: access.org.id,
      title: body.title,
      notes: body.notes ?? null,
      url: body.url ?? null,
      category,
      priority: body.priority,
      recurrence: body.recurrence,
      startDate: new Date(`${body.startDate}T00:00:00.000Z`),
      dueTime: body.dueTime ?? null,
      endDate: body.endDate ? new Date(`${body.endDate}T00:00:00.000Z`) : null,
      appliesTo: body.appliesTo,
      createdByUserId: access.dbUserId,
      ...(storeIds.length > 0 ? { storeAssignments: { create: storeIds.map((storeId) => ({ storeId })) } } : {}),
    },
    include: { storeAssignments: { select: { storeId: true } } },
  })

  // NOT MATERIALISED HERE. The cron owns every occurrence write (ruling 3), so
  // there is exactly one author and the "one open occurrence per event per
  // store" invariant has one place to be enforced. A reminder created for today
  // appears on the grid immediately as a PROJECTED date and gains its row on
  // the next hourly run.
  return NextResponse.json(event, { status: 201 })
}
