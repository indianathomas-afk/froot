import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  getOrganization,
  getUserStoreScope,
  hrModuleAvailable,
  requireManagerOrAdmin,
  requireModule,
} from "@/lib/auth"

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

  let caller
  try {
    caller = await requireManagerOrAdmin()
  } catch {
    return fail("Manager or Admin access required", 403)
  }

  const org = await getOrganization()
  const member = await prisma.staffMember.findFirst({
    where: { id: staffId, organizationId: org.id },
    include: { storeAssignments: true },
  })
  // Cross-org or unknown staff IDs 404 rather than 403 — don't leak existence.
  if (!member) return fail("Staff member not found", 404)

  if (caller.role !== "ADMIN") {
    const { storeIds } = await getUserStoreScope()
    if (!member.storeAssignments.some((a) => storeIds.includes(a.storeId))) {
      return fail("Forbidden", 403)
    }
  }

  return { ok: true as const, caller, org }
}
