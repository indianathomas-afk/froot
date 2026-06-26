import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"

export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({
    where: { clerkOrgId: orgId },
    select: { squareAccessToken: true, squareTokenExpiresAt: true },
  })

  return NextResponse.json({
    connected: !!org?.squareAccessToken,
    expiresAt: org?.squareTokenExpiresAt,
  })
}
