import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"

export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org?.squareAccessToken) return NextResponse.json({ error: "Square not connected" }, { status: 400 })

  const env = (process.env.SQUARE_ENVIRONMENT ?? "sandbox").trim().toLowerCase()
  const baseUrl = env === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com"

  // Try the OAuth token first; fall back to the personal access token if scope is insufficient
  const tokens = [org.squareAccessToken, process.env.SQUARE_ACCESS_TOKEN].filter(Boolean) as string[]

  let data: Record<string, unknown> | null = null
  for (const token of tokens) {
    const res = await fetch(`${baseUrl}/v2/team-members/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Square-Version": "2024-01-17",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: { filter: { status: "ACTIVE" } } }),
    })

    if (res.ok) {
      data = await res.json()
      break
    }
  }

  if (!data) return NextResponse.json({ error: "Unable to fetch team members. TEAM_MEMBERS_READ permission may be required." }, { status: 403 })

  const existingIds = new Set(
    (await prisma.staffMember.findMany({ where: { organizationId: org.id }, select: { squareTeamMemberId: true } }))
      .map((s) => s.squareTeamMemberId)
      .filter(Boolean)
  )

  const members = ((data.team_members as Record<string, unknown>[]) ?? []).map((m) => ({
    ...m,
    alreadyImported: existingIds.has(m.id as string),
  }))

  return NextResponse.json({ members })
}
