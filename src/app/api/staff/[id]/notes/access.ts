import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  getCurrentUser,
  getOrganization,
  getUserStoreScope,
  hrModuleAvailable,
  requireModule,
} from "@/lib/auth"
import { can } from "@/lib/permissions"

// Shared guard for every manager-notes route. Manager notes are ADMIN/MANAGER
// only, HR-gated, and store-scoped: a MANAGER may only touch notes for staff
// assigned to one of their own stores. Mirrors getStaffMember() on the
// /staff/[id] page so the page and the API can't drift apart.
export async function requireNoteAccess(staffId: string) {
  const fail = (error: string, status: number) =>
    ({ ok: false as const, response: NextResponse.json({ error }, { status }) })

  const { orgId: clerkOrgId } = await auth()
  if (!clerkOrgId) return fail("Unauthorized", 401)

  // Availability gate first, then the per-org add-on toggle — with either off,
  // these routes must behave as though the feature does not exist.
  if (!hrModuleAvailable(clerkOrgId)) return fail("Not found", 404)
  try {
    await requireModule("hr")
  } catch {
    return fail("HR module is not active", 403)
  }

  // PERM-5C. Was requireManagerOrAdmin(). staff.notes.use is MANAGE, so the
  // role baseline is unchanged; like staff.documents.manage this capability had
  // ZERO call sites until now, and this single edit makes it load-bearing for
  // note create, edit and delete at once — every notes route funnels here.
  let caller
  let actor
  try {
    const viewer = await getCurrentUser()
    caller = viewer.dbUser
    actor = viewer.actor
  } catch {
    return fail("Manager or Admin access required", 403)
  }
  if (!caller || !can(actor, "staff.notes.use")) {
    return fail("Manager or Admin access required", 403)
  }

  const org = await getOrganization()
  const member = await prisma.staffMember.findFirst({
    where: { id: staffId, organizationId: org.id },
    include: { storeAssignments: true },
  })
  // Cross-org or unknown staff IDs 404 rather than 403 — don't leak existence.
  if (!member) return fail("Staff member not found", 404)

  // NOT migrated, deliberately (PERM-5C). This is STORE SCOPING — which staff
  // members a caller may write notes about — not a role tier, and it is the
  // same shape as the `!isAdmin &&` scope check in every staff route. Turning
  // it into a capability would mean inventing a notes-equivalent of
  // forecasting.scope.all, which is registry design, not a migration. Session C
  // migrates existing role checks; it does not invent new restrictions.
  if (caller.role !== "ADMIN") {
    const { storeIds } = await getUserStoreScope()
    if (!member.storeAssignments.some((a) => storeIds.includes(a.storeId))) {
      return fail("Forbidden", 403)
    }
  }

  return { ok: true as const, caller, org }
}
