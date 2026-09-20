import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { paceThresholdPct, processPaceAlertForStore, type PaceAlertResult } from "@/lib/pace-alerts"
import { getEmailSender } from "@/lib/notify"

// GET /api/cron/pace-alerts — once daily, alert admins + assigned managers
// when a store falls below its org's alert threshold (NOTIFY-2a:
// Organization.paceAlertThresholdPct, else PACE_ALERT_THRESHOLD_PCT, else 90%)
// of its MTD goal, measured through yesterday. At most one alert per store per
// month (PaceAlertLog unique constraint). Registered in vercel.json; Vercel
// calls it with "Authorization: Bearer ${CRON_SECRET}". Runs after the nightly
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

  // The deployment-wide fallback, resolved once. NOTIFY-2a made the threshold
  // PER ORG but did NOT retire this (F1, Gary 2026-09-20): a null column means
  // fall back to here, so an org that has never opened the settings page is
  // evaluated at exactly the number it was evaluated at before this phase.
  const fallbackPct = paceThresholdPct()
  const sender = getEmailSender()

  // Only stores that could have an MTD goal: active, with DailyGoal rows this
  // month (UTC month start is close enough — per-store timezones are resolved
  // inside processPaceAlertForStore).
  //
  // F-5b: AND whose org has pace alerts switched on. THE GATE IS IN THIS QUERY
  // RATHER THAN AN EARLY RETURN INSIDE processPaceAlertForStore, and that is the
  // load-bearing choice: a disabled org's store is never evaluated at all, so
  // nothing reads its goal, nothing writes a PaceAlertLog row, and its
  // one-alert-per-month lock cannot be burned while the org is dark. A per-store
  // early return placed after the lock write would do the opposite.
  const utcMonthStart = new Date(`${new Date().toISOString().slice(0, 7)}-01T00:00:00.000Z`)
  const storeFilter = { isActive: true, dailyGoals: { some: { date: { gte: utcMonthStart } } } }
  const [stores, enabledOrgs, skippedDisabled] = await Promise.all([
    prisma.store.findMany({
      where: { ...storeFilter, organization: { paceAlertsEnabled: true } },
    }),
    // NOTIFY-2a. THE THRESHOLD LOOKUP AND THE orgsEnabled COUNT ARE THE SAME
    // QUERY — this findMany REPLACES the organization.count() that used to sit
    // here, so resolving a threshold per org costs no extra round trip.
    //
    // A MAP RATHER THAN A RELATION ON THE STORE QUERY, deliberately.
    // processPaceAlertForStore is typed `store: Store`, so including
    // `organization` above would widen that parameter for every caller
    // (fixture included) to carry a payload the function does not read. The
    // org id is already on the Store row; this keeps the seam where it was.
    prisma.organization.findMany({
      where: { paceAlertsEnabled: true },
      select: { id: true, paceAlertThresholdPct: true },
    }),
    // The same population the filter above excluded — counted rather than
    // inferred, so the log line distinguishes "the gate suppressed 12 stores"
    // from "no store qualified this month". Those look identical otherwise and
    // the day after the production env flip is exactly when someone will need
    // to tell them apart.
    prisma.store.count({
      where: { ...storeFilter, organization: { paceAlertsEnabled: false } },
    }),
  ])

  const thresholdByOrg = new Map(enabledOrgs.map((o) => [o.id, o.paceAlertThresholdPct]))

  const results: PaceAlertResult[] = []
  // What each org was actually evaluated at, for the run log and the response.
  // Keyed by org rather than by store because the threshold IS per org — a
  // per-store line would repeat the same number nine times for Keva.
  const thresholdsUsed = new Map<string, { thresholdPct: number; source: "org" | "env" }>()
  for (const store of stores) {
    // An org in `stores` is always in `thresholdByOrg` — both come from the
    // same `paceAlertsEnabled: true` predicate in the same Promise.all — but
    // `?? null` rather than `!` so a future divergence falls back to the env
    // value instead of throwing mid-loop and losing the stores after it.
    const orgThreshold = thresholdByOrg.get(store.organizationId) ?? null
    const thresholdPct = orgThreshold ?? fallbackPct
    thresholdsUsed.set(store.organizationId, {
      thresholdPct,
      source: orgThreshold === null ? "env" : "org",
    })
    try {
      results.push(await processPaceAlertForStore(store, { thresholdPct, sender }))
    } catch (e) {
      const msg = e instanceof Error ? e.message : "pace alert failed"
      results.push({ storeId: store.id, storeName: store.name, pacePct: null, alerted: false, reason: `error: ${msg.slice(0, 200)}` })
      console.error(`[cron:pace-alerts] store=${store.id}: ${msg}`)
    }
  }

  // ORGS ARE NAMED BY ID, never by name (CLAUDE.md § Database Evidence): five
  // rows on staging answer to "Microsoft", so a name in a run log identifies
  // nothing. "env" marks an org falling back rather than setting its own, which
  // is the distinction someone reads this line to make.
  const thresholds = [...thresholdsUsed.entries()].map(
    ([organizationId, t]) => ({ organizationId, ...t })
  )
  const thresholdSummary =
    thresholds.length === 0
      ? `no org evaluated (fallback ${fallbackPct}%)`
      : thresholds.map((t) => `${t.organizationId}=${t.thresholdPct}%(${t.source})`).join(" ")

  const alerted = results.filter((r) => r.alerted).length
  console.log(
    `[cron:pace-alerts] ${enabledOrgs.length} orgs enabled, ${stores.length} stores evaluated, ` +
      `${alerted} alerted, ${skippedDisabled} skipped (org disabled) (thresholds ${thresholdSummary})`
  )
  return NextResponse.json({
    ok: true,
    // NOTIFY-2a CHANGED THIS SHAPE: `thresholdPct` was one scalar for the whole
    // run and cannot be, now that the number is per org. The fallback is
    // reported separately so a run where every org falls back is still
    // readable. Nothing consumes this response programmatically — it is read in
    // the Vercel function log — but the change is named here rather than made
    // silently.
    fallbackThresholdPct: fallbackPct,
    thresholds,
    orgsEnabled: enabledOrgs.length,
    stores: stores.length,
    alerted,
    skippedDisabled,
    results,
  })
}
