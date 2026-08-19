import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { addDaysStr } from "@/lib/goal-engine"
import { localDateStr } from "@/lib/reports"
import { squareLaborAvailable, laborModuleAvailable } from "@/lib/auth"
import { syncTimecardsForStore } from "@/lib/labor-actuals"

// GET /api/cron/labor-timecards — trailing re-pull of Square timecards for every
// Square-linked store in every org that has the Advanced Labor overlay ON.
// Absorbs the manager corrections that are the whole reason this ingest is
// polled rather than webhook-driven.
//
// DELIBERATELY NOT REGISTERED IN vercel.json (Gary's ruling, 2026-08-18). AL-1
// asked for "cron-ready", and adding the entry would ACTIVATE the schedule on
// staging AND production at the next deploy — and cron activation on production
// is explicitly not that session's decision. The route exists and is callable
// with the same CRON_SECRET bearer every other cron uses, so activation later is
// a one-line vercel.json edit and nothing else.
//
// SUGGESTED ENTRY WHEN IT IS ACTIVATED:
//   { "path": "/api/cron/labor-timecards", "schedule": "30 11 * * *" }
// Half an hour after sales-reconcile (0 11 * * *) so the two never contend for
// the same unpublished Square rate limit in the same minute.
//
// RECONCILE_DAYS IS 3, THE SAME NUMBER sales-reconcile USES, deliberately — the
// numerator and the denominator of the labor percentage must not disagree about
// how far back "recent" reaches. KNOWN LIMIT, recorded rather than hidden:
// manager corrections can land later than three days, and this window will miss
// those. A weekly deeper sweep is the obvious answer and is not built here.

export const maxDuration = 300

const RECONCILE_DAYS = 3

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // All three gates, the same order requireSquareLabor uses: Labor module, then
  // the Square overlay's availability, then the per-org column. An org that
  // turned the overlay off is skipped silently — it asked not to have this.
  const orgs = await prisma.organization.findMany({
    where: { squareAccessToken: { not: null }, squareLaborEnabled: true },
  })

  const results: { org: string; store: string; timecards?: number; written?: number; error?: string }[] = []
  for (const org of orgs) {
    if (!laborModuleAvailable(org.clerkOrgId)) continue
    if (!squareLaborAvailable(org.clerkOrgId)) continue
    if (!org.activeModules.includes("labor")) continue

    const stores = await prisma.store.findMany({
      where: { organizationId: org.id, squareLocationId: { not: null }, isActive: true },
    })
    // Serial on purpose — sales-reconcile's stated reason: Square publishes no
    // rate limits, so we stay polite and let the per-store log tell the story.
    for (const store of stores) {
      const today = localDateStr(new Date(), store.timezone)
      const start = addDaysStr(today, -(RECONCILE_DAYS - 1))
      try {
        const r = await syncTimecardsForStore(org, store, start, today)
        results.push({ org: org.id, store: store.id, timecards: r.timecards, written: r.written })
      } catch (e) {
        // One store's Square failure never stops the estate. The cause is already
        // logged by syncTimecardsForStore and recorded on that store's
        // SquareLaborSyncState, so it reads as unhealthy rather than as absent.
        const msg = e instanceof Error ? e.message : "sync failed"
        results.push({ org: org.id, store: store.id, error: msg.slice(0, 200) })
      }
    }
  }

  const failed = results.filter((r) => r.error).length
  console.log(`[cron:labor-timecards] ${results.length - failed}/${results.length} stores synced`)
  return NextResponse.json({ ok: failed === 0, stores: results.length, failed, results })
}
