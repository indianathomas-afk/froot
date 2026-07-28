import { auth, clerkClient } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth"
import { normalizeEmail } from "@/lib/clerk"

// GET: list all org members with their DB user record + store assignments
export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const clerk = await clerkClient()
  const [memberships, org] = await Promise.all([
    clerk.organizations.getOrganizationMembershipList({ organizationId: orgId, limit: 100 }),
    prisma.organization.findUnique({ where: { clerkOrgId: orgId } }),
  ])

  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const dbUsers = await prisma.user.findMany({
    where: { organizationId: org.id },
    include: { storeAssignments: { include: { store: true } } },
  })
  const dbByClerkId = new Map(dbUsers.map((u) => [u.clerkUserId, u]))

  const users = memberships.data.map((m) => {
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

  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

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

    await prisma.pendingInvite.upsert({
      where: { organizationId_email: { organizationId: org.id, email } },
      update: { role, storeIds: inviteStoreIds },
      create: { organizationId: org.id, email, role, storeIds: inviteStoreIds },
    })

    return NextResponse.json({ invitation }, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to invite user"
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
