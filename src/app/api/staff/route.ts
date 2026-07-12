import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { getUserStoreScope } from "@/lib/auth"

export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const { isAdmin, storeIds } = await getUserStoreScope()
  const staff = await prisma.staffMember.findMany({
    where: {
      organizationId: org.id,
      ...(isAdmin ? {} : { storeAssignments: { some: { storeId: { in: storeIds } } } }),
    },
    include: { storeAssignments: { include: { store: true } } },
    orderBy: { displayName: "asc" },
  })

  return NextResponse.json(staff)
}

export async function POST(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const { displayName, fullName, email, storeIds, squareTeamMemberId, primaryStoreId } = await req.json()

  const member = await prisma.staffMember.create({
    data: {
      organizationId: org.id,
      displayName,
      fullName: fullName || null,
      email: email || null,
      squareTeamMemberId: squareTeamMemberId || null,
      storeAssignments: {
        create: (storeIds ?? []).map((storeId: string) => ({ storeId, isPrimary: storeId === primaryStoreId })),
      },
    },
    include: { storeAssignments: true },
  })

  return NextResponse.json(member, { status: 201 })
}
