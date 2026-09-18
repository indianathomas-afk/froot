import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  calendarDenialBody,
  calendarDenialStatus,
  requireCalendar,
} from "@/lib/calendar-access"
import { isSchedulableTemplate, recurrenceForFrequency } from "@/lib/calendar"
import { dayCloseAppliesTo } from "@/lib/checklist-lifecycle"

// GET /api/calendar/schedulable-templates — CAL-2. What the Event tab lists.
//
// The templates that MAY be added to the calendar: non-Daily, active, not
// archived (ruling 1 + R4). A Daily template is absent rather than disabled —
// it already generates, every day, and offering it here would suggest a second
// way to schedule something that has never needed one.
//
// ── WHY THIS IS ITS OWN ROUTE AND NOT A FIELD ON GET /api/calendar/events ────
// That route is `calendar.view` and the month grid polls it on every month
// change and every store switch. This is `calendar.manage` and is read ONCE,
// when a create dialog opens. Folding it in would ship a template list to every
// STORE login on every page of the calendar, for a control none of them can
// see — and would make a read gated on one capability carry data gated on
// another, which is the kind of seam that later gets "simplified" in the wrong
// direction.
//
// STORE SCOPE IS THE EVENT'S, NOT THE READ'S. Applicability here is the
// TEMPLATE's own appliesTo, because that is what ruling 2 says the event
// inherits ("stores follow the template's assignment"). B11's bound on WHO may
// schedule WHERE is enforced on the WRITE, in POST/PATCH /api/calendar/events;
// a list that pre-filtered by the actor's stores would hide a template the
// write would have accepted for the stores they do hold.

export async function GET(req: Request) {
  const access = await requireCalendar("calendar.manage")
  if (!access.ok) {
    return NextResponse.json(calendarDenialBody(access.reason), { status: calendarDenialStatus(access.reason) })
  }

  const { searchParams } = new URL(req.url)
  const storeIdParam = searchParams.get("storeIds")
  const wantedStoreIds = storeIdParam ? storeIdParam.split(",").filter(Boolean) : []

  const templates = await prisma.template.findMany({
    where: { organizationId: access.org.id, isActive: true, isArchived: false },
    select: {
      id: true,
      name: true,
      frequency: true,
      appliesTo: true,
      // Selected although the `where` above already filters on both, so that
      // isSchedulableTemplate() is asked the real row rather than handed two
      // literals the query happens to guarantee. One predicate, one answer,
      // and it stays true if that `where` is ever relaxed.
      isActive: true,
      isArchived: true,
      storeAssignments: { select: { storeId: true } },
      // An ACTIVE event already scheduling this template. Shown so the dialog
      // can say "already scheduled" rather than letting someone create a second
      // rule for the same template and then wonder why two checklists appear.
      calendarEvents: {
        where: { isArchived: false },
        select: { id: true, recurrence: true, startDate: true },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { name: "asc" },
  })

  const items = templates
    .filter((t) => isSchedulableTemplate(t, dayCloseAppliesTo(t.frequency)))
    .filter((t) => {
      if (wantedStoreIds.length === 0) return true
      if (t.appliesTo !== "selected") return true
      return t.storeAssignments.some((a) => wantedStoreIds.includes(a.storeId))
    })
    .map((t) => ({
      id: t.id,
      name: t.name,
      frequency: t.frequency,
      appliesTo: t.appliesTo,
      storeIds: t.storeAssignments.map((a) => a.storeId),
      // Ruling 2: the repeat is PRESET from Template.frequency and the operator
      // may change it. The preset is computed in one place, in src/lib/calendar.
      presetRecurrence: recurrenceForFrequency(t.frequency),
      scheduled: t.calendarEvents.length > 0,
      scheduledEventId: t.calendarEvents[0]?.id ?? null,
    }))

  return NextResponse.json({ templates: items })
}
