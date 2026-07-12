import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { fetchSquareTeamMembers, mapAssignedStores } from "@/lib/square"

export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org?.squareAccessToken) return NextResponse.json({ error: "Square not connected" }, { status: 400 })

  const [teamMembers, existing, stores] = await Promise.all([
    fetchSquareTeamMembers(org),
    prisma.staffMember.findMany({ where: { organizationId: org.id }, select: { squareTeamMemberId: true } }),
    prisma.store.findMany({ where: { organizationId: org.id }, select: { id: true, squareLocationId: true } }),
  ])

  if (!teamMembers) return NextResponse.json({ error: "Unable to fetch team members. TEAM_MEMBERS_READ permission may be required." }, { status: 403 })

  const existingIds = new Set(existing.map((s) => s.squareTeamMemberId).filter(Boolean))

  const members = teamMembers.map((m) => ({
    ...m,
    ...mapAssignedStores(m, stores),
    alreadyImported: existingIds.has(m.id),
  }))

  return NextResponse.json({ members })
}
