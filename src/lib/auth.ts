import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { findStaffMemberForUser } from "@/lib/hr"
import { overridesFrom, type PermissionUser } from "@/lib/permissions"

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

export async function requireModule(module: "inventory" | "nutrition" | "hr" | "labor") {
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

// Labor availability gate — same shape as hrModuleAvailable() above: does the
// Labor module EXIST in this environment at all? Off = no settings card, no
// toggle, no nav, no dashboard cards, /api/labor/* 404s. LABOR_MODULE_AVAILABLE
// =true in staging/preview; unset in production until launch.
// LABOR_INTERNAL_ORG_IDS (comma-separated Clerk org IDs) lets us dogfood in
// production for our own org before global launch. Server-side only — never
// expose as NEXT_PUBLIC_.
export function laborModuleAvailable(clerkOrgId?: string): boolean {
  if (process.env.LABOR_MODULE_AVAILABLE === "true") return true
  if (clerkOrgId && process.env.LABOR_INTERNAL_ORG_IDS) {
    return process.env.LABOR_INTERNAL_ORG_IDS.split(",")
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
  const row = await prisma.user.findUnique({
    where: { clerkUserId: userId },
    include: { storeAssignments: true },
  })
  // DEBT-50 / F1. clerkUserId is @unique, so ONE User row exists per Clerk
  // identity, globally — an identity with memberships in two orgs resolves
  // to the row of whichever org it was created in. Without this test that
  // row's ROLE is handed to the session's org: an ADMIN of org A is
  // admitted as ADMIN of org B, and isAdmin short-circuits store scoping.
  // A wrong-org row is treated as ABSENT, the same shape getActiveStaffSelf()
  // uses below. Never fall through to the row's role.
  const dbUser = row && row.organizationId === org.id ? row : null
  if (row && !dbUser) {
    console.warn(
      `[auth] cross-org User row refused: clerkUserId=${userId} row org=${row.organizationId} session org=${org.id} (${org.clerkOrgId})`
    )
  }
  // PERM-5. THE LOAD POINT. can() is synchronous and overrides live in the
  // database, so the set is resolved ONCE here — on the row this function
  // already fetched, costing no extra query — and threaded to every call site
  // as `actor`. Call sites ask can(actor, ...) instead of can({ role }, ...);
  // the difference between the two is exactly whether the per-user layer is
  // consulted, which is why the migration is call-site-by-call-site and not a
  // flag. A wrong-org row is already null above, so it contributes no
  // overrides either — the cross-org refusal and the override layer agree.
  return { userId, org, dbUser, actor: actorFor(dbUser) }
}

// The one adapter from a Prisma User row to a PermissionUser. Passing the row
// itself would work structurally, but this keeps the fail-closed reading of an
// unselected column (overridesFrom's `undefined` case) in one place instead of
// depending on every caller's `select`.
export function actorFor(
  dbUser: { role: string; deniedCapabilities?: string[] | null } | null | undefined
): PermissionUser {
  return { role: dbUser?.role, overrides: dbUser ? overridesFrom(dbUser.deniedCapabilities) : undefined }
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
  const { dbUser, actor } = await getCurrentUser()
  const isAdmin = dbUser?.role === "ADMIN"
  const storeIds = dbUser?.storeAssignments.map((a) => a.storeId) ?? []
  // PERM-5: `actor` carries the same role PLUS the per-user override set.
  // `role` stays for the 26 callers that only need the string; anything asking
  // a capability question must use `actor`, or the override is not consulted.
  return { isAdmin, storeIds, role: dbUser?.role ?? null, actor }
}
