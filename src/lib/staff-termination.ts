import { clerkClient } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"

// HR-7 rule 1/2: the ONE place a StaffMember is terminated — the manager
// action and the Square INACTIVE reconcile both call this. Terminating never
// deletes anything: the row flips to TERMINATED (all records retained) and
// any Clerk-backed login is cut off on the Clerk side too. The Clerk calls
// are best-effort — /my/* access is enforced server-side on status=ACTIVE
// (getActiveStaffSelf), so access dies immediately even if Clerk revocation
// lags or fails.
export async function terminateStaffMember(
  staff: { id: string; email: string | null; userId: string | null; status: string },
  org: { id: string; clerkOrgId: string }
): Promise<{ terminated: boolean }> {
  if (staff.status === "TERMINATED") return { terminated: false }

  await prisma.staffMember.update({
    where: { id: staff.id },
    data: { status: "TERMINATED", terminatedAt: new Date() },
  })

  const clerk = await clerkClient()

  // Linked login: revoke the org membership (our own webhook handler for
  // organizationMembership.deleted then unlinks StaffMember.userId) and kill
  // every active session so an open phone tab dies too. Membership removal —
  // not a global account ban — because the Clerk account may legitimately
  // exist beyond this tenant.
  if (staff.userId) {
    const user = await prisma.user.findUnique({ where: { id: staff.userId } })
    if (user) {
      try {
        await clerk.organizations.deleteOrganizationMembership({
          organizationId: org.clerkOrgId,
          userId: user.clerkUserId,
        })
      } catch {
        // already removed on the Clerk side — the status gate still holds
      }
      try {
        const sessions = await clerk.sessions.getSessionList({ userId: user.clerkUserId, status: "active" })
        await Promise.all(sessions.data.map((s) => clerk.sessions.revokeSession(s.id)))
      } catch {
        // best-effort; sessions expire on their own and the status gate holds
      }
    }
    // HR-15: unlink here, not just in the organizationMembership.deleted
    // webhook — delivery isn't guaranteed (a terminated member on staging kept
    // a stale userId this way), and a stale link blocks re-invite on rehire.
    // The webhook handler stays as the path for dashboard-initiated removals.
    await prisma.$transaction([
      prisma.staffMember.update({ where: { id: staff.id }, data: { userId: null } }),
      prisma.storeUserAssignment.deleteMany({ where: { userId: staff.userId } }),
    ])
  }

  // A not-yet-accepted self-service invite must not be redeemable after
  // termination: drop our recovery row and revoke the pending Clerk
  // invitation for this email.
  const pendingInvites = await prisma.pendingInvite.findMany({
    where: {
      organizationId: org.id,
      OR: [
        { staffMemberId: staff.id },
        ...(staff.email ? [{ email: { equals: staff.email, mode: "insensitive" as const } }] : []),
      ],
    },
  })
  if (pendingInvites.length > 0) {
    await prisma.pendingInvite.deleteMany({ where: { id: { in: pendingInvites.map((p) => p.id) } } })
    const emails = new Set(pendingInvites.map((p) => p.email.toLowerCase()))
    try {
      const invitations = await clerk.organizations.getOrganizationInvitationList({
        organizationId: org.clerkOrgId,
        status: ["pending"],
      })
      await Promise.all(
        invitations.data
          .filter((i) => emails.has(i.emailAddress.toLowerCase()))
          .map((i) =>
            clerk.organizations.revokeOrganizationInvitation({
              organizationId: org.clerkOrgId,
              invitationId: i.id,
            })
          )
      )
    } catch {
      // best-effort; an accepted-later invite still hits the status gate
    }
  }

  return { terminated: true }
}
