import { auth, clerkClient } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth"

// DELETE: revoke a pending organization invitation
export async function DELETE(req: Request, { params }: { params: Promise<{ invitationId: string }> }) {
  const { orgId, userId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { invitationId } = await params
  const clerk = await clerkClient()

  try {
    const invitation = await clerk.organizations.revokeOrganizationInvitation({
      organizationId: orgId,
      invitationId,
      requestingUserId: userId!,
    })

    const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
    if (org) {
      await prisma.pendingInvite.deleteMany({
        where: { organizationId: org.id, email: invitation.emailAddress },
      })
    }

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to revoke invitation"
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
