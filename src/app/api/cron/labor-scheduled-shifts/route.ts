import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { addDaysStr } from "@/lib/goal-engine"
import { localDateStr } from "@/lib/reports"
import { squareLaborAvailable, laborModuleAvailable } from "@/lib/auth"
import {
  SCHEDULE_WINDOW_DAYS_BACK,
  SCHEDULE_WINDOW_DAYS_FORWARD,
  syncScheduledShiftsForStore,
} from "@/lib/labor-schedule"

// GET /api/cron/labor-scheduled-shifts — a full-horizon re-pull of Square
// scheduled shifts for every Square-linked store in every org with the Advanced
// Labor overlay ON.
//
// DELIBERATELY NOT REGISTERED IN vercel.json, and the precedent is exact:
// /api/cron/labor-timecards shipped the same way on Gary's 2026-08-18 ruling and
// is tracked as CRON-1. Adding an entry here would ACTIVATE the schedule on
// staging AND production at the next deploy, and cron activation is its own
// ruling — not this session's (OVL-S2 § 3.4). The route exists and is callable
// with the same CRON_SECRET bearer every other cron uses, so activation later is
// a one-line vercel.json edit and nothing else. READ THE MISSING ENTRY AS THE
// RULING, never as an oversight to be helpfully corrected.
//
// WHY IT EXISTS AT ALL WHEN THE DASHBOARD ALREADY TRIGGERS THE SYNC: the
// dashboard trigger caps at two stores per load, so a large estate converges
// over several page loads and a store nobody opened today never converges. That
// is acceptable for a card someone is looking at and not acceptable for the
// future alerting/report consumers CRON-1 names as its revisit trigger.
//
// THE WINDOW IS THE CARD HORIZON, NOT A RECONCILE TAIL. labor-timecards re-pulls
// three days because a timecard is a record of a day that happened. A schedule
// is about days that have NOT, so the same three-back/28-forward window the
// dashboard trigger uses applies here — sharing the constants rather than
// restating them, which is how the two drift.

export const maxDuration = 300

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // The same gates in the same order requireSquareLabor uses. An org that turned
  // the overlay off is skipped silently — it asked not to have this.
  const orgs = await prisma.organization.findMany({
    where: { squareAccessToken: { not: null }, squareLaborEnabled: true },
  })

  const results: { org: string; store: string; shifts?: number; written?: number; error?: string }[] = []
  for (const org of orgs) {
    if (!laborModuleAvailable(org.clerkOrgId)) continue
    if (!squareLaborAvailable(org.clerkOrgId)) continue
    if (!org.activeModules.includes("labor")) continue

    const stores = await prisma.store.findMany({
      where: { organizationId: org.id, squareLocationId: { not: null }, isActive: true },
    })
    // Serial on purpose — sales-reconcile's stated reason: Square publishes no
    // rate limits, so we stay polite and let the per-store log tell the story.
    // It matters more here than anywhere else in the repo: the fetch protocol
    // already spends one request per store-week, so a parallel estate sweep
    // would be dozens of concurrent calls against an unpublished limit.
    for (const store of stores) {
      const today = localDateStr(new Date(), store.timezone)
      try {
        const r = await syncScheduledShiftsForStore(
          org,
          store,
          addDaysStr(today, -SCHEDULE_WINDOW_DAYS_BACK),
          addDaysStr(today, SCHEDULE_WINDOW_DAYS_FORWARD)
        )
        results.push({ org: org.id, store: store.id, shifts: r.shifts, written: r.written })
      } catch (e) {
        // One store's Square failure never stops the estate. The cause is already
        // logged and recorded on that store's SquareScheduleSyncState, so it
        // reads as unhealthy rather than as absent.
        const msg = e instanceof Error ? e.message : "sync failed"
        results.push({ org: org.id, store: store.id, error: msg.slice(0, 200) })
      }
    }
  }

  const failed = results.filter((r) => r.error).length
  console.log(`[cron:labor-scheduled-shifts] ${results.length - failed}/${results.length} stores synced`)
  return NextResponse.json({ ok: failed === 0, stores: results.length, failed, results })
}
