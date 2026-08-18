import { randomBytes } from "crypto"
import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth"
import { squareBaseUrl, SQUARE_OAUTH_STATE_COOKIE, SQUARE_OAUTH_STATE_COOKIE_OPTIONS } from "@/lib/square"

// ORDERS_READ: sales sync (dashboard + inventory reports)
// EMPLOYEES_READ: team member import (removes the personal-token fallback)
const SCOPES = "MERCHANT_PROFILE_READ ITEMS_READ ORDERS_READ EMPLOYEES_READ TIMECARDS_READ TIMECARDS_SETTINGS_READ"

export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // SEC-1 Part C: connecting Square is org configuration — ADMIN only, same
  // tier as the Instagram equivalent.
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  // SEC-1 Part B: state is a single-use CSRF nonce (double-submit cookie),
  // NOT an org address — the callback resolves the org from the session and
  // rejects unless this exact value comes back in both places.
  const state = randomBytes(32).toString("base64url")

  const appId = process.env.NEXT_PUBLIC_SQUARE_APP_ID ?? ""
  const baseUrl = squareBaseUrl()
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/square/callback`

  const url = `${baseUrl}/oauth2/authorize?client_id=${appId}&scope=${SCOPES}&state=${state}&session=false&redirect_uri=${encodeURIComponent(redirectUri)}`

  const res = NextResponse.redirect(url)
  // 10 minutes: long enough to log into Square and approve, short enough
  // that a stale nonce can't linger.
  res.cookies.set(SQUARE_OAUTH_STATE_COOKIE, state, { ...SQUARE_OAUTH_STATE_COOKIE_OPTIONS, maxAge: 600 })
  return res
}
