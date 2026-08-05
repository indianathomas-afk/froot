import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { fetchSquareTeamMember, mapAssignedStores } from "@/lib/square"
import { terminateStaffMember } from "@/lib/staff-termination"

// POST /api/staff/[id]/resync-square — pull ONE member's current Square record
// and make Square authoritative for this person's Square-linked fields: email,
// store assignments (primary preserved if still among Square's locations, else
// re-inferred), and the LEGAL Full Name unless it's locked (Display Name is
// Froot-native and never overwritten). This is the deliberate,
// per-member counterpart to the conservative bulk "Sync Locations" — a
// manager clicking it is saying "fix this record from Square," so it DOES
// overwrite the email (unlike the bulk sync). It never touches documents,
// training, notes, status, or the login link. If Square reports the member
// INACTIVE, it terminates them (rule 2 — records retained, never deleted).
// ADMIN org-wide; MANAGER only for staff in their stores.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // PERM-5C: was an inline ADMIN||MANAGER check; staff.manage is MANAGE, same
  // baseline. isAdmin below is store scoping and stays. Note this is the
  // PER-MEMBER resync — the bulk one is staff.sync.square (ADMIN), already
  // migrated by DEBT-20. Two capabilities on purpose: an override can take the
  // org-wide Square sync away without taking away fixing one record.
  const { isAdmin, storeIds: scopeStoreIds, actor } = await getUserStoreScope()
  if (!can(actor, "staff.manage")) {
    return NextResponse.json({ error: "Manager or Admin access required" }, { status: 403 })
  }

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org?.squareAccessToken) return NextResponse.json({ error: "Square not connected" }, { status: 400 })

  const { id } = await params
  const member = await prisma.staffMember.findFirst({
    where: { id, organizationId: org.id },
    include: { storeAssignments: { select: { storeId: true, isPrimary: true } } },
  })
  // Cross-org or unknown IDs 404 — don't leak existence.
  if (!member) return NextResponse.json({ error: "Staff member not found" }, { status: 404 })
  if (!isAdmin && !member.storeAssignments.some((a) => scopeStoreIds.includes(a.storeId))) {
    return NextResponse.json({ error: "Staff member not found" }, { status: 404 })
  }
  if (!member.squareTeamMemberId) {
    return NextResponse.json(
      { error: "This member wasn't imported from Square, so there's nothing to resync" },
      { status: 400 }
    )
  }

  const squareMember = await fetchSquareTeamMember(org, member.squareTeamMemberId)
  if (!squareMember) {
    return NextResponse.json(
      { error: "Couldn't find this member in Square. Check the team member still exists there." },
      { status: 404 }
    )
  }

  // Square offboards by setting INACTIVE — reconcile to terminated (rule 2).
  if (squareMember.status === "INACTIVE") {
    if (member.status !== "TERMINATED") {
      await terminateStaffMember(member, org)
    }
    return NextResponse.json({ terminated: true })
  }

  const stores = await prisma.store.findMany({
    where: { organizationId: org.id },
    select: { id: true, squareLocationId: true },
  })
  const { assignedStoreIds, primaryStoreId } = mapAssignedStores(squareMember, stores)
  // Keep a manually-set primary if it survives in Square's location set;
  // otherwise fall back to Square's single-location inference.
  const existingPrimary = member.storeAssignments.find((a) => a.isPrimary)?.storeId
  const primary =
    existingPrimary && assignedStoreIds.includes(existingPrimary) ? existingPrimary : primaryStoreId

  // Square's given+family — the source for Full Name (the LEGAL name) unless the
  // admin has locked a Froot-confirmed value. Always tracked in squareFullName
  // so a lock/Square divergence can be surfaced.
  const squareFullName =
    [squareMember.given_name, squareMember.family_name].filter(Boolean).join(" ") || null

  await prisma.$transaction([
    prisma.staffMember.update({
      where: { id: member.id },
      data: {
        // Display Name is Froot-native/operational — resync NEVER overwrites it
        // (Square seeded it once at import; nicknames/edits survive).
        // Full Name is legal — adopt Square's value only when it isn't locked.
        ...(member.fullNameLocked ? {} : { fullName: squareFullName }),
        squareFullName,
        email: squareMember.email_address || null,
      },
    }),
    prisma.storeStaffAssignment.deleteMany({ where: { staffMemberId: member.id } }),
    prisma.storeStaffAssignment.createMany({
      data: assignedStoreIds.map((storeId) => ({
        staffMemberId: member.id,
        storeId,
        isPrimary: storeId === primary,
      })),
    }),
  ])

  // Locked Full Name that disagrees with Square → escalate (surfaced on the
  // staff profile), never silently overwritten.
  const nameDiverged = member.fullNameLocked && !!squareFullName && squareFullName !== member.fullName
  return NextResponse.json({ success: true, nameDiverged, squareFullName })
}
