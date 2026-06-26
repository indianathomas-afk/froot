import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"

export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org?.squareAccessToken) return NextResponse.json({ error: "Square not connected" }, { status: 400 })

  const env = process.env.SQUARE_ENVIRONMENT ?? "sandbox"
  const baseUrl = env === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com"

  const res = await fetch(`${baseUrl}/v2/team-members`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${org.squareAccessToken}`,
      "Square-Version": "2024-01-17",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: { filter: { status: "ACTIVE" } } }),
  })

  if (!res.ok) return NextResponse.json({ error: "Square API error" }, { status: 500 })

  const data = await res.json()
  const existingIds = new Set(
    (await prisma.staffMember.findMany({ where: { organizationId: org.id }, select: { squareTeamMemberId: true } }))
      .map((s) => s.squareTeamMemberId)
      .filter(Boolean)
  )

  const members = (data.team_members ?? []).map((m: Record<string, unknown>) => ({
    ...m,
    alreadyImported: existingIds.has(m.id as string),
  }))

  return NextResponse.json({ members })
}
