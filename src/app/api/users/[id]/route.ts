import { auth, clerkClient } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth"

// PATCH: update role and/or store assignments for a DB user
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const { role, storeIds } = await req.json()

  const user = await prisma.user.update({
    where: { id, organizationId: org.id },
    data: {
      role,
      storeAssignments: {
        deleteMany: {},
        create: (storeIds ?? []).map((storeId: string) => ({ storeId })),
      },
    },
    include: { storeAssignments: { include: { store: true } } },
  })

  return NextResponse.json(user)
}

// DELETE: remove a member from the org and delete their Clerk account
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params // this is the Clerk user ID
  const clerk = await clerkClient()

  try {
    await clerk.organizations.deleteOrganizationMembership({ organizationId: orgId, userId: id })
  } catch {
    // membership may not exist; continue
  }

  try {
    await clerk.users.deleteUser(id)
  } catch {
    // user may not exist or may belong to another org; continue
  }

  // Also remove from DB if present
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (org) {
    await prisma.user.deleteMany({ where: { clerkUserId: id, organizationId: org.id } })
  }

  return NextResponse.json({ success: true })
}
