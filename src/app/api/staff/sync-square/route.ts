import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { getUserStoreScope } from "@/lib/auth"
import { fetchSquareTeamMembers, mapAssignedStores } from "@/lib/square"
import { terminateStaffMember } from "@/lib/staff-termination"

// Re-syncs every Square-imported staff member from Square:
// - store assignments (Square doesn't expose a home location, so an existing
//   primary is kept as long as it's still among the member's Square-assigned
//   stores; otherwise a primary is only set when Square lists exactly one)
// - email, filled only when ours is empty — never clobbers a manual fix
// - HR-7 rule 2: Square offboards by setting INACTIVE (never hard-deleting),
//   so members reported INACTIVE are TERMINATED here (Clerk login revoked,
//   all records retained — never deleted).
export async function POST() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { isAdmin } = await getUserStoreScope()
  if (!isAdmin) return NextResponse.json({ error: "Admin access required" }, { status: 403 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org?.squareAccessToken) return NextResponse.json({ error: "Square not connected" }, { status: 400 })

  const [teamMembers, inactiveMembers, staff, stores] = await Promise.all([
    fetchSquareTeamMembers(org, "ACTIVE"),
    fetchSquareTeamMembers(org, "INACTIVE"),
    prisma.staffMember.findMany({
      where: { organizationId: org.id, squareTeamMemberId: { not: null } },
      select: {
        id: true,
        squareTeamMemberId: true,
        email: true,
        userId: true,
        status: true,
        storeAssignments: { where: { isPrimary: true }, select: { storeId: true } },
      },
    }),
    prisma.store.findMany({ where: { organizationId: org.id }, select: { id: true, squareLocationId: true } }),
  ])

  if (!teamMembers || !inactiveMembers) {
    return NextResponse.json({ error: "Unable to fetch team members from Square" }, { status: 403 })
  }

  const bySquareId = new Map(teamMembers.map((m) => [m.id, m]))
  const inactiveIds = new Set(inactiveMembers.map((m) => m.id))
  let synced = 0
  let terminated = 0

  for (const member of staff) {
    // Termination reconcile first: an INACTIVE member gets no assignment or
    // email sync — their Froot profile freezes as it was, records retained.
    if (inactiveIds.has(member.squareTeamMemberId as string)) {
      if (member.status !== "TERMINATED") {
        await terminateStaffMember(member, org)
        terminated++
      }
      continue
    }

    const squareMember = bySquareId.get(member.squareTeamMemberId as string)
    if (!squareMember) continue

    if (!member.email && squareMember.email_address) {
      await prisma.staffMember.update({
        where: { id: member.id },
        data: { email: squareMember.email_address },
      })
    }

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

  return NextResponse.json({ success: true, synced, terminated })
}
