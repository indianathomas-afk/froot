import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getInstagramTokenStatus } from "@/lib/instagram"

export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  return NextResponse.json({
    connected: !!org.instagramAccessToken,
    enabled: org.instagramEnabled,
    username: org.instagramUsername,
    tokenStatus: getInstagramTokenStatus(org),
  })
}
