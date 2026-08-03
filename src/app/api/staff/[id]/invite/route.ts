import { auth, clerkClient } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { isClerkErrorPayload, normalizeEmail } from "@/lib/clerk"

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
  // the path, there is nothing to invite. Normalized at write time so the
  // webhook's invite lookup matches exactly.
  const email = normalizeEmail(member.email)
  if (!email) {
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
      emailAddress: email,
      role: "org:member",
      // /accept-invite routes on __clerk_status: existing accounts (rehires)
      // go to sign-in, new invitees to sign-up — never a dead-ended sign-up.
      redirectUrl: `${process.env.NEXT_PUBLIC_APP_URL}/accept-invite`,
    })

    // Store assignments mirror the staff member's stores so the resulting
    // User is scoped the same way the staff profile is.
    await prisma.pendingInvite.upsert({
      where: { organizationId_email: { organizationId: org.id, email } },
      update: { role: "STAFF", storeIds: member.storeAssignments.map((a) => a.storeId), staffMemberId: member.id },
      create: {
        organizationId: org.id,
        email,
        role: "STAFF",
        storeIds: member.storeAssignments.map((a) => a.storeId),
        staffMemberId: member.id,
      },
    })

    return NextResponse.json({ invitation: { id: invitation.id, emailAddress: invitation.emailAddress } }, { status: 201 })
  } catch (err: unknown) {
    // DEBT-9 gate walk, 2026-08-03. This catch was:
    //     const msg = err instanceof Error ? err.message : "Failed to send invitation"
    //     return NextResponse.json({ error: msg }, { status: 400 })
    // which rendered Clerk's bare word "Forbidden" beside a Froot button with
    // no attribution. It reads as a Froot authorization failure, and cost
    // twenty minutes spent on this file's ONLY 403 (line 19) — which could not
    // have fired, because the button that calls this route is itself behind
    // the same ADMIN/MANAGER gate that 403 enforces.
    // THE ORIGIN OF AN ERROR IS PART OF THE ERROR.
    //
    // Mirrors POST /api/users (users/route.ts): switch on the Clerk error CODE,
    // never the message text — the message is prose Clerk is free to reword
    // (DECISIONS.md 2026-07-28). A MAPPED code is a known condition and gets
    // Froot's own actionable wording, with `code` preserving the original; an
    // UNMAPPED one is passed through verbatim, because rewording there would
    // discard information we do not have (Gary, 2026-08-03).
    if (isClerkErrorPayload(err)) {
      const code = err.errors[0]?.code
      if (code === "already_a_member_in_organization") {
        return NextResponse.json(
          {
            error: `Clerk: ${email} already has a login in this organization, so it can't be invited again. If this staff member should be that login, the link is missing on our side — their StaffMember.userId is null.`,
            code,
            source: "clerk",
          },
          { status: 409 }
        )
      }
      if (code === "organization_invitation_not_unique") {
        return NextResponse.json(
          {
            error: `Clerk: ${email} already has a pending invitation for this organization. Resend or revoke it in Clerk before inviting again.`,
            code,
            source: "clerk",
          },
          { status: 409 }
        )
      }
      return NextResponse.json(
        {
          error: `Clerk refused this invitation (${code ?? "no code"}): ${
            err.errors[0]?.longMessage ?? err.errors[0]?.message ?? "no message given"
          }`,
          code,
          source: "clerk",
        },
        { status: err.status >= 400 && err.status < 500 ? err.status : 400 }
      )
    }
    // Labelling BOTH sides is the actual fix: a Froot-side throw must not be
    // confusable with a Clerk rejection either, or the next reader repeats the
    // twenty minutes in the opposite direction.
    return NextResponse.json(
      {
        error: `Invitation failed before Clerk accepted it: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
        source: "froot",
      },
      { status: 400 }
    )
  }
}
