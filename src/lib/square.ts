import { prisma } from "@/lib/prisma"
import type { Organization } from "@prisma/client"

const SQUARE_VERSION = "2024-01-17"

function getBaseUrl() {
  const env = (process.env.SQUARE_ENVIRONMENT ?? "sandbox").trim().toLowerCase()
  return env === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com"
}

async function refreshTokenIfNeeded(org: Organization): Promise<Organization> {
  if (!org.squareRefreshToken || !org.squareTokenExpiresAt) return org

  const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  if (org.squareTokenExpiresAt > sevenDaysFromNow) return org

  const res = await fetch(`${getBaseUrl()}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Square-Version": SQUARE_VERSION },
    body: JSON.stringify({
      client_id: process.env.SQUARE_APPLICATION_ID,
      client_secret: process.env.SQUARE_APPLICATION_SECRET,
      refresh_token: org.squareRefreshToken,
      grant_type: "refresh_token",
    }),
  })

  // If refresh fails, keep the existing (possibly still-valid) token — the
  // caller's Square request will surface a 401 if it's truly expired.
  if (!res.ok) return org

  const data = await res.json()
  return prisma.organization.update({
    where: { id: org.id },
    data: {
      squareAccessToken: data.access_token,
      squareRefreshToken: data.refresh_token,
      squareTokenExpiresAt: data.expires_at ? new Date(data.expires_at) : null,
    },
  })
}

export async function getSquareClient(org: Organization) {
  if (!org.squareAccessToken) throw new Error("SQUARE_NOT_CONNECTED")

  const freshOrg = await refreshTokenIfNeeded(org)

  return {
    baseUrl: getBaseUrl(),
    headers: {
      Authorization: `Bearer ${freshOrg.squareAccessToken}`,
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
    },
    org: freshOrg,
  }
}
