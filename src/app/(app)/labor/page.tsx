import { auth } from "@clerk/nextjs/server"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope, laborModuleAvailable } from "@/lib/auth"
import { WeeklyPlanClient } from "./weekly-plan-client"

// Weekly Plan (L-3) — the digital successor to the "Chief Schedule Strategy"
// spreadsheet: a week overview strip + selected-day coverage detail, assembled
// from the shared labor engines. Both feature gates first (env availability +
// per-org toggle) — where Labor doesn't exist here, the route 404s. Read-only
// for viewers; ADMIN/MANAGER can rebalance hours (guarded server-side on the
// write routes). Data is fetched client-side per store/week.

export default async function LaborWeeklyPlanPage() {
  const { orgId } = await auth()
  if (!orgId) notFound()
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) notFound()
  // Gate 1 (env availability) + Gate 2 (per-org toggle).
  if (!laborModuleAvailable(orgId) || !org.activeModules.includes("labor")) notFound()

  const { isAdmin, storeIds } = await getUserStoreScope()
  const stores = await prisma.store.findMany({
    where: { organizationId: org.id, isActive: true, ...(isAdmin ? {} : { id: { in: storeIds } }) },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  })

  return <WeeklyPlanClient stores={stores} />
}
