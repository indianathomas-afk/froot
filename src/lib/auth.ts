import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { findStaffMemberForUser } from "@/lib/hr"

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

// HR-7 rule 1/3: the ONE gate for every /my/* page and API. Resolves the
// session to the caller's own StaffMember — preferring the explicit
// StaffMember.userId link (set by the invite webhook), falling back to the
// HR-4 org-scoped email match — and requires status=ACTIVE. Enforced
// server-side on every request, so a terminated staff member is denied even
// if Clerk-side revocation lags. Callers never accept a staff id from the
// client: whatever this returns IS the scope.
export type StaffSelfDeniedReason = "unauthenticated" | "unavailable" | "no-profile" | "terminated"
export type StaffSelfResult =
  | {
      ok: true
      org: NonNullable<Awaited<ReturnType<typeof getOrganization>>>
      dbUser: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>["dbUser"]>
      staffMember: NonNullable<Awaited<ReturnType<typeof findStaffSelf>>>
    }
  | { ok: false; reason: StaffSelfDeniedReason }

async function findStaffSelf(orgDbId: string, dbUser: { id: string; email: string }) {
  return findStaffMemberForUser(orgDbId, dbUser)
}

export async function getActiveStaffSelf(): Promise<StaffSelfResult> {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return { ok: false, reason: "unauthenticated" }

  // Availability gate first, then the per-org add-on toggle — with either
  // off, /my/* must behave as though the feature does not exist.
  if (!hrModuleAvailable(orgId)) return { ok: false, reason: "unavailable" }
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org || !org.activeModules.includes("hr")) return { ok: false, reason: "unavailable" }

  const dbUser = await prisma.user.findUnique({
    where: { clerkUserId: userId },
    include: { storeAssignments: true },
  })
  if (!dbUser || dbUser.organizationId !== org.id) return { ok: false, reason: "no-profile" }

  const staffMember = await findStaffSelf(org.id, dbUser)
  if (!staffMember || staffMember.organizationId !== org.id) return { ok: false, reason: "no-profile" }
  if (staffMember.status !== "ACTIVE") return { ok: false, reason: "terminated" }

  return { ok: true, org, dbUser, staffMember }
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
