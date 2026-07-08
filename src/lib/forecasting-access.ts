import { NextResponse } from "next/server"
import type { Store, User } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"

type Organization = NonNullable<Awaited<ReturnType<typeof prisma.organization.findUnique>>>

export type ForecastContext = {
  org: Organization
  dbUser: (User & { storeAssignments: { storeId: string }[] }) | null
  userId: string
  isAdmin: boolean
}

// Guard chain for /api/forecasting routes. Viewing is ADMIN + MANAGER (managers
// see every location, read-only — v1 decision); every mutation additionally
// passes { write: true } so goal edits are ADMIN-only, enforced server-side.
export async function requireForecastContext(
  opts: { write?: boolean } = {}
): Promise<ForecastContext | { error: NextResponse }> {
  let userId: string, org: Organization | null, dbUser: ForecastContext["dbUser"]
  try {
    const current = await getCurrentUser()
    userId = current.userId
    org = current.org
    dbUser = current.dbUser
  } catch {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  if (!userId || !org) return { error: NextResponse.json({ error: "Org not found" }, { status: 404 }) }

  const isAdmin = dbUser?.role === "ADMIN"
  if (opts.write && !isAdmin) {
    return { error: NextResponse.json({ error: "Admin access required" }, { status: 403 }) }
  }
  if (!isAdmin && dbUser?.role !== "MANAGER") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return { org, dbUser, userId, isAdmin }
}

// Org-scoped store lookup — never trust a storeId from the request body alone.
export async function requireForecastStore(
  ctx: ForecastContext,
  storeId: string
): Promise<Store | { error: NextResponse }> {
  const store = await prisma.store.findFirst({ where: { id: storeId, organizationId: ctx.org.id } })
  if (!store) return { error: NextResponse.json({ error: "Store not found" }, { status: 404 }) }
  return store
}
