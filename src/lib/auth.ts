import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"

export async function getOrgId(): Promise<string> {
  const { orgId } = await auth()
  if (!orgId) throw new Error("Unauthorized")
  return orgId
}

export async function getOrganization() {
  const orgId = await getOrgId()
  const org = await prisma.organization.findUnique({
    where: { clerkOrgId: orgId },
  })
  if (!org) throw new Error("Organization not found")
  return org
}

export async function requireModule(module: "inventory" | "nutrition" | "hr") {
  const org = await getOrganization()
  if (!org.activeModules.includes(module)) {
    throw new Error(`MODULE_NOT_ACTIVE:${module}`)
  }
}

// HR availability gate (distinct from the per-org activeModules toggle): does
// the HR module EXIST in this environment at all? Off = no billing card, no
// toggle, no nav, /hr 404s — this is what hides in-development HR in
// production. HR_MODULE_AVAILABLE=true in staging/preview; unset in production
// until launch. HR_INTERNAL_ORG_IDS (comma-separated Clerk org IDs) lets us
// dogfood in production for our own org before global launch. Server-side
// only — never expose as NEXT_PUBLIC_.
export function hrModuleAvailable(clerkOrgId?: string): boolean {
  if (process.env.HR_MODULE_AVAILABLE === "true") return true
  if (clerkOrgId && process.env.HR_INTERNAL_ORG_IDS) {
    return process.env.HR_INTERNAL_ORG_IDS.split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .includes(clerkOrgId)
  }
  return false
}

export async function getCurrentUser() {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const org = await getOrganization()
  const dbUser = await prisma.user.findUnique({
    where: { clerkUserId: userId },
    include: { storeAssignments: true },
  })
  return { userId, org, dbUser }
}

export async function requireAdmin() {
  const { dbUser } = await getCurrentUser()
  if (dbUser?.role !== "ADMIN") {
    throw new Error("FORBIDDEN: Admin access required")
  }
  return dbUser
}

export async function requireManagerOrAdmin() {
  const { dbUser } = await getCurrentUser()
  if (dbUser?.role !== "ADMIN" && dbUser?.role !== "MANAGER") {
    throw new Error("FORBIDDEN: Manager or Admin access required")
  }
  return dbUser
}

// Returns the set of store IDs the current user is allowed to see.
// isAdmin: true means unrestricted (all org stores). Otherwise storeIds is the
// authoritative allow-list, sourced from StoreUserAssignment — never from URL params.
export async function getUserStoreScope() {
  const { dbUser } = await getCurrentUser()
  const isAdmin = dbUser?.role === "ADMIN"
  const storeIds = dbUser?.storeAssignments.map((a) => a.storeId) ?? []
  return { isAdmin, storeIds, role: dbUser?.role ?? null }
}
