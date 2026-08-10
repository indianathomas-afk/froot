import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { businessDayWindow } from "@/lib/reports"
import {
  checklistState,
  expectedWindow,
  hoursForDate,
  type ChecklistState,
} from "@/lib/checklist-lifecycle"
import { frozenWindow } from "@/lib/checklist-status-display"
import { NextResponse } from "next/server"

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: storeId } = await params
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  // CHK-4: `hours` comes along for the expected-window computation below. This
  // is the store the crew is standing in; its own StoreHours are what anchor
  // every offset on the page.
  const store = await prisma.store.findFirst({
    where: { id: storeId, organizationId: org.id },
    include: { hours: { select: { dayOfWeek: true, openingTime: true, closingTime: true, isClosed: true } } },
  })
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  const { isAdmin, storeIds } = await getUserStoreScope()
  if (!isAdmin && !storeIds.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const templates = await prisma.template.findMany({
    where: { organizationId: org.id, isActive: true, isArchived: false },
    include: {
      tasks: true,
      storeAssignments: true,
      templateType: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  })

  // Filter: "all" → show for every store; "selected" → only if this store is in storeAssignments
  const applicable = templates.filter((t) => {
    if (t.appliesTo === "selected") {
      return t.storeAssignments.some((a) => a.storeId === storeId)
    }
    return true // "all" or legacy rows with no appliesTo set
  })

  // Check which ones already have a checklist started today — "today" is the
  // store's local business day, not the server (UTC) day.
  const w = businessDayWindow(new Date(), store.timezone)

  const existingToday = await prisma.checklist.findMany({
    where: {
      organizationId: org.id,
      storeId,
      date: { gte: w.gte, lt: w.lt },
    },
    // CHK-4: the four lifecycle columns join the select. `closedAt` decides
    // missed, `completedLate` decides the late badge, and the two expectations
    // are the window this row was judged against.
    select: {
      id: true,
      templateId: true,
      status: true,
      closedAt: true,
      completedLate: true,
      expectedStartAt: true,
      expectedEndAt: true,
    },
  })

  const existingMap = new Map(existingToday.map((c) => [c.templateId, c]))

  // CHK-4. THE CREW'S LIST GAINS A LIVE STATE, computed here rather than in the
  // client, because the store's hours and the template's offsets are both
  // server-side facts and the predicates are the lib's.
  //
  // WHICH WINDOW: a template that HAS a row today is judged against the window
  // frozen on that row; a template with NO row is judged against the window
  // computed for today from this store's hours. That rule and its reasons are
  // stated once, in src/lib/checklist-status-display.ts. The second half is the
  // load-bearing one here and it is the whole DEBT-48 scenario — the 11am
  // employee must see "Opening — Overdue" for a checklist that does not exist
  // as a row yet, which is exactly the case plan §0 finding 1 is about.
  const now = new Date()
  const hoursRow = hoursForDate(store.hours, w.day)

  const result = applicable.map((t) => {
    const existing = existingMap.get(t.id)
    const window = existing ? frozenWindow(existing) : expectedWindow(t, hoursRow, w.day, store.timezone)
    // A template with no row has nothing started and nothing closed. Standing
    // in a Pending shape for it is what lets one predicate answer for both
    // cases; it is not written anywhere.
    const state: ChecklistState = checklistState(
      existing ?? { status: "Pending", closedAt: null, completedLate: false },
      window,
      now
    )
    return {
      id: t.id,
      name: t.name,
      // TPL-2 step (2): `type` is declared on TemplateOption
      // (store-view-client.tsx) and rendered nowhere, so nothing on screen
      // changes here. Migrated rather than deleted (Gary, Q3) — the key name is
      // unchanged and only its source moved to the joined row, which keeps it
      // correct instead of stale after a rename. Deleting it would mean editing
      // TemplateOption too, for no caller's benefit; that is step (3)'s call.
      type: t.templateType?.name ?? t.type,
      taskCount: t.tasks.length,
      estimatedMinutes: Math.round(t.tasks.reduce((sum, task) => sum + (task.estimatedTimeMinutes ?? 0), 0)),
      existingChecklistId: existing?.id ?? null,
      existingStatus: existing?.status ?? null,
      // CHK-4: the derived state, and the window end so the card can say WHEN
      // it was expected rather than only that it is late. Serialised as ISO by
      // NextResponse.json; the client formats it in the store's zone.
      lifecycleState: state,
      expectedEndAt: window?.end?.toISOString() ?? null,
      completedLate: existing?.completedLate ?? false,
      timeZone: store.timezone,
    }
  })

  // CHK-4 — MISSED LEAVES THE CREW'S WORKING LIST (Gary's R1: a closed fact,
  // NOT actionable). Filtered HERE, on the server, rather than hidden in the
  // client: a card the crew cannot act on should not cross the wire, and the
  // "Continue Checklist" button on one would lead straight to a 409 from
  // task-log.
  //
  // THIS IS A GUARANTEE, NOT A FILTER THAT FIRES TODAY, and the difference is
  // worth writing down rather than discovering. This list is scoped to the
  // store's CURRENT business day (`businessDayWindow` above) and the day-close
  // job never closes today — its lookback is yesterday and the day before
  // (api/cron/checklist-day-close/route.ts). `closedAt` has no other writer. So
  // no row reachable here can be Missed, and R1 is satisfied structurally
  // already. The filter states the rule anyway, so that a future change to
  // either scope cannot silently put an unactionable card in front of a crew.
  //
  // WHICH LISTS DO RETAIN MISSED: /checklists (admin, own pill), the execution
  // page (read-only, reachable by direct link), and the print sheet (stamped).
  // CHK-5's /reports/operations is the surface that will actually REPORT them.
  return NextResponse.json(result.filter((r) => r.lifecycleState !== "missed"))
}
