import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"

export async function POST() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  await prisma.organization.update({
    where: { clerkOrgId: orgId },
    data: {
      squareAccessToken: null,
      squareRefreshToken: null,
      squareTokenExpiresAt: null,
    },
  })

  return NextResponse.redirect(new URL("/settings?success=square_disconnected", process.env.NEXT_PUBLIC_APP_URL!))
}
