import { prisma } from "@/lib/prisma"
import type { Organization } from "@prisma/client"

// Instagram API with Instagram Login (graph.instagram.com) — the read-only
// successor to the retired Basic Display API. The connected account must be a
// Professional (Business or Creator) account. Rate limit is ~200 calls/hour
// per account, so nothing here runs on page load without the cache below.

const GRAPH_BASE = "https://graph.instagram.com"

export type InstagramMedia = {
  id: string
  caption?: string
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM"
  media_url?: string
  permalink: string
  thumbnail_url?: string
  timestamp: string
}

export type InstagramTokenStatus = "ok" | "reconnect_required" | "not_connected"

export function instagramRedirectUri(): string {
  // `||` not `??` — the .env template ships the var as an empty string.
  return process.env.INSTAGRAM_REDIRECT_URI || `${process.env.NEXT_PUBLIC_APP_URL}/api/instagram/callback`
}

export function instagramProfileUrl(username: string): string {
  return `https://www.instagram.com/${username}/`
}

// ─── Feed cache ───────────────────────────────────────────────────────────────
// media_url links point at the IG CDN and expire after a while (permalink is
// the only stable URL), so the feed is cached short-term and re-fetched — never
// persisted. In-memory is fine on Vercel: a cold instance just refetches once.

const FEED_TTL_MS = 60 * 60 * 1000 // ~60 min — well under media_url lifetime
const FEED_FETCH_LIMIT = 24 // one fetch covers the dashboard strip and the grid

type FeedCacheEntry = { fetchedAt: number; media: InstagramMedia[] }
const feedCache = new Map<string, FeedCacheEntry>()

// Orgs whose token was rejected by Instagram (401/OAuthException) since the
// last successful call — surfaced as tokenStatus so Settings can show a
// reconnect nudge before the stored expiry date has even passed.
const reconnectRequired = new Set<string>()

export function clearInstagramCache(orgId: string) {
  feedCache.delete(orgId)
  reconnectRequired.delete(orgId)
}

// ─── Token status + lazy refresh ─────────────────────────────────────────────

export function getInstagramTokenStatus(org: Organization): InstagramTokenStatus {
  if (!org.instagramAccessToken) return "not_connected"
  if (reconnectRequired.has(org.id)) return "reconnect_required"
  if (org.instagramTokenExpiresAt && org.instagramTokenExpiresAt <= new Date()) return "reconnect_required"
  return "ok"
}

// Long-lived tokens last ~60 days and can be refreshed once they're 24h old.
// Same lazy-refresh shape as square.ts: refresh when within 7 days of expiry,
// and on failure keep the existing token — the API call will surface a 401.
export async function refreshInstagramTokenIfNeeded(org: Organization): Promise<Organization> {
  if (!org.instagramAccessToken || !org.instagramTokenExpiresAt) return org

  const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  if (org.instagramTokenExpiresAt > sevenDaysFromNow) return org

  const url = `${GRAPH_BASE}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(org.instagramAccessToken)}`
  const res = await fetch(url)

  if (!res.ok) {
    if (org.instagramTokenExpiresAt <= new Date()) reconnectRequired.add(org.id)
    return org
  }

  const data = await res.json()
  reconnectRequired.delete(org.id)
  return prisma.organization.update({
    where: { id: org.id },
    data: {
      instagramAccessToken: data.access_token,
      instagramTokenExpiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
    },
  })
}

// ─── API calls ────────────────────────────────────────────────────────────────

async function igGet(org: Organization, path: string, query: string): Promise<Record<string, unknown> | null> {
  if (!org.instagramAccessToken) return null
  const freshOrg = await refreshInstagramTokenIfNeeded(org)
  const url = `${GRAPH_BASE}/${path}?${query}&access_token=${encodeURIComponent(freshOrg.instagramAccessToken!)}`
  const res = await fetch(url)
  if (res.status === 401 || res.status === 403 || res.status === 400) {
    // Expired/revoked token — Instagram reports OAuth errors as 400s too.
    const body = await res.json().catch(() => null)
    const type = body && typeof body === "object" ? (body as { error?: { type?: string } }).error?.type : undefined
    if (res.status !== 400 || type === "OAuthException") reconnectRequired.add(org.id)
    return null
  }
  if (!res.ok) return null
  reconnectRequired.delete(org.id)
  return res.json()
}

export async function getInstagramProfile(org: Organization): Promise<{ userId: string; username: string } | null> {
  const data = await igGet(org, "me", "fields=user_id,username")
  if (!data || typeof data.username !== "string") return null
  return { userId: String(data.user_id ?? ""), username: data.username }
}

// Cached recent media. On fetch failure the last cached feed is served even
// past its TTL (stale beats a crashed card); [] only when there's nothing at all.
export async function getRecentInstagramMedia(org: Organization, limit: number): Promise<InstagramMedia[]> {
  const cached = feedCache.get(org.id)
  if (cached && Date.now() - cached.fetchedAt < FEED_TTL_MS) {
    return cached.media.slice(0, limit)
  }

  const data = await igGet(
    org,
    "me/media",
    `fields=id,caption,media_type,media_url,permalink,thumbnail_url,timestamp&limit=${FEED_FETCH_LIMIT}`
  )
  const media = data && Array.isArray(data.data) ? (data.data as InstagramMedia[]) : null

  if (media) {
    feedCache.set(org.id, { fetchedAt: Date.now(), media })
    return media.slice(0, limit)
  }

  return cached ? cached.media.slice(0, limit) : []
}
