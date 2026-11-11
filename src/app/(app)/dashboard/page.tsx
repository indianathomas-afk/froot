import { auth } from "@clerk/nextjs/server"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { pinGateApplies } from "@/lib/tablet-pin-gate"
import { loadPinStaffByStore } from "@/lib/tablet-pin-staff"
import { getUserStoreScope, laborModuleAvailable } from "@/lib/auth"
import { dashboardAnchorTimeZone, dashboardHeaderDate } from "@/lib/reports"
import { can } from "@/lib/permissions"
import { BuildInfo } from "@/components/build-info"
import { DashboardClient } from "./dashboard-client"
import { ComplianceBanner } from "./compliance-banner"
import { CalendarDueBanner } from "@/components/calendar-due-banner"
import { getViewMode } from "@/lib/view-mode-server"
import { loadTabletData } from "./tablet-data"
import { TabletHome } from "./tablet-home"
import { enabledKeys, stripTileKeys } from "@/lib/display-layout"

// Store Dashboard (Phase D-1) — the landing page after login. Layout and
// styling follow froot_docs/dashboard-design/ (README.md is the spec).
// Sales Performance + Monthly Goal run on real data (I-5 sales caches +
// StoreMonthlyGoal); Shift Checklist reads today's real checklists; Team
// Messages + Corporate Update are live (I-14, /api/dashboard/comms);
// Instagram is live via /api/instagram/feed (hidden until connected + enabled).

async function getDashboardData() {
  const { orgId } = await auth()
  if (!orgId) return null

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return null

  const { isAdmin, storeIds, role, actor } = await getUserStoreScope()

  const stores = await prisma.store.findMany({
    where: { organizationId: org.id, isActive: true, ...(isAdmin ? {} : { id: { in: storeIds } }) },
    orderBy: { name: "asc" },
    select: { id: true, name: true, city: true, state: true, timezone: true },
  })

  // PERM-5C. THE PAGE GUARD /dashboard never had (it was on PERM-5A's
  // ungoverned list). dashboard.view is ALL, so no role's access changes —
  // this exists so the landing page is reachable through the same layer as
  // everything it links to.
  //
  // notFound(), NOT redirect(). /dashboard is where every other guard in the
  // app sends a denied user — the staff, stores, reports and templates layouts
  // all redirect here — so a redirect from this page could only point at
  // itself. That is also why dashboard.view is deliberately absent from
  // ENFORCED_CAPABILITIES: a denied user would have no landing page at all and
  // no in-app way back. THE REDIRECT TARGET MUST CHANGE BEFORE THIS CAPABILITY
  // IS EVER PROMOTED TO THE GRID (Gary, 2026-08-04). Until then the branch is
  // unreachable in practice — every role grants dashboard.view, and PATCH
  // /api/users/[id] refuses to store a denial that is not in the grid list.
  if (!can(actor, "dashboard.view")) notFound()

  // Days since last finalized count (kept from Phase I-4), inventory module
  // only. Was an inline ADMIN||MANAGER test; inventory.analytics.view is
  // MANAGE — the same tier — and this card is the dashboard face of the
  // finalized-count summary that capability already governs (see its registry
  // comment). One denial now takes the reports, the alerts, the summary AND
  // this card together, instead of leaving a count-recency readout stranded on
  // the landing page after an admin thought they had removed it.
  let countRecency: { storeId: string; storeName: string; days: number | null }[] = []
  const canSeeCounts = can(actor, "inventory.analytics.view")
  if (canSeeCounts && org.activeModules.includes("inventory")) {
    const withCounts = await prisma.store.findMany({
      where: { organizationId: org.id, isActive: true, ...(isAdmin ? {} : { id: { in: storeIds } }) },
      include: { inventoryCounts: { where: { status: "Finalized" }, orderBy: { finalizedAt: "desc" }, take: 1 } },
      orderBy: { name: "asc" },
    })
    const now = Date.now()
    countRecency = withCounts.map((s) => ({
      storeId: s.id,
      storeName: s.name,
      days: s.inventoryCounts[0]?.finalizedAt
        ? Math.floor((now - s.inventoryCounts[0].finalizedAt.getTime()) / 86400000)
        : null,
    }))
  }

  // Labor Budget card gates on both flags (env availability + org toggle).
  const laborEnabled = laborModuleAvailable(orgId) && org.activeModules.includes("labor")

  // PERM-3: the two "Forecasting →" links on this page must ask the same
  // capability that gates the destination, or STORE/STAFF are shown a link that
  // dead-ends in a redirect. Absent, not disabled.
  const canViewForecasting = can(actor, "forecasting.view")

  // NAV-1: the Daily Tasks button in the page header. It asks EXACTLY what the
  // sidebar's /checklists entry asks and nothing more — checklists.view, plus
  // STAFF-1's store-proxy, which is the only reason that link can be absent for
  // a role that holds the capability. No new capability is introduced, and the
  // rule it implements is "if a role cannot see the sidebar link, it does not
  // see the button". The count is the same query the app layout already runs
  // for the sidebar (src/app/(app)/layout.tsx) — duplicated rather than shared
  // because the two run in different render trees; if a third caller appears,
  // lift it into src/lib.
  let canViewChecklists = can(actor, "checklists.view")
  if (canViewChecklists && role === "STAFF") {
    canViewChecklists =
      storeIds.length > 0 &&
      (await prisma.checklist.count({
        where: { storeId: { in: storeIds }, status: { in: ["Pending", "In Progress"] } },
      })) > 0
  }

  // TAB-3: the org's card picker. Raw JSON here; enabledKeys()/stripTileKeys()
  // below apply the merge rule (src/lib/display-layout.ts). NULL = today.
  return {
    orgId: org.id,
    stores,
    countRecency,
    laborEnabled,
    canViewForecasting,
    canViewChecklists,
    dashboardLayout: org.dashboardLayout,
    tabletLayout: org.tabletLayout,
    // TAB-9 fix: the login's role, for the tablet HR chip only.
    role,
    // TAB-4: the PIN flow runs for a STORE login while the org switch is on
    // (Q2a). The routes enforce it; this only decides what the screen asks.
    pinRequired: pinGateApplies(org, role),
  }
}

export default async function DashboardPage() {
  const data = await getDashboardData()
  if (!data) return null
  const { stores, countRecency, laborEnabled, canViewForecasting, canViewChecklists } = data

  // TAB-1 — Tablet view (this device's `froot_view` cookie). The tablet home
  // replaces the desktop dashboard on this route only: Tasks + Team Messages,
  // no Sales/Goal/Labor cards (Gary's ruling 4), and no full-width due banner —
  // the overdue chip in the tablet header opens the same list as a sheet
  // (ruling 7). Desktop below is unchanged.
  if ((await getViewMode()) === "tablet") {
    const tablet = await loadTabletData(data.orgId, stores)
    // TAB-3: the stat strip's tiles, in the ADMIN's order (all off by default).
    // Per-viewer gates are the summary payload's, applied in the strip.
    // TAB-9 fix: `role` only hides the personal HR chip on a STORE login.
    return (
      <TabletHome
        stores={tablet.stores}
        checklists={tablet.checklists}
        stripTiles={stripTileKeys(data.tabletLayout)}
        role={data.role}
        pinRequired={data.pinRequired}
      />
    )
  }

  // BUG-15. The header date is formatted HERE, in each store's own zone, and
  // handed down as a string — never read off the clock in the client, where the
  // server (UTC on Vercel) and the browser format it differently after 5 PM
  // Pacific (React #418). One instant for every string on the page. The rollup
  // date uses the same zone rule as /api/dashboard/rollup.
  const now = new Date()
  const rollupHeaderDate = dashboardHeaderDate(now, dashboardAnchorTimeZone(stores))
  // TAB-4 — the due banner's names, only while a STORE login needs PINs.
  const pinStaffByStore = data.pinRequired ? await loadPinStaffByStore(data.orgId, stores.map((s) => s.id)) : {}

  return (
    <>
      {/* SELF-1. Above everything, because a manager's own overdue training
          should not be below three sales cards. Renders nothing — no wrapper,
          no spacing — for anyone with nothing owed, and costs this server
          component ZERO queries: it fetches its own data client-side, the way
          every other heavy card on this page already does. */}
      <ComplianceBanner />
      {/* CAL-1. Below SELF-1's: a person owing training and a store owing a
          reminder are different obligations, and the personal one reads first. */}
      <CalendarDueBanner pinRequired={data.pinRequired} pinStaffByStore={pinStaffByStore} />
      <DashboardClient
        stores={stores.map((s) => ({
          id: s.id,
          name: s.name,
          location: [s.city, s.state].filter(Boolean).join(", "),
          headerDate: dashboardHeaderDate(now, s.timezone),
        }))}
        rollupHeaderDate={rollupHeaderDate}
        countRecency={countRecency}
        laborEnabled={laborEnabled}
        canViewForecasting={canViewForecasting}
        canViewChecklists={canViewChecklists}
        layoutKeys={enabledKeys("dashboard", data.dashboardLayout)}
      />
      <BuildInfo />
    </>
  )
}
