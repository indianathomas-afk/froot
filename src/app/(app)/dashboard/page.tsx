import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope, laborModuleAvailable } from "@/lib/auth"
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

  const { isAdmin, storeIds, role } = await getUserStoreScope()

  const stores = await prisma.store.findMany({
    where: { organizationId: org.id, isActive: true, ...(isAdmin ? {} : { id: { in: storeIds } }) },
    orderBy: { name: "asc" },
    select: { id: true, name: true, city: true, state: true },
  })

  // Days since last finalized count (kept from Phase I-4) — managers/admins,
  // inventory module only.
  let countRecency: { storeId: string; storeName: string; days: number | null }[] = []
  const canSeeCounts = role === "ADMIN" || role === "MANAGER"
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

  return { stores, countRecency, laborEnabled }
}

export default async function DashboardPage() {
  const data = await getDashboardData()
  if (!data) return null
  const { stores, countRecency, laborEnabled } = data

  return (
    <>
      <DashboardClient
        stores={stores.map((s) => ({ id: s.id, name: s.name, location: [s.city, s.state].filter(Boolean).join(", ") }))}
        countRecency={countRecency}
        laborEnabled={laborEnabled}
      />
      <BuildInfo />
    </>
  )
}
