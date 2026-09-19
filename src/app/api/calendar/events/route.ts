import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import {
  calendarDenialBody,
  calendarDenialStatus,
  requireCalendar,
  resolveEventStoreWrite,
  resolveStoreScope,
} from "@/lib/calendar-access"
import {
  CALENDAR_PRIORITIES,
  CALENDAR_RECURRENCES,
  isSchedulableTemplate,
  normalizeCategory,
  projectDueDates,
  type ProjectableEvent,
} from "@/lib/calendar"
import { dayCloseAppliesTo } from "@/lib/checklist-lifecycle"

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
    // CAL-2. Present makes this a SCHEDULED TEMPLATE (ruling 1); absent leaves
    // it a CAL-1 reminder. Validated against the org's templates below — never
    // trusted, because an id from another tenant would schedule their work here.
    templateId: z.string().nullish(),
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
    include: {
      storeAssignments: { select: { storeId: true } },
      attachment: true,
      // CAL-2: null for a reminder. The grid needs the NAME for the chip and
      // the detail dialog, and `templateId` alone to decide which controls to
      // render at all.
      template: { select: { id: true, name: true, frequency: true } },
    },
    orderBy: { createdAt: "asc" },
  })

  const occurrences = await prisma.calendarOccurrence.findMany({
    include: {
      // CAL-2: where "Open checklist" points. Null on a reminder, and null on a
      // scheduled occurrence only if a path nobody anticipated unlinked it —
      // the client renders the absence rather than a dead button.
      checklist: { select: { id: true, status: true, closedAt: true } },
    },
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
        // CAL-2. THE ONE FIELD THAT DECIDES WHICH ENTITY TYPE THIS IS (ruling
        // 1) — null is a reminder, set is a scheduled template. Every client
        // branch reads this and not the presence of a name.
        templateId: e.templateId,
        templateName: e.template?.name ?? null,
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
      // CAL-2. `missedAt` is the linked checklist's closedAt — R2's "Missed
      // uses day-close closedAt" read literally. There is no missedAt column,
      // deliberately: day close already owns that instant and a second copy
      // would give one fact two authors.
      checklistId: o.checklist?.id ?? null,
      checklistStatus: o.checklist?.status ?? null,
      missedAt: o.status === "Missed" ? o.checklist?.closedAt?.toISOString() ?? null : null,
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

  // ── CAL-2, B11 (Gary, 2026-09-18) — THE STORE SET IS BOUNDED FOR A NON-ADMIN
  // Ruling 2's "every occurrence belongs to exactly one store" still holds; what
  // B11 adds is WHICH stores a given actor may write. ADMIN is org-wide as
  // before; a MANAGER holding the calendar.manage grant is bounded to their own
  // assignments, and their "All stores" is RESOLVED HERE into an explicit list
  // so the bound lives on the row rather than on the session. The reasoning is
  // at resolveEventStoreWrite() in src/lib/calendar-access.ts.
  //
  // ONE RULE, BOTH ENTITY TYPES — this runs before anything looks at templateId.
  const orgStoreIds = (
    await prisma.store.findMany({ where: { organizationId: access.org.id }, select: { id: true } })
  ).map((s) => s.id)

  const scoped = resolveEventStoreWrite(access, body.appliesTo, body.storeIds, orgStoreIds)
  if (!scoped) {
    return NextResponse.json(
      { error: "One or more of those stores is not one you can schedule for" },
      { status: 403 }
    )
  }
  const { appliesTo, storeIds } = scoped

  // ── CAL-2 — THE TEMPLATE, IF THIS IS A SCHEDULED EVENT (ruling 1) ───────────
  // Scoped to the org, and required to be SCHEDULABLE: non-Daily, active, not
  // archived. A Daily template is refused rather than accepted-and-ignored —
  // ruling 1 says a Daily template generates the way it always has, so an event
  // pointing at one would create a second generation path for it, which is the
  // duplicate-row problem nobody wants to debug later.
  let templateId: string | null = null
  if (body.templateId) {
    const template = await prisma.template.findFirst({
      where: { id: body.templateId, organizationId: access.org.id },
      select: { id: true, frequency: true, isActive: true, isArchived: true },
    })
    if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 })
    if (!isSchedulableTemplate(template, dayCloseAppliesTo(template.frequency))) {
      return NextResponse.json(
        { error: "Only an active weekly or monthly template can be added to the calendar." },
        { status: 400 }
      )
    }
    templateId = template.id
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
      appliesTo,
      templateId,
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
