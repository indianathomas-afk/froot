import { auth } from "@clerk/nextjs/server"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { squareBaseUrl, SQUARE_OAUTH_STATE_COOKIE, SQUARE_OAUTH_STATE_COOKIE_OPTIONS } from "@/lib/square"

// SEC-1: the state cookie is single-use — it dies on EVERY callback hit,
// success or failure, so a nonce can never be presented twice.
function settingsRedirect(param: string) {
  const res = NextResponse.redirect(new URL(`/settings?${param}`, process.env.NEXT_PUBLIC_APP_URL!))
  res.cookies.set(SQUARE_OAUTH_STATE_COOKIE, "", { ...SQUARE_OAUTH_STATE_COOKIE_OPTIONS, maxAge: 0 })
  return res
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")

  // SEC-1 Part A: the SESSION decides which org receives the tokens — state
  // is never a write address (one step past Instagram's equality check: a
  // forged state can't misdirect anything because it addresses nothing).
  // No session, no exchange.
  const { orgId } = await auth()
  if (!orgId) return settingsRedirect("error=square_auth_failed")

  // SEC-1 Part B: double-submit nonce. The state param must exactly match
  // the httpOnly cookie minted by /api/square/auth (crypto-random, 10-min
  // TTL via Max-Age). Missing, expired, or mismatched → reject before any
  // token exchange.
  const stateCookie = (await cookies()).get(SQUARE_OAUTH_STATE_COOKIE)?.value
  if (!code || !state || !stateCookie || state !== stateCookie) {
    return settingsRedirect("error=square_auth_failed")
  }

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return settingsRedirect("error=square_auth_failed")

  const baseUrl = squareBaseUrl()

  const tokenRes = await fetch(`${baseUrl}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Square-Version": "2024-01-17" },
    body: JSON.stringify({
      client_id: process.env.SQUARE_APPLICATION_ID,
      client_secret: process.env.SQUARE_APPLICATION_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/square/callback`,
    }),
  })

  if (!tokenRes.ok) {
    return settingsRedirect("error=square_token_failed")
  }

  const tokenData = await tokenRes.json()

  await prisma.organization.update({
    where: { clerkOrgId: orgId },
    data: {
      squareAccessToken: tokenData.access_token,
      squareRefreshToken: tokenData.refresh_token,
      squareTokenExpiresAt: tokenData.expires_at ? new Date(tokenData.expires_at) : null,
    },
  })

  return settingsRedirect("success=square_connected")
}
