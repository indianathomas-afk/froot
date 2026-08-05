import { auth } from "@clerk/nextjs/server"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope, laborModuleAvailable } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { BuildInfo } from "@/components/build-info"
import { DashboardClient } from "./dashboard-client"

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

  const { isAdmin, storeIds, actor } = await getUserStoreScope()

  const stores = await prisma.store.findMany({
    where: { organizationId: org.id, isActive: true, ...(isAdmin ? {} : { id: { in: storeIds } }) },
    orderBy: { name: "asc" },
    select: { id: true, name: true, city: true, state: true },
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

  return { stores, countRecency, laborEnabled, canViewForecasting }
}

export default async function DashboardPage() {
  const data = await getDashboardData()
  if (!data) return null
  const { stores, countRecency, laborEnabled, canViewForecasting } = data

  return (
    <>
      <DashboardClient
        stores={stores.map((s) => ({ id: s.id, name: s.name, location: [s.city, s.state].filter(Boolean).join(", ") }))}
        countRecency={countRecency}
        laborEnabled={laborEnabled}
        canViewForecasting={canViewForecasting}
      />
      <BuildInfo />
    </>
  )
}
