import { auth, clerkClient } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth"

// DELETE: revoke a pending organization invitation
//
// DEBT-46. THE ORDER IS THE FIX, and the reason is asymmetry rather than
// tidiness. This route used to revoke in Clerk FIRST and delete the
// PendingInvite second, on a case-SENSITIVE match, returning { success: true }
// whichever way the delete went. On a mixed-case row that combination destroyed
// the Clerk invitation and left the recovery row behind — an invisible,
// unrevokable ADMIN grant, reported to the admin as a success. The button did
// not merely fail to clean up; it MANUFACTURED the orphan.
//
// Reversed, the two failure modes stop being equivalent:
//
//   Clerk revoke fails after the DB delete   →  row gone, invitation live
//                                            →  acceptance falls back to
//                                               roleMap → STAFF
//                                            →  an admin can fix it
//
//   (the old order) DB delete misses         →  invitation gone, row orphaned
//                                            →  invisible ADMIN grant
//                                            →  needs database access
//
// A silent downgrade an admin can fix beats a silent elevation nobody can see.
//
// NOT WRAPPED IN A TRANSACTION, deliberately (Gary's ruling, R3, 2026-08-03).
// An interactive prisma.$transaction holding a pooled Neon connection open
// across an external Clerk round-trip turns a slow Clerk response into a P2028
// at Prisma's 5s default — on a pooler that already has P1002 advisory-lock
// history. Sequential-with-DB-first buys the ordering property without that.
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

  // Hoisted out of the try and no longer optional. This was `if (org)` around
  // the delete, which is the same defect one layer down: a missing Organization
  // row skipped the cleanup entirely and still reported success.
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  // READ BEFORE ANYTHING MUTATES. The email identifies the recovery row, and
  // under the new ordering it is needed BEFORE the Clerk call rather than
  // handed back by it. Deliberately not taken from the client, which does have
  // it — a destructive where-clause should not be assembled from request input.
  let invitation
  try {
    invitation = await clerk.organizations.getOrganizationInvitation({
      organizationId: orgId,
      invitationId,
    })
  } catch {
    return NextResponse.json({ error: "That invitation no longer exists." }, { status: 404 })
  }

  // /users lists ONLY pending invitations, so a non-pending status here means
  // the invitation changed under the admin between page load and click —
  // someone else revoked it, or it expired. Name which one, rather than letting
  // Clerk's prose through. An expired invitation's PendingInvite is an orphan
  // and is NOT cleaned up on this path: deleting rows on an error return is a
  // hidden destructive side effect, and orphans are their own surface.
  if (invitation.status && invitation.status !== "pending") {
    return NextResponse.json(
      { error: `That invitation is already ${invitation.status} — refresh to see the current list.` },
      { status: 409 }
    )
  }

  // Case-INSENSITIVE, matching the webhook's consume path
  // (webhooks/clerk/route.ts). Rows written before 3c7d0a0 (2026-07-22) may
  // hold mixed-case emails; a case-sensitive match here is precisely what let a
  // live ADMIN grant survive a revoke the admin was told had worked.
  const { count } = await prisma.pendingInvite.deleteMany({
    where: {
      organizationId: org.id,
      email: { equals: invitation.emailAddress, mode: "insensitive" },
    },
  })

  try {
    await clerk.organizations.revokeOrganizationInvitation({
      organizationId: orgId,
      invitationId,
      requestingUserId: userId!,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "unknown error"
    return NextResponse.json(
      {
        error:
          `The invitation was NOT revoked: ${msg}.` +
          (count > 0
            ? " Its stored role grant was already cleared, so accepting it now would land as Staff."
            : ""),
      },
      { status: 400 }
    )
  }

  // count === 0 is reported, not failed — see the route comment above and the
  // note on DEBT-46. An invitation created directly in the Clerk dashboard has
  // no PendingInvite by construction, and refusing to revoke it would be a new
  // silent failure of exactly the kind this change removes.
  return NextResponse.json({ success: true, deletedInvites: count })
}
