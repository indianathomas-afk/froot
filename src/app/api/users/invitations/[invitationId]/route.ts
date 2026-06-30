import { auth, clerkClient } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"

// DELETE: revoke a pending organization invitation
export async function DELETE(req: Request, { params }: { params: Promise<{ invitationId: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { invitationId } = await params
  const clerk = await clerkClient()

  try {
    await clerk.organizations.revokeOrganizationInvitation({
      organizationId: orgId,
      invitationId,
      requestingUserId: (await auth()).userId!,
    })
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to revoke invitation"
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
