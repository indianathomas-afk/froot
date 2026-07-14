import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hrModuleAvailable, requireModule } from "@/lib/auth"

// Shared guard for the per-staff HR surfaces (uploaded documents). HR gate
// first (availability → module), then ADMIN org-wide / MANAGER store-scoped,
// then resolve the target staff member within that scope. Out-of-scope or
// unknown members 404 (don't leak existence). Mirrors requireHrDocumentAccess
// + the staff route scope checks in one place.
export async function requireManageableStaff(staffId: string) {
  const fail = (error: string, status: number) =>
    ({ ok: false as const, response: NextResponse.json({ error }, { status }) })

  const { orgId: clerkOrgId } = await auth()
  if (!clerkOrgId) return fail("Unauthorized", 401)
  if (!hrModuleAvailable(clerkOrgId)) return fail("Not found", 404)

  let viewer
  try {
    viewer = await getCurrentUser()
  } catch {
    return fail("Unauthorized", 401)
  }
  const { org, dbUser } = viewer
  if (!org.activeModules.includes("hr")) return fail("HR module is not active", 403)
  if (!dbUser) return fail("Unauthorized", 401)

  const isAdmin = dbUser.role === "ADMIN"
  if (!isAdmin && dbUser.role !== "MANAGER") {
    return fail("Manager or Admin access required", 403)
  }
  const storeIds = dbUser.storeAssignments.map((a) => a.storeId)

  const member = await prisma.staffMember.findFirst({
    where: { id: staffId, organizationId: org.id },
    include: { storeAssignments: { select: { storeId: true } } },
  })
  if (!member) return fail("Staff member not found", 404)
  if (!isAdmin && !member.storeAssignments.some((a) => storeIds.includes(a.storeId))) {
    return fail("Staff member not found", 404)
  }

  return { ok: true as const, org, dbUser, isAdmin, storeIds, member }
}
