import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { clearInstagramCache } from "@/lib/instagram"

export async function POST() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  const org = await prisma.organization.update({
    where: { clerkOrgId: orgId },
    data: {
      instagramAccessToken: null,
      instagramTokenExpiresAt: null,
      instagramUserId: null,
      instagramUsername: null,
      instagramEnabled: false,
      instagramConnectedAt: null,
    },
  })

  clearInstagramCache(org.id)

  return NextResponse.json({ success: true })
}
