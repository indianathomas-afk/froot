import { prisma } from "@/lib/prisma"
import { tasksForChecklist } from "@/lib/checklist-tasks"
import { groupTasksBySection } from "@/lib/sections"
import { businessDayWindow, dashboardHeaderDate, localDateStr } from "@/lib/reports"

// TAB-1 — the item lists behind the tablet Tasks panel. READ-ONLY.
// TAB-1b adds each store's picker names (still read-only, still no route).
//
// WHY THIS IS A SERVER READ AND NOT AN API CALL. No existing route returns a
// checklist's tasks grouped by section with their logs — the execution page
// (store-view/checklist/[id]/page.tsx) reads them server-side too — and TAB-1
// adds no API routes. So /dashboard loads today's rows here, for every store
// this login can see, and the client picks the selected store's. WHICH
// checklists a store has today still comes from GET /api/stores/[id]/templates
// (the Start Daily Checklist list); this only supplies the items of rows that
// already exist, joined to that list by checklist id.
//
// Every task filter is the one the other checklist surfaces apply: TPL-3's
// tasksForChecklist (src/lib/checklist-tasks.ts), the per-store excludedStoreIds
// skip /api/dashboard/summary applies, and CHK-1's section grouping with the
// as-executed snapshot (src/lib/sections.ts).

export type TabletTask = {
  id: string
  label: string
  requiresTemp: boolean
  isCritical: boolean
  done: boolean
  value: number | null
}

export type TabletChecklist = {
  id: string
  storeId: string
  name: string
  status: string
  completedAt: string | null
  sections: { key: string; name: string; tasks: TabletTask[] }[]
}

/** TAB-1b — one name on the "Who's completing these?" sheet.
 *  TAB-4: `hasPin` (from pinSetAt — never the hash, which nothing but the
 *  verify route reads) greys out a no-PIN name while PINs are required. */
export type TabletStaff = { id: string; displayName: string; hasPin: boolean }

export type TabletStore = {
  id: string
  name: string
  timezone: string
  headerDate: string
  /** TAB-5 — the store-local business day this render called "today"
   *  (YYYY-MM-DD, businessDayWindow's `day`, the same instant as headerDate
   *  and as the checklist query above). The tablet's refresh controller shows
   *  this day until the server's answer moves on (ruling 2). */
  day: string
  /** TAB-1b — the desktop picker's staff list for this store, same query. */
  staff: TabletStaff[]
}

export async function loadTabletData(
  organizationId: string,
  stores: { id: string; name: string; timezone: string }[]
): Promise<{ stores: TabletStore[]; checklists: TabletChecklist[] }> {
  const now = new Date()
  const byTz = new Map<string, string[]>()
  for (const s of stores) byTz.set(s.timezone, [...(byTz.get(s.timezone) ?? []), s.id])

  // "Today" is each store's local business day, never the server's UTC day —
  // the same OR-by-timezone shape GET /api/checklists?today=1 uses.
  const rows = stores.length
    ? await prisma.checklist.findMany({
        where: {
          organizationId,
          OR: [...byTz.entries()].map(([tz, ids]) => {
            const w = businessDayWindow(now, tz)
            return { storeId: { in: ids }, date: { gte: w.gte, lt: w.lt } }
          }),
        },
        select: {
          id: true,
          storeId: true,
          status: true,
          completedAt: true,
          closedAt: true,
          sectionsSnapshot: true,
          template: {
            select: {
              name: true,
              tasks: {
                orderBy: { orderIndex: "asc" },
                select: {
                  id: true,
                  description: true,
                  requiresTemp: true,
                  isCritical: true,
                  retiredAt: true,
                  excludedStoreIds: true,
                  sectionId: true,
                  sectionName: true,
                  section: { select: { name: true, sortOrder: true } },
                },
              },
            },
          },
          taskLogs: { select: { taskId: true, temperatureValue: true } },
        },
      })
    : []

  const checklists: TabletChecklist[] = rows.map((c) => {
    const logs = new Map(c.taskLogs.map((l) => [l.taskId, l]))
    const tasks = tasksForChecklist(c.template.tasks, {
      completedAt: c.completedAt,
      closedAt: c.closedAt,
      loggedTaskIds: logs.keys(),
    }).filter((t) => !t.excludedStoreIds.includes(c.storeId))
    return {
      id: c.id,
      storeId: c.storeId,
      name: c.template.name,
      status: c.status,
      completedAt: c.completedAt?.toISOString() ?? null,
      sections: groupTasksBySection(tasks, c.sectionsSnapshot).map((g) => ({
        key: g.key,
        name: g.name,
        tasks: g.tasks.map((t) => ({
          id: t.id,
          label: t.description,
          requiresTemp: t.requiresTemp,
          isCritical: t.isCritical,
          done: logs.has(t.id),
          value: logs.get(t.id)?.temperatureValue ?? null,
        })),
      })),
    }
  })

  // TAB-1b — "WHO COMPLETED THIS TASK?", THE DESKTOP LIST EXACTLY. The same
  // filter as the execution page's picker (store-view/checklist/[id]/page.tsx):
  // this org, ACTIVE only (CHK-15 — the task-log route refuses anyone else),
  // assigned to the store, displayName ascending. One query for every store
  // this login can see, split per store below. The generic "Team Member" /
  // "Manager" options are not rows; the client prepends them, as desktop does.
  const staffRows = stores.length
    ? await prisma.staffMember.findMany({
        where: {
          organizationId,
          status: "ACTIVE",
          storeAssignments: { some: { storeId: { in: stores.map((s) => s.id) } } },
        },
        select: { id: true, displayName: true, pinSetAt: true, storeAssignments: { select: { storeId: true } } },
        orderBy: { displayName: "asc" },
      })
    : []
  const staffFor = (storeId: string): TabletStaff[] =>
    staffRows
      .filter((m) => m.storeAssignments.some((a) => a.storeId === storeId))
      .map((m) => ({ id: m.id, displayName: m.displayName, hasPin: m.pinSetAt !== null }))

  return {
    stores: stores.map((s) => ({
      ...s,
      headerDate: dashboardHeaderDate(now, s.timezone),
      day: localDateStr(now, s.timezone),
      staff: staffFor(s.id),
    })),
    checklists,
  }
}
