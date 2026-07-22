import { auth, clerkClient } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"

// POST /api/staff/[id]/invite — HR-7 route (A): invite a staff member who has
// an email to a Clerk STAFF login for /my/* self-service. Reuses the /users
// invite mechanism (Clerk org invitation + PendingInvite recovery row); the
// Clerk webhook links the new User to this StaffMember on acceptance via
// PendingInvite.staffMemberId. ADMIN org-wide; MANAGER for staff assigned to
// one of their own stores.
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

  // Routing by email presence (A + B hybrid): no email → manager-attested is
  // the path, there is nothing to invite.
  if (!member.email) {
    return NextResponse.json({ error: "Staff member has no email — record completions manager-attested instead" }, { status: 400 })
  }
  if (member.status !== "ACTIVE") {
    return NextResponse.json({ error: "Cannot invite a terminated staff member" }, { status: 409 })
  }
  if (member.userId) {
    return NextResponse.json({ error: "Staff member already has a login" }, { status: 409 })
  }

  const clerk = await clerkClient()
  try {
    const invitation = await clerk.organizations.createOrganizationInvitation({
      organizationId: orgId,
      emailAddress: member.email,
      role: "org:member",
      redirectUrl: `${process.env.NEXT_PUBLIC_APP_URL}/sign-up`,
    })

    // Store assignments mirror the staff member's stores so the resulting
    // User is scoped the same way the staff profile is.
    await prisma.pendingInvite.upsert({
      where: { organizationId_email: { organizationId: org.id, email: member.email } },
      update: { role: "STAFF", storeIds: member.storeAssignments.map((a) => a.storeId), staffMemberId: member.id },
      create: {
        organizationId: org.id,
        email: member.email,
        role: "STAFF",
        storeIds: member.storeAssignments.map((a) => a.storeId),
        staffMemberId: member.id,
      },
    })

    return NextResponse.json({ invitation: { id: invitation.id, emailAddress: invitation.emailAddress } }, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to send invitation"
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
