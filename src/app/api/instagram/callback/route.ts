import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { clearInstagramCache, instagramRedirectUri } from "@/lib/instagram"

function settingsRedirect(param: string) {
  return NextResponse.redirect(new URL(`/settings?${param}`, process.env.NEXT_PUBLIC_APP_URL!))
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state") // clerkOrgId

  if (!code || !state) return settingsRedirect("error=instagram_auth_failed")

  // The state param must match the signed-in session's org — blocks a forged
  // callback from attaching someone else's Instagram token to this org.
  const { orgId } = await auth()
  if (!orgId || orgId !== state) return settingsRedirect("error=instagram_auth_failed")

  // 1. code → short-lived token (form-encoded, unlike Square's JSON endpoint)
  const tokenRes = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.INSTAGRAM_APP_ID ?? "",
      client_secret: process.env.INSTAGRAM_APP_SECRET ?? "",
      grant_type: "authorization_code",
      redirect_uri: instagramRedirectUri(),
      code,
    }),
  })
  if (!tokenRes.ok) return settingsRedirect("error=instagram_token_failed")
  const shortLived = await tokenRes.json()

  // 2. short-lived → long-lived token (~60 days, refreshable)
  const longRes = await fetch(
    `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(
      process.env.INSTAGRAM_APP_SECRET ?? ""
    )}&access_token=${encodeURIComponent(shortLived.access_token)}`
  )
  if (!longRes.ok) return settingsRedirect("error=instagram_token_failed")
  const longLived = await longRes.json()

  // 3. profile — user_id + username for the Settings card and page headers
  const meRes = await fetch(
    `https://graph.instagram.com/me?fields=user_id,username&access_token=${encodeURIComponent(longLived.access_token)}`
  )
  if (!meRes.ok) return settingsRedirect("error=instagram_token_failed")
  const me = await meRes.json()

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: state } })
  if (!org) return settingsRedirect("error=instagram_auth_failed")

  await prisma.organization.update({
    where: { clerkOrgId: state },
    data: {
      instagramAccessToken: longLived.access_token,
      instagramTokenExpiresAt: longLived.expires_in ? new Date(Date.now() + longLived.expires_in * 1000) : null,
      instagramUserId: String(me.user_id ?? shortLived.user_id ?? ""),
      instagramUsername: me.username ?? null,
      // Auto-enable on first connect; a reconnect (e.g. after token expiry)
      // preserves whatever the admin's toggle was set to.
      ...(org.instagramConnectedAt ? {} : { instagramEnabled: true }),
      instagramConnectedAt: org.instagramConnectedAt ?? new Date(),
    },
  })

  clearInstagramCache(org.id)

  return settingsRedirect("success=instagram_connected")
}
