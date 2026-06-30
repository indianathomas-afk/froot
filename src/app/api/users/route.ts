import { auth, clerkClient } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth"

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
      email: clerkUser?.identifier ?? "",
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

  const { email, role, storeIds } = await req.json()
  const clerk = await clerkClient()

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  try {
    const invitation = await clerk.organizations.createOrganizationInvitation({
      organizationId: orgId,
      emailAddress: email,
      role: role === "ADMIN" ? "org:admin" : "org:member",
      redirectUrl: `${process.env.NEXT_PUBLIC_APP_URL}/sign-up`,
    })

    await prisma.pendingInvite.upsert({
      where: { organizationId_email: { organizationId: org.id, email } },
      update: { role, storeIds: storeIds ?? [] },
      create: { organizationId: org.id, email, role, storeIds: storeIds ?? [] },
    })

    return NextResponse.json({ invitation }, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to invite user"
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
