import { auth } from "@clerk/nextjs/server"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope, laborModuleAvailable, squareLaborAvailable } from "@/lib/auth"
import { can } from "@/lib/permissions"
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

  const { isAdmin, storeIds, actor } = await getUserStoreScope()
  const stores = await prisma.store.findMany({
    where: { organizationId: org.id, isActive: true, ...(isAdmin ? {} : { id: { in: storeIds } }) },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  })

  // AL-2 (Gary's Q2 ruling from AL-1, delivered in Phase 2): a READ-ONLY
  // indication that the Advanced Labor overlay is on. The FLIP still lives in the
  // Square Integration card on /settings per seam (a) — this is a label, not a
  // control, and deliberately renders nothing where the overlay does not exist in
  // this environment at all.
  const advancedLabor = squareLaborAvailable(orgId) ? org.squareLaborEnabled : null

  // OVL-S5 — THE DAY INSPECTOR LINK, AND IT CARRIES ALL FIVE OF THE INSPECTOR'S
  // OWN GATES (S5-A5), not the three this page already passed.
  //
  // This is S5-D2's argument turned on the link itself. The reason the inspector
  // gets NO SIDEBAR ENTRY is that the sidebar knows `laborAvailable` and nothing
  // about squareLaborEnabled, so an entry there would be a door that 404s — the
  // exact thing sidebar.tsx's own comment says the nav asks the override to avoid.
  // A header link computed from three of the five gates would have been that same
  // broken door in a different place, and worse: /labor is visible to every role
  // (labor.view is ALL), so without the labor.manage check the link would 404 for
  // STORE and STAFF on every load.
  //
  // can() on `actor` rather than on the role string, so a PERM-5 per-user override
  // is consulted — a manager denied labor.manage must not be shown the link.
  // `actor` comes off the getUserStoreScope() call this page already makes; a
  // second call would be a second getCurrentUser() round trip for one boolean.
  const canInspect =
    laborModuleAvailable(orgId) &&
    org.activeModules.includes("labor") &&
    squareLaborAvailable(orgId) &&
    org.squareLaborEnabled &&
    can(actor, "labor.manage")

  return <WeeklyPlanClient stores={stores} advancedLabor={advancedLabor} canInspect={canInspect} />
}
