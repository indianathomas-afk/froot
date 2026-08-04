import { NextResponse } from "next/server"
import type { InventoryCount, User } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { actorFor, getCurrentUser, requireModule } from "@/lib/auth"
import { can, type Capability } from "@/lib/permissions"

export function ingredientDisplayName(i: { brand: string | null; name: string }) {
  return i.brand ? `${i.brand} ${i.name}` : i.name
}

type Organization = NonNullable<Awaited<ReturnType<typeof prisma.organization.findUnique>>>

export type CountsContext = {
  org: Organization
  dbUser: (User & { storeAssignments: { storeId: string }[] }) | null
  isAdmin: boolean
  canManage: boolean
  storeIds: string[]
}

// Standard guard chain for /api/inventory/counts routes: auth → org → module →
// user + store scope. Returns { error } (a ready NextResponse) when any step fails.
//
// PERM-2 §3 #5: pass a capability to add the role gate to the same chain. The
// inventory surface splits by data sensitivity — operational routes (counts,
// adjustments, pars) ask for a capability granted to every role, commercial
// ones (reports, valuation, vendor pricing) ask for inventory.analytics.view
// or inventory.costs.view. Callers that pass nothing keep the pre-PERM-2
// behavior of any member with the module.
export async function requireCountsContext(
  capability?: Capability
): Promise<CountsContext | { error: NextResponse }> {
  let userId: string, org: Organization | null, dbUser: CountsContext["dbUser"]
  try {
    const current = await getCurrentUser()
    userId = current.userId
    org = current.org
    dbUser = current.dbUser
  } catch {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  if (!userId || !org) return { error: NextResponse.json({ error: "Org not found" }, { status: 404 }) }

  try {
    await requireModule("inventory")
  } catch {
    return { error: NextResponse.json({ error: "MODULE_NOT_ACTIVE" }, { status: 403 }) }
  }

  if (capability && !can(actorFor(dbUser), capability)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }

  const isAdmin = dbUser?.role === "ADMIN"
  return {
    org,
    dbUser,
    isAdmin,
    canManage: isAdmin || dbUser?.role === "MANAGER",
    storeIds: dbUser?.storeAssignments.map((a) => a.storeId) ?? [],
  }
}

// Resolves a count by id within the caller's org and store scope. Takes the
// same optional capability as requireCountsContext above.
export async function requireCount(
  id: string,
  capability?: Capability
): Promise<(CountsContext & { count: InventoryCount }) | { error: NextResponse }> {
  const ctx = await requireCountsContext(capability)
  if ("error" in ctx) return ctx

  const count = await prisma.inventoryCount.findFirst({ where: { id, organizationId: ctx.org.id } })
  if (!count) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) }
  if (!ctx.isAdmin && !ctx.storeIds.includes(count.storeId)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return { ...ctx, count }
}

// Names for the "counted by" displays — completedByUserIds hold db User ids.
export async function userNamesById(userIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds)]
  if (unique.length === 0) return new Map()
  const users = await prisma.user.findMany({ where: { id: { in: unique } } })
  return new Map(users.map((u) => [u.id, u.name || u.email]))
}
