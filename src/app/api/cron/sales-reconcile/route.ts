import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { addDaysStr } from "@/lib/goal-engine"
import { localDateStr } from "@/lib/reports"
import { syncSalesForStore } from "@/lib/sales-sync"

// GET /api/cron/sales-reconcile — nightly re-pull of the last 3 days for every
// Square-linked store (all orgs), absorbing late refunds, edited orders, and
// any missed syncs. Refunds land on the day they occur, which is what goal
// pacing wants. Registered in vercel.json; Vercel calls it with
// "Authorization: Bearer ${CRON_SECRET}".
//
// Stores are processed serially on purpose — Square doesn't publish rate
// limits, so we stay polite and let the outcome log per store tell the story.

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

  const orgs = await prisma.organization.findMany({
    where: { squareAccessToken: { not: null } },
  })

  const results: { org: string; store: string; days?: number; orders?: number; error?: string }[] = []
  for (const org of orgs) {
    const stores = await prisma.store.findMany({
      where: { organizationId: org.id, squareLocationId: { not: null }, isActive: true },
    })
    for (const store of stores) {
      const today = localDateStr(new Date(), store.timezone)
      const start = addDaysStr(today, -(RECONCILE_DAYS - 1))
      try {
        const r = await syncSalesForStore(org, store, start, today)
        results.push({ org: org.id, store: store.id, days: r.days, orders: r.orders })
      } catch (e) {
        const msg = e instanceof Error ? e.message : "sync failed"
        results.push({ org: org.id, store: store.id, error: msg.slice(0, 200) })
        console.error(`[cron:sales-reconcile] org=${org.id} store=${store.id}: ${msg}`)
      }
    }
  }

  const failed = results.filter((r) => r.error).length
  console.log(`[cron:sales-reconcile] ${results.length - failed}/${results.length} stores reconciled`)
  return NextResponse.json({ ok: failed === 0, stores: results.length, failed, results })
}
