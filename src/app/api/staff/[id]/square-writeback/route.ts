import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { updateSquareTeamMemberName } from "@/lib/square"

// POST /api/staff/[id]/square-writeback — push this member's Froot-confirmed
// LEGAL Full Name back to Square (given_name/family_name), then lock it and
// mark squareFullName in sync. The reverse of resync: here Froot is the source
// of truth. ADMIN org-wide; MANAGER only for staff in their stores. Requires
// Square connected + a Square-linked member with a Full Name set.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { isAdmin, storeIds: scopeStoreIds, role } = await getUserStoreScope()
  if (!isAdmin && role !== "MANAGER") {
    return NextResponse.json({ error: "Manager or Admin access required" }, { status: 403 })
  }

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org?.squareAccessToken) {
    return NextResponse.json({ error: "Square not connected" }, { status: 400 })
  }

  const { id } = await params
  const member = await prisma.staffMember.findFirst({
    where: { id, organizationId: org.id },
    include: { storeAssignments: { select: { storeId: true } } },
  })
  if (!member) return NextResponse.json({ error: "Staff member not found" }, { status: 404 })
  if (!isAdmin && !member.storeAssignments.some((a) => scopeStoreIds.includes(a.storeId))) {
    return NextResponse.json({ error: "Staff member not found" }, { status: 404 })
  }
  if (!member.squareTeamMemberId) {
    return NextResponse.json({ error: "This member isn't linked to Square" }, { status: 400 })
  }
  const legalName = member.fullName?.trim()
  if (!legalName) {
    return NextResponse.json({ error: "Set a legal Full Name before writing it back" }, { status: 400 })
  }

  const updated = await updateSquareTeamMemberName(org, member.squareTeamMemberId, legalName)
  if (!updated) {
    return NextResponse.json(
      { error: "Square rejected the update — check the connection and try again." },
      { status: 502 }
    )
  }

  // Square now matches: lock the legal name and record what Square holds.
  await prisma.staffMember.update({
    where: { id: member.id },
    data: { fullNameLocked: true, squareFullName: legalName },
  })
  return NextResponse.json({ success: true, wroteBack: legalName })
}
