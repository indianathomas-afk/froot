import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"

const SCOPES = "MERCHANT_PROFILE_READ TEAM_MEMBERS_READ"

export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const appId = process.env.NEXT_PUBLIC_SQUARE_APP_ID ?? ""
  const env = process.env.SQUARE_ENVIRONMENT ?? "sandbox"
  const baseUrl = env === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com"

  const url = `${baseUrl}/oauth2/authorize?client_id=${appId}&scope=${encodeURIComponent(SCOPES)}&state=${orgId}&session=false`

  return NextResponse.redirect(url)
}
