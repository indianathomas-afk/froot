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

  const res = await fetch(`${baseUrl}/v2/locations`, {
    headers: { Authorization: `Bearer ${org.squareAccessToken}`, "Square-Version": "2024-01-17" },
  })

  if (!res.ok) return NextResponse.json({ error: "Square API error" }, { status: 500 })

  const data = await res.json()
  const existingIds = new Set(
    (await prisma.store.findMany({ where: { organizationId: org.id }, select: { squareLocationId: true } }))
      .map((s) => s.squareLocationId)
      .filter(Boolean)
  )

  const locations = (data.locations ?? []).map((loc: Record<string, unknown>) => ({
    ...loc,
    alreadyImported: existingIds.has(loc.id as string),
  }))

  return NextResponse.json({ locations })
}
