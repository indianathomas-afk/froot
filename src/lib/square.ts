import { prisma } from "@/lib/prisma"
import type { Organization } from "@prisma/client"

const SQUARE_VERSION = "2024-01-17"

// SEC-1: the OAuth state nonce travels as a double-submit httpOnly cookie —
// set by /api/square/auth, required and cleared by /api/square/callback.
// Shared here so the two routes can never drift on the name or attributes.
export const SQUARE_OAUTH_STATE_COOKIE = "square_oauth_state"
export const SQUARE_OAUTH_STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  // Only the callback ever needs to read it back.
  path: "/api/square/callback",
} as const

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

// SQ-2: Square issues access tokens with a 30-day life and its guidance is to
// refresh every 7 days or less. Only squareTokenExpiresAt is stored — there is
// no issuedAt column — so "older than 7 days" is derived from the expiry:
// 30 − 7 = 23 days of remaining life. The previous guard did the opposite, only
// firing inside 7 days of expiry, which let the token reach 23 days old and
// compressed every retry opportunity into the final week before the cliff.
const SQUARE_TOKEN_LIFETIME_DAYS = 30
const REFRESH_WHEN_OLDER_THAN_DAYS = 7
const REFRESH_WHEN_EXPIRING_WITHIN_DAYS = SQUARE_TOKEN_LIFETIME_DAYS - REFRESH_WHEN_OLDER_THAN_DAYS

// Square's OAuth error bodies describe fields, not values — but the body is not
// ours to guarantee, and the refresh request carries three secrets. Redact any
// that come back in an echo so no code path can put a credential in the logs.
function redactSquareSecrets(text: string, orgRefreshToken: string | null): string {
  const secrets = [orgRefreshToken, process.env.SQUARE_APPLICATION_SECRET, process.env.SQUARE_ACCESS_TOKEN]
  let out = text
  for (const s of secrets) if (s && s.length >= 8) out = out.split(s).join("[REDACTED]")
  return out
}

async function refreshTokenIfNeeded(org: Organization): Promise<Organization> {
  if (!org.squareRefreshToken || !org.squareTokenExpiresAt) return org

  const refreshWhenExpiringBefore = new Date(Date.now() + REFRESH_WHEN_EXPIRING_WITHIN_DAYS * 24 * 60 * 60 * 1000)
  if (org.squareTokenExpiresAt > refreshWhenExpiringBefore) return org

  // SQ-2: all three outcomes are logged, and none of them log a token value —
  // expiry timestamps, org identity and HTTP status only.
  const expiresAtBefore = org.squareTokenExpiresAt.toISOString()
  console.info(`[square] token refresh attempt org=${org.id} name="${org.name}" expiresAt=${expiresAtBefore}`)

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
  // caller's Square request will surface a 401 if it's truly expired. Control
  // flow is unchanged; SQ-2 only made the failure say why. Truncated because a
  // Square gateway error returns an HTML page, not JSON.
  if (!res.ok) {
    const body = await res.text().catch(() => "<unreadable>")
    console.error(
      `[square] token refresh FAILED org=${org.id} status=${res.status} expiresAt=${expiresAtBefore} ` +
        `body=${redactSquareSecrets(body, org.squareRefreshToken).slice(0, 500)}`
    )
    return org
  }

  const data = await res.json()
  const refreshed = await prisma.organization.update({
    where: { id: org.id },
    data: {
      squareAccessToken: data.access_token,
      squareRefreshToken: data.refresh_token,
      squareTokenExpiresAt: data.expires_at ? new Date(data.expires_at) : null,
    },
  })
  console.info(
    `[square] token refresh success org=${org.id} expiresAt=${expiresAtBefore} -> ` +
      `${refreshed.squareTokenExpiresAt?.toISOString() ?? "null"}`
  )
  return refreshed
}

export type SquareTeamMember = {
  id: string
  display_name?: string
  given_name?: string
  family_name?: string
  email_address?: string
  assigned_locations?: {
    assignment_type?: "ALL_CURRENT_AND_FUTURE_LOCATIONS" | "EXPLICIT_LOCATIONS"
    location_ids?: string[]
  }
}

// Fetches team members by status, trying the org OAuth token first and
// falling back to the personal access token if the OAuth scope is
// insufficient. Square offboards by setting INACTIVE (never hard-deleting),
// so the HR-7 termination reconcile reads that status explicitly — the search
// filter accepts a single status per call. Follows the cursor so rosters over
// 200 paginate. Returns null if neither token can read team members.
export async function fetchSquareTeamMembers(
  org: Organization,
  status: "ACTIVE" | "INACTIVE" = "ACTIVE"
): Promise<SquareTeamMember[] | null> {
  const tokens = [org.squareAccessToken, process.env.SQUARE_ACCESS_TOKEN].filter(Boolean) as string[]

  for (const token of tokens) {
    const members: SquareTeamMember[] = []
    let cursor: string | undefined
    let failed = false
    do {
      const res = await fetch(`${getBaseUrl()}/v2/team-members/search`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Square-Version": SQUARE_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: { filter: { status } }, limit: 200, ...(cursor ? { cursor } : {}) }),
      })
      if (!res.ok) {
        failed = true
        break
      }
      const data = await res.json()
      members.push(...((data.team_members as SquareTeamMember[]) ?? []))
      cursor = data.cursor
    } while (cursor)
    if (!failed) return members
  }
  return null
}

// Retrieves ONE team member by Square id (GET /v2/team-members/{id}), which
// returns the member regardless of ACTIVE/INACTIVE status — used by the
// per-member resync so a manager can pull a corrected email/name/locations
// (or detect an offboard) for a single person. Tries the org OAuth token,
// then the personal token. Returns null on any failure or if the id is
// unknown to Square.
export async function fetchSquareTeamMember(
  org: Organization,
  teamMemberId: string
): Promise<(SquareTeamMember & { status?: string }) | null> {
  const tokens = [org.squareAccessToken, process.env.SQUARE_ACCESS_TOKEN].filter(Boolean) as string[]

  for (const token of tokens) {
    const res = await fetch(`${getBaseUrl()}/v2/team-members/${teamMemberId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Square-Version": SQUARE_VERSION,
      },
    })
    if (res.ok) {
      const data = await res.json()
      return (data.team_member as SquareTeamMember & { status?: string }) ?? null
    }
  }
  return null
}

// The Square location fields Froot mirrors onto a Store. Deliberately the same
// set the import dialog maps, so import and resync cannot drift apart.
export type SquareLocationRecord = {
  id?: string
  name?: string
  address?: { address_line_1?: string; locality?: string; administrative_district_level_1?: string }
  phone_number?: string
  timezone?: string
  business_email?: string
  status?: string
}

// Fetches ONE location by Square location id (GET /v2/locations/{id}) for the
// per-store "Resync from Square" action — the counterpart to
// fetchSquareTeamMember. Tries the org OAuth token, then the personal one.
// Returns null on any failure, including a location deleted in Square.
export async function fetchSquareLocation(
  org: Organization,
  locationId: string
): Promise<SquareLocationRecord | null> {
  const tokens = [org.squareAccessToken, process.env.SQUARE_ACCESS_TOKEN].filter(Boolean) as string[]

  for (const token of tokens) {
    const res = await fetch(`${getBaseUrl()}/v2/locations/${locationId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Square-Version": SQUARE_VERSION,
      },
    })
    if (res.ok) {
      const data = await res.json()
      return (data.location as SquareLocationRecord) ?? null
    }
  }
  return null
}

// Writes a corrected LEGAL name back to Square (PUT /v2/team-members/{id}).
// Splits "First Rest" → given_name / family_name (naive; multi-part surnames or
// mononyms land in family_name / given_name respectively). Returns the updated
// member, or null on any failure. Tries the org OAuth token, then the personal.
export async function updateSquareTeamMemberName(
  org: Organization,
  teamMemberId: string,
  fullName: string
): Promise<SquareTeamMember | null> {
  const parts = fullName.trim().split(/\s+/)
  const given = parts.length > 1 ? parts[0] : ""
  const family = parts.length > 1 ? parts.slice(1).join(" ") : parts[0] ?? ""
  const body = JSON.stringify({ team_member: { given_name: given, family_name: family } })
  const tokens = [org.squareAccessToken, process.env.SQUARE_ACCESS_TOKEN].filter(Boolean) as string[]

  for (const token of tokens) {
    const res = await fetch(`${getBaseUrl()}/v2/team-members/${teamMemberId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Square-Version": SQUARE_VERSION,
        "Content-Type": "application/json",
      },
      body,
    })
    if (res.ok) {
      const data = await res.json()
      return (data.team_member as SquareTeamMember) ?? null
    }
  }
  return null
}

// Maps a Square team member's assigned locations onto the org's stores.
// Square has no primary/home-location concept — location_ids come back in
// arbitrary (alphabetical) order — so a primary is only inferred when the
// member has exactly one explicit location. ALL_CURRENT_AND_FUTURE_LOCATIONS
// means access everywhere, with no single home store to infer.
export function mapAssignedStores(
  member: SquareTeamMember,
  stores: { id: string; squareLocationId: string | null }[]
): { assignedStoreIds: string[]; primaryStoreId: string | null; allLocations: boolean } {
  const assigned = member.assigned_locations
  const allLocations = assigned?.assignment_type === "ALL_CURRENT_AND_FUTURE_LOCATIONS" || !assigned
  if (allLocations) {
    return { assignedStoreIds: stores.filter((s) => s.squareLocationId).map((s) => s.id), primaryStoreId: null, allLocations: true }
  }
  const byLocation = new Map(stores.filter((s) => s.squareLocationId).map((s) => [s.squareLocationId as string, s.id]))
  const assignedStoreIds = (assigned?.location_ids ?? []).map((lid) => byLocation.get(lid)).filter(Boolean) as string[]
  return { assignedStoreIds, primaryStoreId: assignedStoreIds.length === 1 ? assignedStoreIds[0] : null, allLocations: false }
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
