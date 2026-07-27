import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { getUserStoreScope } from "@/lib/auth"
import { can } from "@/lib/permissions"

export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const { isAdmin, storeIds, role } = await getUserStoreScope()
  // PERM-2 §3 #3: matches the /staff pages (ADMIN/MANAGER). A STAFF-role user
  // has no need for a coworker directory — that information is in Square.
  if (!can({ role }, "staff.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
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

  // PERM-2 §3 #3: this route was entirely unguarded — any org member could
  // create a staff record. Security fix, not a preference.
  const { role } = await getUserStoreScope()
  if (!can({ role }, "staff.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { displayName, fullName, email, storeIds, squareTeamMemberId, primaryStoreId } = await req.json()

  // A manual add types the legal name directly → lock it. A Square import seeds
  // Full Name from Square (squareFullName), unlocked, so a later resync can
  // still track/adopt Square's value until an admin corrects it.
  const cleanFullName = (typeof fullName === "string" && fullName.trim()) || null
  const fromSquare = !!squareTeamMemberId

  const member = await prisma.staffMember.create({
    data: {
      organizationId: org.id,
      displayName,
      fullName: cleanFullName,
      fullNameLocked: !fromSquare && !!cleanFullName,
      squareFullName: fromSquare ? cleanFullName : null,
      email: (typeof email === "string" && email.trim()) || null,
      squareTeamMemberId: squareTeamMemberId || null,
      storeAssignments: {
        create: (storeIds ?? []).map((storeId: string) => ({ storeId, isPrimary: storeId === primaryStoreId })),
      },
    },
    include: { storeAssignments: true },
  })

  return NextResponse.json(member, { status: 201 })
}
