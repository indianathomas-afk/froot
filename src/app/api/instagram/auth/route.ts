import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth"
import { instagramRedirectUri } from "@/lib/instagram"

// instagram_business_basic: profile + media read (the only scope v1 needs).
// Requires a Professional (Business/Creator) account; until Meta App Review
// grants Advanced Access, only accounts with a role on the Meta app can connect.
const SCOPE = "instagram_business_basic"

export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  const appId = process.env.INSTAGRAM_APP_ID ?? ""
  const redirectUri = instagramRedirectUri()

  const url = `https://www.instagram.com/oauth/authorize?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${SCOPE}&state=${orgId}`

  return NextResponse.redirect(url)
}
