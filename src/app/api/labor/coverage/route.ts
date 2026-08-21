import { NextResponse } from "next/server"
import { requireLaborView, requireLaborStore } from "@/lib/labor-access"
import { localDateStr } from "@/lib/reports"
import { mondayOfWeekStr } from "@/lib/labor-week"
import { getWeeklyDayPlan, computeDayCoverage, addDaysStr } from "@/lib/labor-plan"
import { demandShapeSource } from "@/lib/labor-coverage"
import { can } from "@/lib/permissions"
import {
  getScheduledCoverage,
  getClockedInCoverage,
  getScheduleSyncSummary,
  getOverlayJobs,
  UNKNOWN_JOB_ID,
} from "@/lib/labor-schedule"

// GET /api/labor/coverage?storeId=&date= — demand-shaped, budget-capped
// recommended coverage for one day (guidance). Works for FUTURE days (up to the
// UI's 4-week horizon). The per-day hourly cap now comes from the shared L-3
// weekly plan (floor-first split + GM 40h cap + any rebalance override); this
// route just renders the coverage engine for the selected day. Read-only, any
// role that can see the store.
//
// OVL-S3 — THE OVERLAY RIDES BESIDE `coverage`, NEVER INSIDE IT. The scheduled
// and clocked-in curves are DISPLAY OVERLAYS (seam (b)): they are assembled after
// computeDayCoverage has already returned and are not an input to it, to the
// budget, or to the recommendation. Delete the `overlay` key and this route's
// suggested curve is byte-identical to what it served before this session.
//
// ABSENCE, NOT EMPTINESS. Without labor.schedule.view there is NO `overlay` key
// at all — not an empty object, not nulls. A payload that never carries the data
// cannot leak it, and the boundary test is then a test rather than a promise.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: Request) {
  const t0 = Date.now()
  const ctx = await requireLaborView()
  if ("error" in ctx) return ctx.error

  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId") ?? ""
  const store = await requireLaborStore(ctx, storeId)
  if ("error" in store) return store.error

  const today = localDateStr(new Date(), store.timezone)
  const dateParam = url.searchParams.get("date")
  let date = dateParam && DATE_RE.test(dateParam) ? dateParam : today
  if (date > addDaysStr(today, 28)) date = addDaysStr(today, 28)
  const weekStart = mondayOfWeekStr(date)

  const available = ctx.org.activeModules.includes("inventory") && !!store.squareLocationId && !!ctx.org.squareAccessToken
  const canManage = ctx.isAdmin || ctx.dbUser?.role === "MANAGER"
  const base = { store: { id: store.id, name: store.name, timezone: store.timezone }, today, date, weekStart, available, canManage }

  const plan = await getWeeklyDayPlan(storeId, weekStart, today)
  if (!plan.budget) return NextResponse.json({ ...base, hasForecast: false, hasShape: false, coverage: null, adjustment: null })

  const day = plan.days.find((d) => d.date === date) ?? plan.days[0]
  const coverage = await computeDayCoverage(storeId, day, today, plan.hasHourlySupervisor)

  // BUG-1 evidence line: request duration in the runtime logs.
  console.log(`[api/labor/coverage] ${Date.now() - t0}ms store=${storeId} date=${date}`)

  // D7 — THE PROJECTED FLAG, AND IT IS THE SERVER'S ANSWER RATHER THAN THE
  // CARD'S GUESS. getDemandShape gives today and every future day the
  // same-weekday template (labor-plan.ts); only a COMPLETED past day is shaped by
  // its own actuals. demandShapeSource is the pure function that decides which,
  // so `actualsDate === null` is exactly "this curve is projected" — including
  // TODAY, which the card's old `isFuture` check silently excluded.
  const projected = demandShapeSource(date, today).actualsDate === null

  const overlay = can(ctx.actor, "labor.schedule.view")
    ? await buildOverlay(ctx.org.id, storeId, date, today)
    : undefined

  return NextResponse.json({
    ...base,
    hasForecast: true,
    hasShape: !!coverage,
    isFuture: date > today,
    projected,
    adjustment: day.adjustmentPct !== 0 ? { adjustmentPct: day.adjustmentPct, reason: day.adjustmentReason } : null,
    coverage,
    // `undefined` is dropped by JSON.stringify — the key is genuinely absent.
    ...(overlay ? { overlay } : {}),
  })
}

/// Assembles the overlay half. COUNTS AND COLOURS ONLY — no wage, no per-person
/// field, no shift note enters any of the four reads below.
///
/// CLOCKED-IN IS TODAY-ONLY (Gary's ruling): the same-day toggle offers scheduled
/// vs actual, and other days show scheduled alone. A past day's actuals belong to
/// the S4 comparison page, not to a card whose job is "what should the floor look
/// like".
async function buildOverlay(organizationId: string, storeId: string, date: string, today: string) {
  const [scheduled, clockedIn, sync] = await Promise.all([
    getScheduledCoverage(storeId, date),
    date === today ? getClockedInCoverage(storeId, date) : Promise.resolve(null),
    getScheduleSyncSummary(storeId),
  ])

  // NEVER-SYNCED RENDERS NOTHING. Seam (c): a store we have never asked about must
  // not show an empty overlay pretending its schedule is blank. The card falls
  // back to forecasted-only, and the toggle is not offered.
  if (sync.health === "never") {
    return { scheduled: null, clockedIn: null, jobs: [], sync, draftSourcedCount: 0, openTimecardCount: 0, unknownJobId: UNKNOWN_JOB_ID }
  }

  // The legend covers every job appearing on EITHER curve, so a position that was
  // worked but not scheduled (or scheduled but not worked) still gets a colour and
  // a row rather than an unexplained line.
  const jobIds = [...new Set([...(scheduled?.jobIds ?? []), ...(clockedIn?.jobIds ?? [])])].sort()
  const jobs = await getOverlayJobs(organizationId, jobIds)

  return {
    // A day with no shifts inside a HEALTHY window is a quiet day, not a gap —
    // the points are still 24 honest zeros and the card says "none scheduled".
    scheduled: scheduled ? scheduled.points.map((p) => ({ hour: p.hour, total: p.scheduled, byJobId: p.byJobId })) : null,
    clockedIn: clockedIn ? clockedIn.points.map((p) => ({ hour: p.hour, total: p.clockedIn, byJobId: p.byJobId })) : null,
    jobs,
    sync,
    draftSourcedCount: scheduled?.draftSourcedCount ?? 0,
    openTimecardCount: clockedIn?.openCount ?? 0,
    unknownJobId: UNKNOWN_JOB_ID,
  }
}
