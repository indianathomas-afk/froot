import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth"

export async function POST() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // SEC-1 Part C: wiping the org's Square tokens is org configuration —
  // ADMIN only, same tier as the Instagram equivalent.
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

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
