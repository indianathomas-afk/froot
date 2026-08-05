import { auth, clerkClient } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { requireUsersManage } from "./access"
import { NextResponse } from "next/server"
import { fetchAllClerkPages, isClerkErrorPayload, normalizeEmail } from "@/lib/clerk"
import { plusAddress } from "@/lib/device-login"

// isClerkErrorPayload moved to src/lib/clerk.ts on 2026-08-03 so the
// staff-invite route can share it; its DEBT-15 rationale moved with it.

// GET: list all org members with their DB user record + store assignments
export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const access = await requireUsersManage()
  if (!access.ok) return access.response

  const clerk = await clerkClient()
  // DEBT-46 Phase 3 step 1. This is the API twin of /users, which drains the
  // same call — leaving this one capped at 100 would mean the page and its own
  // API disagreed about who is in the org, an inconsistency the page fix would
  // have created. A member past the hundredth is UNREMOVABLE through the UI,
  // and unlike an invitation nothing expires them out of the way.
  const [memberList, org] = await Promise.all([
    fetchAllClerkPages(
      ({ limit, offset }) =>
        clerk.organizations.getOrganizationMembershipList({ organizationId: orgId, limit, offset }),
      { label: `GET /api/users memberships for org ${orgId}`, warnAbove: 100 }
    ),
    prisma.organization.findUnique({ where: { clerkOrgId: orgId } }),
  ])

  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const dbUsers = await prisma.user.findMany({
    where: { organizationId: org.id },
    include: { storeAssignments: { include: { store: true } } },
  })
  const dbByClerkId = new Map(dbUsers.map((u) => [u.clerkUserId, u]))

  const users = memberList.map((m) => {
    const clerkUser = m.publicUserData
    const dbUser = clerkUser?.userId ? dbByClerkId.get(clerkUser.userId) : null
    return {
      clerkMembershipId: m.id,
      clerkUserId: clerkUser?.userId ?? null,
      // BUG-2: identifier may be a username — prefer the self-healed DB email.
      email: dbUser?.email || (clerkUser?.identifier ?? ""),
      name: [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(" ") || null,
      clerkRole: m.role, // org:admin or org:member
      dbUserId: dbUser?.id ?? null,
      role: dbUser?.role ?? "STAFF",
      storeAssignments: dbUser?.storeAssignments ?? [],
      createdAt: m.createdAt,
    }
  })

  const stores = await prisma.store.findMany({
    where: { organizationId: org.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true, storeNumber: true },
  })

  return NextResponse.json({ users, stores })
}

// POST: invite a new member to the org
export async function POST(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const access = await requireUsersManage()
  if (!access.ok) return access.response

  const { email: rawEmail, role, storeIds } = await req.json()
  // Normalized at write time so the webhook's invite lookup matches exactly.
  const email = normalizeEmail(rawEmail)
  if (!email) return NextResponse.json({ error: "Email is required" }, { status: 400 })
  const clerk = await clerkClient()

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  // PERM-6 Task 2, invite half. storeIds went into PendingInvite.storeIds with
  // no ownership check, and the Clerk webhook materialised them later with no
  // re-check — so a foreign-org storeId survived all the way to a real
  // StoreUserAssignment. Checked HERE, before the Clerk invitation is created,
  // so a bad request fails fast at the point of admin intent rather than
  // half-applying silently days later on acceptance. The webhook carries the
  // second half of this check (see webhooks/clerk/route.ts). This route is
  // requireAdmin, so org ownership is the whole rule — admins are unscoped.
  const inviteStoreIds = [
    ...new Set((Array.isArray(storeIds) ? storeIds : []).filter((s: unknown): s is string => typeof s === "string" && s.length > 0)),
  ]
  if (inviteStoreIds.length > 0) {
    const ownedCount = await prisma.store.count({
      where: { id: { in: inviteStoreIds }, organizationId: org.id },
    })
    if (ownedCount !== inviteStoreIds.length) {
      return NextResponse.json({ error: "One or more stores do not belong to this organization" }, { status: 400 })
    }
  }

  try {
    const invitation = await clerk.organizations.createOrganizationInvitation({
      organizationId: orgId,
      emailAddress: email,
      role: role === "ADMIN" ? "org:admin" : "org:member",
      // /accept-invite routes on __clerk_status: existing accounts go to
      // sign-in, new invitees to sign-up — never a dead-ended sign-up.
      redirectUrl: `${process.env.NEXT_PUBLIC_APP_URL}/accept-invite`,
    })

    // PERM-5: invites deliberately carry NO capability overrides — "invite,
    // then edit" is the v1 flow (Gary, 2026-08-04). Overrides on PendingInvite
    // were considered and excluded in the storage analysis because they reopen
    // the churn/restore question this phase settled by putting the set on User.
    // Arrive-dialled-down device provisioning is a scoped future decision.
    await prisma.pendingInvite.upsert({
      where: { organizationId_email: { organizationId: org.id, email } },
      update: { role, storeIds: inviteStoreIds },
      create: { organizationId: org.id, email, role, storeIds: inviteStoreIds },
    })

    return NextResponse.json({ invitation }, { status: 201 })
  } catch (err: unknown) {
    // PERM-7. This used to be `err.message` with a blanket 400, which is what
    // made the collision case fail opaquely — Square's business_email is free
    // text and is NOT unique per location (production has corporate@keva.com on
    // four locations), so provisioning the second device login for a shared
    // address is a routine failure, not an exotic one. Switch on the Clerk
    // error CODE, never the message text: the message is prose Clerk is free to
    // reword. See DECISIONS.md 2026-07-28.
    if (isClerkErrorPayload(err)) {
      const code = err.errors[0]?.code
      if (code === "already_a_member_in_organization") {
        return NextResponse.json(
          {
            error: `${email} already has a login in this organization. Each login needs its own email address — try a plus-address like ${plusAddress(email)}, which Clerk treats as a separate identity.`,
            code,
          },
          { status: 409 }
        )
      }
      if (code === "organization_invitation_not_unique") {
        return NextResponse.json(
          {
            error: `${email} already has an invitation pending for this organization. Resend or revoke it from Clerk before inviting again.`,
            code,
          },
          { status: 409 }
        )
      }
      return NextResponse.json(
        { error: err.errors[0]?.longMessage ?? err.errors[0]?.message ?? "Failed to invite user", code },
        { status: err.status >= 400 && err.status < 500 ? err.status : 400 }
      )
    }
    const msg = err instanceof Error ? err.message : "Failed to invite user"
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
