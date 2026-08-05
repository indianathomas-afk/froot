import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hrModuleAvailable } from "@/lib/auth"
import { can } from "@/lib/permissions"

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
  const { org, dbUser, actor } = viewer
  if (!org.activeModules.includes("hr")) return fail("HR module is not active", 403)
  if (!dbUser) return fail("Unauthorized", 401)

  // PERM-5C. Was an inline ADMIN||MANAGER check. staff.documents.manage is
  // MANAGE, so the role baseline is unchanged — but the capability had ZERO
  // call sites before this line, which is exactly the state B's ruling 5 calls
  // worse than no toggle. This one edit makes it load-bearing across all five
  // document handlers (list, upload-url, delete, download, and the [docId]
  // GET), because every one of them funnels through here.
  //
  // isAdmin below is STORE SCOPING and stays: it decides WHICH staff members
  // this caller may touch, not whether they may touch documents at all. A
  // capability denial must never widen the scope check.
  const isAdmin = dbUser.role === "ADMIN"
  if (!can(actor, "staff.documents.manage")) {
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
