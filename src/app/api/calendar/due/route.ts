import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  calendarDenialBody,
  calendarDenialStatus,
  requireCalendar,
  resolveStoreScope,
} from "@/lib/calendar-access"
import { categoryLabel, daysOverdue } from "@/lib/calendar"
import { localDateStr } from "@/lib/reports"

// GET /api/calendar/due?storeId= — THE BANNER FEED (B7).
//
// Open occurrences whose dueDate is today or earlier, store-scoped to the
// actor. Returns the earliest dueAt so the banner can say "N days overdue"
// without every caller re-deriving it.
//
// WHY dueDate <= today AND NOT dueAt <= now. A reminder due today is worth
// showing from the moment the day starts — the floor needs to see it while
// there is still time to do it, which is the entire point of the banner. `dueAt`
// is what decides OVERDUE (ruling 8), not what decides visible. The two are
// different questions and conflating them would mean a reminder due today only
// appeared after it was already late.

export async function GET(req: Request) {
  const access = await requireCalendar("calendar.view")
  if (!access.ok) return NextResponse.json(calendarDenialBody(access.reason), { status: calendarDenialStatus(access.reason) })

  const { searchParams } = new URL(req.url)
  const orgStores = await prisma.store.findMany({
    where: { organizationId: access.org.id, isActive: true },
    select: { id: true, name: true, timezone: true },
  })
  const storeIds = resolveStoreScope(access, searchParams.get("storeId"), orgStores.map((s) => s.id))
  if (storeIds.length === 0) return NextResponse.json({ items: [], earliestDueAt: null, overdueCount: 0, maxDaysOverdue: 0 })

  const now = new Date()
  // TODAY IS PER STORE, not per server. Stores can sit in different zones, and
  // "due today" has to mean today where the work is. The widest store-local
  // today across the scope is the cutoff — narrower would hide a reminder from
  // a store whose day has already started.
  const scoped = orgStores.filter((s) => storeIds.includes(s.id))
  const cutoff = scoped.reduce((latest, s) => {
    const d = localDateStr(now, s.timezone)
    return d > latest ? d : latest
  }, localDateStr(now, scoped[0]?.timezone ?? "America/Los_Angeles"))

  const rows = await prisma.calendarOccurrence.findMany({
    where: {
      organizationId: access.org.id,
      storeId: { in: storeIds },
      status: "Open",
      dueDate: { lte: new Date(`${cutoff}T00:00:00.000Z`) },
      event: { isArchived: false },
    },
    include: {
      event: { select: { title: true, category: true, priority: true } },
      store: { select: { name: true, timezone: true } },
    },
    orderBy: { dueAt: "asc" },
  })

  const items = rows.map((o) => ({
    id: o.id,
    title: o.event.title,
    category: o.event.category,
    categoryLabel: categoryLabel(o.event.category),
    priority: o.event.priority,
    storeId: o.storeId,
    storeName: o.store.name,
    timeZone: o.store.timezone,
    dueDate: o.dueDate.toISOString().slice(0, 10),
    dueAt: o.dueAt.toISOString(),
    daysOverdue: daysOverdue(o.dueAt, now),
  }))

  const overdue = items.filter((i) => i.dueAt <= now.toISOString())
  return NextResponse.json({
    items,
    // Ordered by dueAt ascending, so the head IS the earliest.
    earliestDueAt: items[0]?.dueAt ?? null,
    overdueCount: overdue.length,
    maxDaysOverdue: items.reduce((n, i) => (i.daysOverdue > n ? i.daysOverdue : n), 0),
  })
}
