import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { terminateStaffMember } from "@/lib/staff-termination"

// POST /api/staff/[id]/terminate — HR-7 rule 1: mark the staff member
// TERMINATED (never delete; all records retained) and revoke any Clerk-backed
// login. ADMIN org-wide; MANAGER only for staff assigned to one of their own
// stores.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { isAdmin, storeIds, role } = await getUserStoreScope()
  if (!isAdmin && role !== "MANAGER") {
    return NextResponse.json({ error: "Manager or Admin access required" }, { status: 403 })
  }

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const { id } = await params
  const member = await prisma.staffMember.findFirst({
    where: { id, organizationId: org.id },
    include: { storeAssignments: { select: { storeId: true } } },
  })
  // Cross-org or unknown IDs 404 — don't leak existence.
  if (!member) return NextResponse.json({ error: "Staff member not found" }, { status: 404 })
  if (!isAdmin && !member.storeAssignments.some((a) => storeIds.includes(a.storeId))) {
    return NextResponse.json({ error: "Staff member not found" }, { status: 404 })
  }
  if (member.status === "TERMINATED") {
    return NextResponse.json({ error: "Staff member is already terminated" }, { status: 409 })
  }

  await terminateStaffMember(member, org)
  return NextResponse.json({ success: true })
}
