import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import {
  getInstagramTokenStatus,
  getRecentInstagramMedia,
  instagramProfileUrl,
} from "@/lib/instagram"

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(24).default(12),
})

// Cached Instagram feed — any authenticated org user may read (the dashboard
// strip shows for every role). Serving from the lib cache keeps us far under
// Instagram's ~200 calls/hour: at most one upstream fetch per TTL window.
export async function GET(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return NextResponse.json({ error: "Invalid query" }, { status: 400 })

  const connected = !!org.instagramAccessToken
  if (!connected || !org.instagramEnabled) {
    return NextResponse.json({ connected, enabled: org.instagramEnabled, username: null, profileUrl: null, posts: [] })
  }

  const posts = await getRecentInstagramMedia(org, parsed.data.limit)

  return NextResponse.json({
    connected: true,
    enabled: true,
    username: org.instagramUsername,
    profileUrl: org.instagramUsername ? instagramProfileUrl(org.instagramUsername) : null,
    tokenStatus: getInstagramTokenStatus(org),
    posts,
  })
}
