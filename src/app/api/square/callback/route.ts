import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state") // clerkOrgId

  if (!code || !state) {
    return NextResponse.redirect(new URL("/settings?error=square_auth_failed", process.env.NEXT_PUBLIC_APP_URL!))
  }

  const env = process.env.SQUARE_ENVIRONMENT ?? "sandbox"
  const baseUrl = env === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com"

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
    return NextResponse.redirect(new URL("/settings?error=square_token_failed", process.env.NEXT_PUBLIC_APP_URL!))
  }

  const tokenData = await tokenRes.json()

  await prisma.organization.update({
    where: { clerkOrgId: state },
    data: {
      squareAccessToken: tokenData.access_token,
      squareRefreshToken: tokenData.refresh_token,
      squareTokenExpiresAt: tokenData.expires_at ? new Date(tokenData.expires_at) : null,
    },
  })

  return NextResponse.redirect(new URL("/settings?success=square_connected", process.env.NEXT_PUBLIC_APP_URL!))
}
