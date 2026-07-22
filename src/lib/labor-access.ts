import { NextResponse } from "next/server"
import type { Store, User } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, laborModuleAvailable } from "@/lib/auth"

type Organization = NonNullable<Awaited<ReturnType<typeof prisma.organization.findUnique>>>

export type LaborContext = {
  org: Organization
  dbUser: (User & { storeAssignments: { storeId: string }[] }) | null
  userId: string
  isAdmin: boolean
}

// Both feature gates (env availability + per-org activeModules): where Labor
// doesn't exist, every /api/labor route 404s exactly like /api/hr/toggle. This
// is the shared base — no role restriction — so read-only dashboard consumers
// (STORE/STAFF) and the ADMIN/MANAGER config routes both build on it.
export async function requireLaborView(): Promise<LaborContext | { error: NextResponse }> {
  let userId: string, org: Organization | null, dbUser: LaborContext["dbUser"]
  try {
    const current = await getCurrentUser()
    userId = current.userId
    org = current.org
    dbUser = current.dbUser
  } catch {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  if (!userId || !org) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) }

  // Availability gate → 404 (feature does not exist here).
  if (!laborModuleAvailable(org.clerkOrgId)) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) }
  }
  // Per-org toggle → 404 as well, so an org without the add-on can't probe it.
  if (!org.activeModules.includes("labor")) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) }
  }

  const isAdmin = dbUser?.role === "ADMIN"
  return { org, dbUser, userId, isAdmin }
}

// Guard for config/mutation routes (settings, positions, forecast entry): the
// gates above PLUS RBAC. Viewing and writing are both ADMIN + MANAGER (the
// Labor v1 decision — unlike Forecasting, where writes are ADMIN-only).
// STORE/STAFF get read-only dashboard cards (requireLaborView), not these.
export async function requireLaborContext(
  opts: { write?: boolean } = {}
): Promise<LaborContext | { error: NextResponse }> {
  const ctx = await requireLaborView()
  if ("error" in ctx) return ctx

  const isManager = ctx.dbUser?.role === "MANAGER"
  if (!ctx.isAdmin && !isManager) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  // write === read for Labor (ADMIN + MANAGER both allowed); opts.write is kept
  // for symmetry with requireForecastContext and future tightening.
  void opts.write
  return ctx
}

// Org-scoped store lookup — never trust a storeId from the request body alone.
// Managers are additionally limited to their assigned stores; admins see all.
export async function requireLaborStore(
  ctx: LaborContext,
  storeId: string
): Promise<Store | { error: NextResponse }> {
  const store = await prisma.store.findFirst({ where: { id: storeId, organizationId: ctx.org.id } })
  if (!store) return { error: NextResponse.json({ error: "Store not found" }, { status: 404 }) }
  if (!ctx.isAdmin) {
    const assigned = ctx.dbUser?.storeAssignments.some((a) => a.storeId === storeId)
    if (!assigned) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return store
}
