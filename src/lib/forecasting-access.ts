import { NextResponse } from "next/server"
import type { Store, User } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { can, scope, type CapabilityScope } from "@/lib/permissions"
import { forecastWindowFrom, type ForecastWindow } from "@/lib/forecast-window"
import { localDateStr } from "@/lib/reports"

type Organization = NonNullable<Awaited<ReturnType<typeof prisma.organization.findUnique>>>

export type ForecastContext = {
  org: Organization
  dbUser: (User & { storeAssignments: { storeId: string }[] }) | null
  userId: string
  // PERM-6 Task 5: these two were ONE field called `isAdmin`, and the name is
  // what invited the fusion. canEdit answers "may write goals"; unscoped
  // answers "is exempt from StoreUserAssignment scoping". Both are ADMIN today,
  // so nothing changes now — but they are separately grantable, which is what
  // PERM-5's override layer needs. Never reintroduce a single flag for both.
  canEdit: boolean
  unscoped: boolean
  // scope(dbUser, "forecasting.view") — { access: "window" } for MANAGER.
  viewScope: CapabilityScope
}

// Guard chain for /api/forecasting routes. Every decision goes through the
// PERM-1 capability layer — no inline role comparisons live here any more
// (PERM-3). Reads ask forecasting.view; every mutation passes { write: true }
// and asks forecasting.edit, which is ADMIN-only. That Forecasting writes are
// ADMIN-only while Labor writes are ADMIN+MANAGER is DELIBERATE — see
// PERMISSIONS_INVENTORY.md §3 #7. Do not harmonize it.
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

  const actor = { role: dbUser?.role }
  if (opts.write && !can(actor, "forecasting.edit")) {
    return { error: NextResponse.json({ error: "Admin access required" }, { status: 403 }) }
  }
  if (!can(actor, "forecasting.view")) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return {
    org,
    dbUser,
    userId,
    canEdit: can(actor, "forecasting.edit"),
    unscoped: can(actor, "forecasting.scope.all"),
    viewScope: scope(actor, "forecasting.view"),
  }
}

// Org-scoped store lookup — never trust a storeId from the request body alone.
// PERM-3: non-admins are additionally limited to their StoreUserAssignment rows,
// matching requireLaborStore. Before this, a MANAGER assigned to one location
// could read any sibling store's forecast by passing its id.
export async function requireForecastStore(
  ctx: ForecastContext,
  storeId: string
): Promise<Store | { error: NextResponse }> {
  const store = await prisma.store.findFirst({ where: { id: storeId, organizationId: ctx.org.id } })
  if (!store) return { error: NextResponse.json({ error: "Store not found" }, { status: 404 }) }
  if (!ctx.unscoped) {
    const assigned = ctx.dbUser?.storeAssignments.some((a) => a.storeId === storeId)
    if (!assigned) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return store
}

// The caller's forecast read window for a given store, or null when they are
// unrestricted (ADMIN). Computed PER REQUEST from the store's own timezone —
// never cached, never hoisted — because month-end is precisely when a manager
// is budgeting and a stale boundary would fail at the worst moment.
export function forecastWindowForStore(ctx: ForecastContext, store: Store): ForecastWindow | null {
  if (ctx.viewScope.access !== "window") return null
  return forecastWindowFrom(localDateStr(new Date(), store.timezone), ctx.viewScope.monthsAhead)
}

// Window for a request that carries NO storeId (only /audit does). The window
// needs a timezone, so pick one deterministically from the caller's assigned
// stores: store number, then name.
//
// PLACEHOLDER pending BUILD-2 (deterministic primary store), which is blocked
// on BUILD-1. Once BUILD-2 lands, this should ask for the caller's primary
// store instead of sorting. StoreStaffAssignment.isPrimary is NOT usable here —
// it maps staff records, not app users.
export async function forecastWindowForCaller(ctx: ForecastContext): Promise<ForecastWindow | null> {
  if (ctx.viewScope.access !== "window") return null
  const storeIds = ctx.dbUser?.storeAssignments.map((a) => a.storeId) ?? []
  if (storeIds.length === 0) return null
  const store = await prisma.store.findFirst({
    where: { id: { in: storeIds }, organizationId: ctx.org.id },
    orderBy: [{ storeNumber: "asc" }, { name: "asc" }],
    select: { timezone: true },
  })
  if (!store) return null
  return forecastWindowFrom(localDateStr(new Date(), store.timezone), ctx.viewScope.monthsAhead)
}
