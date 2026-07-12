import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { paceThresholdPct, processPaceAlertForStore, type PaceAlertResult } from "@/lib/pace-alerts"
import { getEmailSender } from "@/lib/notify"

// GET /api/cron/pace-alerts — once daily, alert admins + assigned managers
// when a store falls below PACE_ALERT_THRESHOLD_PCT (default 90%) of its MTD
// goal, measured through yesterday. At most one alert per store per month
// (PaceAlertLog unique constraint). Registered in vercel.json; Vercel calls it
// with "Authorization: Bearer ${CRON_SECRET}". Runs after the nightly
// sales-reconcile so yesterday's actuals are settled.

export const maxDuration = 300

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const thresholdPct = paceThresholdPct()
  const sender = getEmailSender()

  // Only stores that could have an MTD goal: active, with DailyGoal rows this
  // month (UTC month start is close enough — per-store timezones are resolved
  // inside processPaceAlertForStore).
  const utcMonthStart = new Date(`${new Date().toISOString().slice(0, 7)}-01T00:00:00.000Z`)
  const stores = await prisma.store.findMany({
    where: { isActive: true, dailyGoals: { some: { date: { gte: utcMonthStart } } } },
  })

  const results: PaceAlertResult[] = []
  for (const store of stores) {
    try {
      results.push(await processPaceAlertForStore(store, { thresholdPct, sender }))
    } catch (e) {
      const msg = e instanceof Error ? e.message : "pace alert failed"
      results.push({ storeId: store.id, storeName: store.name, pacePct: null, alerted: false, reason: `error: ${msg.slice(0, 200)}` })
      console.error(`[cron:pace-alerts] store=${store.id}: ${msg}`)
    }
  }

  const alerted = results.filter((r) => r.alerted).length
  console.log(`[cron:pace-alerts] ${stores.length} stores checked, ${alerted} alerted (threshold ${thresholdPct}%)`)
  return NextResponse.json({ ok: true, thresholdPct, stores: stores.length, alerted, results })
}
