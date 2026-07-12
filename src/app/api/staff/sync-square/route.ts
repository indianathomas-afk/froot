import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { getUserStoreScope } from "@/lib/auth"
import { fetchSquareTeamMembers, mapAssignedStores } from "@/lib/square"

// Re-syncs every Square-imported staff member's store assignments from Square.
// Square doesn't expose a home location, so an existing primary is kept as long
// as it's still among the member's Square-assigned stores; otherwise a primary
// is only set when Square lists exactly one location.
export async function POST() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { isAdmin } = await getUserStoreScope()
  if (!isAdmin) return NextResponse.json({ error: "Admin access required" }, { status: 403 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org?.squareAccessToken) return NextResponse.json({ error: "Square not connected" }, { status: 400 })

  const [teamMembers, staff, stores] = await Promise.all([
    fetchSquareTeamMembers(org),
    prisma.staffMember.findMany({
      where: { organizationId: org.id, squareTeamMemberId: { not: null } },
      select: { id: true, squareTeamMemberId: true, storeAssignments: { where: { isPrimary: true }, select: { storeId: true } } },
    }),
    prisma.store.findMany({ where: { organizationId: org.id }, select: { id: true, squareLocationId: true } }),
  ])

  if (!teamMembers) return NextResponse.json({ error: "Unable to fetch team members from Square" }, { status: 403 })

  const bySquareId = new Map(teamMembers.map((m) => [m.id, m]))
  let synced = 0

  for (const member of staff) {
    const squareMember = bySquareId.get(member.squareTeamMemberId as string)
    if (!squareMember) continue

    const { assignedStoreIds, primaryStoreId } = mapAssignedStores(squareMember, stores)
    const existingPrimary = member.storeAssignments[0]?.storeId
    const primary =
      existingPrimary && assignedStoreIds.includes(existingPrimary) ? existingPrimary : primaryStoreId
    await prisma.$transaction([
      prisma.storeStaffAssignment.deleteMany({ where: { staffMemberId: member.id } }),
      prisma.storeStaffAssignment.createMany({
        data: assignedStoreIds.map((storeId) => ({
          staffMemberId: member.id,
          storeId,
          isPrimary: storeId === primary,
        })),
      }),
    ])
    synced++
  }

  return NextResponse.json({ success: true, synced })
}
