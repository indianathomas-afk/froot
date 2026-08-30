import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { localDateStr, dbDate } from "@/lib/reports"
import { addDaysStr } from "@/lib/goal-engine"
import { DEFAULT_TIME_ZONE } from "@/lib/hr"

// ─────────────────────────────────────────────────────────────────────────────
// ENG-1 — GET /api/staff/engagement. The engagement page's ONLY data source.
//
// THIS ROUTE IS WHERE engagement.view IS ACTUALLY ENFORCED, and that is the
// reason it exists as a route at all rather than the page fetching inline
// (Gary's D2 ruling, 2026-08-30). COMP-1's F3 finding is the lesson being
// applied: labor.view's own comments claimed it gated a page and its routes when
// it gated only a sidebar link, and denying it would have "hidden a link over
// pages and routes that keep answering" (docs/DECISIONS.md:138). A capability
// whose only consumer is a link is the defect, not the feature.
//
// IT IS ALSO THE ONLY GATE THAT PROVES THE CAPABILITY REFUSES. /staff/engagement
// sits under (app)/staff/layout.tsx, which redirects anyone without staff.view
// (MANAGE) — so a MANAGER is bounced by the LAYOUT and never reaches the page's
// engagement.view check. API routes inherit no page layout, so a MANAGER's
// request lands here and is refused by engagement.view itself. Gary's Evidence-1
// amendment: the page test is corroboration; THIS 403 is the proof.
//
// DELIBERATELY NOT STORE-SCOPED BEYOND THE ORG. engagement.view is ADMIN_ONLY
// and ADMINs are unrestricted across the org's stores, so there is no store
// allow-list to apply — the optional ?store= below is a FILTER the caller
// chooses, never a boundary. It is still validated against the org, because a
// filter that accepted a foreign id would leak the existence of another org's
// store.
// ─────────────────────────────────────────────────────────────────────────────

const WINDOW_DAYS = 30
const TOP_PAGES = 3

export async function GET(req: Request) {
  let ctx
  try {
    ctx = await getCurrentUser()
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { org, dbUser, actor } = ctx

  if (!can(actor, "engagement.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  // A session with no User row in this org has no actor and is already refused
  // above (actorFor(null) denies everything). This is belt-and-braces for the
  // reader, not a second gate.
  if (!dbUser) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const url = new URL(req.url)
  const storeParam = url.searchParams.get("store")

  // Validate the filter against the org before it reaches a query. An id from
  // another org must answer 404, not silently widen or silently empty.
  let storeFilter: { id: string; name: string; storeNumber: string | null } | null = null
  if (storeParam) {
    storeFilter = await prisma.store.findFirst({
      where: { id: storeParam, organizationId: org.id },
      select: { id: true, name: true, storeNumber: true },
    })
    if (!storeFilter) return NextResponse.json({ error: "Store not found" }, { status: 404 })
  }

  // The window is org-local days, matching how the beacon stamped them — the
  // same Organization.timezone -> DEFAULT_TIME_ZONE chain, so "last 30 days"
  // means the same thing on both sides of the write.
  const todayStr = localDateStr(new Date(), org.timezone || DEFAULT_TIME_ZONE)
  const since = dbDate(addDaysStr(todayStr, -(WINDOW_DAYS - 1)))

  const [users, grouped] = await Promise.all([
    prisma.user.findMany({
      where: {
        organizationId: org.id,
        // With a store filter the row set narrows to logins that belong to that
        // store — its device accounts and the people assigned to it.
        ...(storeFilter
          ? {
              OR: [
                { defaultStoreId: storeFilter.id },
                { storeAssignments: { some: { storeId: storeFilter.id } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        lastSeenAt: true,
        lastSeenLocation: true,
        storeAssignments: { select: { store: { select: { id: true, name: true } } } },
      },
    }),
    // ONE grouped read for the whole roster — never a query per row (HR-8's
    // discipline). Bounded by (users x paths) within the window, which the
    // normalization rule caps at 68 paths per user.
    prisma.usageDaily.groupBy({
      by: ["userId", "path"],
      where: {
        organizationId: org.id,
        date: { gte: since },
        ...(storeFilter ? { storeId: storeFilter.id } : {}),
      },
      _sum: { count: true },
      _max: { lastAt: true },
    }),
  ])

  const byUser = new Map<string, { path: string; count: number }[]>()
  for (const g of grouped) {
    const list = byUser.get(g.userId) ?? []
    list.push({ path: g.path, count: g._sum.count ?? 0 })
    byUser.set(g.userId, list)
  }

  const rows = users.map((u) => {
    const pages = (byUser.get(u.id) ?? []).sort((a, b) => b.count - a.count)
    const assignments = u.storeAssignments.map((a) => a.store)
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      // ENG-1 ruling 4: a STORE account with exactly one assignment IS a store's
      // shared device, and the page labels it as such rather than as a person.
      // The predicate is isDeviceLogin's (src/lib/device-login.ts:66), applied
      // here on the shape this route already loaded.
      isDeviceLogin: u.role === "STORE" && assignments.length === 1,
      stores: assignments,
      lastSeenAt: u.lastSeenAt,
      lastSeenLocation: u.lastSeenLocation,
      totalCount: pages.reduce((n, p) => n + p.count, 0),
      topPages: pages.slice(0, TOP_PAGES),
    }
  })

  // Dormant logins are the point of the sort, so nulls sort LAST on a
  // most-recent-first list: a login that has never been seen is the most
  // interesting row on the page and must not be buried mid-list.
  rows.sort((a, b) => {
    if (a.lastSeenAt && b.lastSeenAt) return b.lastSeenAt.getTime() - a.lastSeenAt.getTime()
    if (a.lastSeenAt) return -1
    if (b.lastSeenAt) return 1
    return a.email.localeCompare(b.email)
  })

  return NextResponse.json({ windowDays: WINDOW_DAYS, store: storeFilter, rows })
}
