// ─────────────────────────────────────────────────────────────────────────────
// ENG-1 — ENGAGEMENT TRACKING, the pure half.
//
// Gary, 2026-08-30. PURE MODULE, NO SERVER IMPORTS — the same discipline
// src/lib/device-login.ts states at its top and for the same reason: the beacon
// route, the cron, the page and the fixture all read from here, and one `import
// { prisma }` would poison every one of those bundles and make the fixture
// database-backed for no gain. Nothing below touches Prisma, Clerk, or headers.
//
// THE LOAD-BEARING CLAIM OF THIS WHOLE PHASE LIVES IN normalizePath(). See its
// comment — if that function stops being total, UsageDaily stops being bounded.
// ─────────────────────────────────────────────────────────────────────────────

import { DEFAULT_TIME_ZONE } from "@/lib/hr"
import { localDateStr, dbDate } from "@/lib/reports"

/**
 * Every page route pattern the app serves, as Next resolves them — route groups
 * ((app), (my), (auth)) stripped, dynamic segments kept in bracket form.
 *
 * THIS LIST IS THE BOUND. UsageDaily's row space is exactly
 * (users x these paths + "/other" x days retained), and it is a CLOSED list
 * rather than a regex heuristic on purpose: a heuristic that rewrites
 * "anything cuid-shaped" is unbounded the moment a segment shape nobody
 * anticipated arrives, which is the failure this table's design exists to
 * avoid. Anything unrecognised becomes OTHER_PATH below and costs one row.
 *
 * KEPT IN SYNC BY THE FIXTURE, NOT BY DISCIPLINE.
 * scripts/verify-eng1-engagement.ts walks src/app for page.tsx files, derives
 * this same list from the filesystem, and fails if the two disagree. A page
 * added without an entry here would otherwise roll up silently as "/other" —
 * green everywhere, wrong on the report. That test is the only reason a
 * hand-maintained list is acceptable.
 *
 * Some entries are unreachable by the beacon and are here for TOTALITY, not
 * because they will ever be counted: /sign-in and /sign-up are unauthenticated,
 * and /print/* and / render outside both app shells, so no beacon is mounted on
 * them. Listing them costs nothing and keeps "derived from the filesystem"
 * literally true, which is what the fixture checks.
 */
export const ROUTE_PATTERNS: readonly string[] = [
  "/",
  "/checklists",
  "/dashboard",
  "/forecasting",
  "/hr",
  "/hr/acknowledge/[documentId]",
  "/hr/compliance",
  "/hr/documents",
  "/hr/documents/[id]",
  "/hr/forms",
  "/hr/forms/[id]",
  "/hr/forms/[id]/submit",
  "/hr/signed-records",
  "/hr/training",
  "/hr/training/[id]/edit",
  "/hr/training/[id]/preview",
  "/hr/training/new",
  "/instagram",
  "/internal/roadmap",
  "/inventory/adjustments",
  "/inventory/alerts",
  "/inventory/counts",
  "/inventory/counts/[id]",
  "/inventory/expected",
  "/inventory/ingredients",
  "/inventory/ingredients/deleted",
  "/inventory/ingredients/duplicates",
  "/inventory/orders/new",
  "/inventory/purchase-orders",
  "/inventory/purchase-orders/[id]",
  "/inventory/purchase-orders/new",
  "/inventory/recipes",
  "/inventory/recipes/[id]",
  "/inventory/reports",
  "/inventory/sales-items",
  "/inventory/storage-areas",
  "/inventory/vendors",
  "/items",
  "/labor",
  "/labor/inspector",
  "/messages",
  "/my",
  "/my/documents",
  "/my/documents/[documentId]",
  "/my/documents/records/[recordId]",
  "/my/instagram",
  "/my/messages",
  "/my/training",
  "/my/training/[assignmentId]",
  "/print/checklist/[id]",
  "/print/template/[id]",
  "/reports",
  "/reports/operations",
  "/settings",
  "/settings/labor",
  "/sign-in/[[...sign-in]]",
  "/sign-up/[[...sign-up]]",
  "/staff",
  "/staff/[id]",
  "/staff/engagement",
  "/store-view",
  "/store-view/checklist/[id]",
  "/stores",
  "/templates",
  "/templates/[id]",
  "/templates/[id]/edit",
  "/templates/new",
  "/users",
]

/**
 * Where everything unrecognised lands. ONE ROW, not one row per stray URL —
 * that is the entire point of having a fallback constant rather than storing
 * the raw pathname when no pattern matches.
 */
export const OTHER_PATH = "/other"

/** How stale User.lastSeenAt must be before the beacon rewrites it. */
export const LAST_SEEN_THROTTLE_MS = 15 * 60 * 1000

/** ENG-1 ruling 2: UsageDaily rows are pruned at this age. */
export const USAGE_RETENTION_DAYS = 180

/** Longest path a beacon may claim before it is refused outright. */
const MAX_RAW_PATH = 2048

const isDynamic = (seg: string) => seg.startsWith("[") && seg.endsWith("]")
const isCatchAll = (seg: string) => isDynamic(seg) && seg.includes("...")

const split = (p: string) => p.split("/").filter(Boolean)

/**
 * Collapse a request pathname onto one of ROUTE_PATTERNS, or OTHER_PATH.
 *
 * THIS FUNCTION IS TOTAL AND MUST STAY TOTAL. It is the only thing standing
 * between a client-supplied string and a UsageDaily primary key: the body of a
 * beacon is attacker-controlled in the ordinary sense (any authenticated user
 * can POST any path they like), so "it returns something from a fixed set" is a
 * security property, not a tidiness one. Every early return below yields either
 * a member of ROUTE_PATTERNS or OTHER_PATH — never its input.
 *
 * STATIC SEGMENTS BEAT DYNAMIC ONES, matching how Next itself resolves
 * /templates/new against the sibling /templates/[id]. Without this,
 * /staff/engagement would roll up as /staff/[id] and the engagement page would
 * report visits to itself as visits to a staff profile.
 */
export function normalizePath(raw: string | null | undefined): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_RAW_PATH) return OTHER_PATH

  // Query string and hash never enter the key — ?store=<id> on the engagement
  // page itself would otherwise create a row per store filtered.
  const path = raw.split("?")[0].split("#")[0]
  if (!path.startsWith("/")) return OTHER_PATH

  // Reject traversal and protocol-ish shapes before matching rather than
  // normalising them: nothing legitimate produces them, and a fallback is a
  // safer answer than a cleverly repaired path.
  if (path.includes("..") || path.includes("//") || path.includes("\\")) return OTHER_PATH

  const segs = split(path)
  if (segs.length === 0) return "/"

  let best: string | null = null
  let bestDynamic = Infinity

  for (const pattern of ROUTE_PATTERNS) {
    const pSegs = split(pattern)
    if (pSegs.length === 0) continue

    const last = pSegs[pSegs.length - 1]
    const catchAll = isCatchAll(last)

    if (catchAll) {
      // [...x] needs at least one segment; [[...x]] accepts zero.
      const optional = last.startsWith("[[")
      const fixed = pSegs.length - 1
      if (segs.length < fixed || (!optional && segs.length === fixed)) continue
      if (!pSegs.slice(0, fixed).every((s, i) => s === segs[i])) continue
      const dyn = pSegs.filter(isDynamic).length
      if (dyn < bestDynamic) { best = pattern; bestDynamic = dyn }
      continue
    }

    if (pSegs.length !== segs.length) continue
    if (!pSegs.every((s, i) => (isDynamic(s) ? segs[i].length > 0 : s === segs[i]))) continue
    const dyn = pSegs.filter(isDynamic).length
    if (dyn < bestDynamic) { best = pattern; bestDynamic = dyn }
  }

  return best ?? OTHER_PATH
}

/**
 * The org-local day a beacon belongs to, as the bare UTC-midnight Date that
 * @db.Date expects.
 *
 * ORG-LOCAL, NOT STORE-LOCAL — Gary's ENG-1 spec, and it is what lets the page
 * sum a user's activity across stores without two rows meaning different
 * Tuesdays. The chain is Organization.timezone -> DEFAULT_TIME_ZONE, the same
 * shape displayTimeZone() uses (src/lib/hr.ts) and with the same missing arm:
 * THERE IS NO BARE-UTC FALLBACK, because UTC is the wrong answer that DEBT-70b
 * exists to keep unreachable.
 */
export function orgLocalDate(now: Date, orgTimeZone: string | null | undefined): Date {
  return dbDate(localDateStr(now, orgTimeZone || DEFAULT_TIME_ZONE))
}

/**
 * "City, Region" from the two Vercel edge geo headers, or null.
 *
 * NEVER AN IP ADDRESS — ENG-1 ruling 1. This function reads exactly two header
 * names and there is no third arm: not x-forwarded-for, not x-real-ip, and
 * deliberately NOT requestIp() from src/lib/training.ts, which exists for the
 * HR e-signature trail and must not be borrowed here.
 *
 * NULL IS THE NORMAL LOCAL AND PREVIEW-LESS ANSWER. The x-vercel-ip-* headers
 * are set by the Vercel edge, so under `next dev` they are absent and every row
 * carries null. Absent is not broken and the page renders a dash.
 *
 * The city header arrives PERCENT-ENCODED ("San%20Francisco"). decodeURIComponent
 * throws on a malformed sequence, so it is guarded — a bad header degrades to
 * null rather than throwing inside a request the user is waiting on.
 */
export function geoLocationFrom(headers: {
  get(name: string): string | null
}): string | null {
  const decode = (v: string | null): string | null => {
    if (!v) return null
    try {
      const d = decodeURIComponent(v).trim()
      return d.length > 0 && d.length <= 120 ? d : null
    } catch {
      return null
    }
  }
  const city = decode(headers.get("x-vercel-ip-city"))
  const region = decode(headers.get("x-vercel-ip-country-region"))
  if (city && region) return `${city}, ${region}`
  return city ?? region ?? null
}
