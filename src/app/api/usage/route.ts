import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import {
  normalizePath,
  orgLocalDate,
  geoLocationFrom,
  LAST_SEEN_THROTTLE_MS,
} from "@/lib/engagement"

// ─────────────────────────────────────────────────────────────────────────────
// ENG-1 — POST /api/usage. The beacon endpoint.
//
// Gary, 2026-08-30. Called fire-and-forget by src/components/usage-beacon.tsx on
// every client-side route change, for every authenticated user of every role.
// The DATA is everyone; the VIEW (/staff/engagement) is ADMIN only.
//
// A BROKEN ENGAGEMENT TRACKER MUST NEVER BREAK A WORKING STORE. That is the
// design rule and it is why the entire body below sits inside one try/catch that
// returns 204 regardless. It is writeAuditLog()'s philosophy (src/lib/audit.ts:34
// — "Writes NEVER block the user action") applied to a route rather than a
// helper: the caller does not read the response, cannot retry, and a 500 here
// would put a red line in the console of a store iPad mid-shift over a metric
// nobody is waiting on.
//
// THE 401 BELOW IS DEFENCE IN DEPTH AND IS NORMALLY UNREACHABLE, which is worth
// knowing before someone tests it and files a bug. /api/usage is NOT in
// isPublicRoute (src/proxy.ts), so clerkMiddleware's auth.protect() refuses an
// unauthenticated request at the edge and this handler never runs.
//
// THE OBSERVED STATUS IS 307 TO /sign-in, NOT 401 AND NOT 404 — MEASURED, not
// reasoned. Reading @clerk/nextjs's handleUnauthenticated() suggests a
// non-document request should get notFound(); on this app every protected API
// route answers 307 instead (measured 2026-08-30 against next dev: /api/usage,
// /api/staff, /api/staff/engagement and /api/stores all 307 to
// /sign-in?redirect_url=...), because isPageRequest()'s isPagePathAvailable()
// arm is truthy in this configuration. The number is recorded here so the next
// reader tests against reality rather than against the library's source.
//
// WHAT IS UNCHANGED BY THAT CORRECTION, and it is the part that matters: the
// handler is never reached and NO ROW IS WRITTEN. Gary ruled 2026-08-30: do NOT
// add /api/usage to the public matcher to make any status code come out nicer —
// that would open a write route to unauthenticated callers.
//
// NO IP ADDRESS IS READ, STORED OR LOGGED ANYWHERE IN THIS FILE (ENG-1 ruling 1).
// The only client-origin signal is geoLocationFrom(), which reads exactly two
// x-vercel-ip-* headers and returns "City, Region". requestIp()
// (src/lib/training.ts:232) exists for the HR e-signature trail and is
// deliberately not imported here.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    let ctx
    try {
      ctx = await getCurrentUser()
    } catch {
      // No session, or no Organization row for the session's org.
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const { org, dbUser } = ctx

    // A cross-org User row is refused by getCurrentUser() and arrives here as
    // null (DEBT-50/F1). There is no row to attribute usage to and inventing one
    // would be the exact bug that guard exists to prevent, so: write nothing,
    // and still answer 204 rather than an error the beacon cannot act on.
    if (!dbUser) return new NextResponse(null, { status: 204 })

    // sendBeacon cannot set Content-Type to application/json — a string payload
    // arrives as text/plain — so the body is read as text and parsed by hand.
    // req.json() would throw on exactly the requests this route is built for.
    let path: string | null = null
    try {
      const parsed = JSON.parse(await req.text()) as { path?: unknown }
      if (typeof parsed?.path === "string") path = parsed.path
    } catch {
      // Malformed body: fall through with path null and record nothing.
    }
    if (path === null) return new NextResponse(null, { status: 204 })

    const normalized = normalizePath(path)
    const now = new Date()
    const date = orgLocalDate(now, org.timezone)

    // The user's home store at write time. defaultStoreId first, then the
    // single-assignment case — which is precisely a STORE device login
    // (isDeviceLogin, src/lib/device-login.ts:66), the account ENG-1 ruling 4
    // treats as the store itself. A multi-store MANAGER and an assignment-less
    // ADMIN both resolve to null, correctly: they have no one home store.
    const storeId =
      dbUser.defaultStoreId ??
      (dbUser.storeAssignments.length === 1 ? dbUser.storeAssignments[0].storeId : null)

    // THE ROLLUP WRITE. Unthrottled and cheap: one upsert against
    // @@unique([userId, path, date]), so the fortieth dashboard visit of the day
    // is an increment, not a fortieth row.
    await prisma.usageDaily.upsert({
      where: { userId_path_date: { userId: dbUser.id, path: normalized, date } },
      create: {
        organizationId: org.id,
        userId: dbUser.id,
        storeId,
        date,
        path: normalized,
        count: 1,
        lastAt: now,
      },
      update: { count: { increment: 1 }, lastAt: now, storeId },
    })

    // THE THROTTLED WRITE. This is the only thing the 15-minute window governs —
    // the rollup above is deliberately unthrottled, because an increment is one
    // indexed upsert whereas this is a second UPDATE on a hot row.
    const stale =
      !dbUser.lastSeenAt || now.getTime() - dbUser.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS
    if (stale) {
      const location = geoLocationFrom(req.headers)
      await prisma.user.update({
        where: { id: dbUser.id },
        data: {
          lastSeenAt: now,
          // Only overwrite a known location with another known one. A user who
          // moves onto a network the edge cannot place should keep their last
          // real city rather than have it blanked — null here means "no answer
          // this time", not "nowhere".
          ...(location ? { lastSeenLocation: location } : {}),
        },
      })
    }

    return new NextResponse(null, { status: 204 })
  } catch (e) {
    // Swallowed, exactly like writeAuditLog. The console line is the only
    // consequence a failure is allowed to have.
    console.error("[usage] beacon write failed:", e instanceof Error ? e.message : e)
    return new NextResponse(null, { status: 204 })
  }
}
