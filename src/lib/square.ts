import { prisma } from "@/lib/prisma"
import type { Organization } from "@prisma/client"

const SQUARE_VERSION = "2024-01-17"

// The OAuth/API host must match the app's environment, and the environment is
// already encoded in the app ID prefix: production IDs start with "sq0idp-",
// sandbox IDs with "sandbox-". Deriving the host from the app ID (rather than a
// separate SQUARE_ENVIRONMENT flag) makes host and credentials impossible to
// mismatch — the failure mode where a production ID hit the sandbox host and
// Square returned 400. SQUARE_ENVIRONMENT is only a fallback for an
// unrecognized ID (e.g. a raw personal-access-token setup with no app ID).
export function squareBaseUrl(): string {
  const appId = (process.env.NEXT_PUBLIC_SQUARE_APP_ID ?? process.env.SQUARE_APPLICATION_ID ?? "").trim()
  let production: boolean
  if (appId.startsWith("sandbox-")) production = false
  else if (appId.startsWith("sq0idp-")) production = true
  else production = (process.env.SQUARE_ENVIRONMENT ?? "sandbox").trim().toLowerCase() === "production"
  return production ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com"
}

// Back-compat alias for internal callers in this file.
const getBaseUrl = squareBaseUrl

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
