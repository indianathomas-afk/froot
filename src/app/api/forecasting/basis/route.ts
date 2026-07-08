import { NextResponse } from "next/server"
import { requireForecastContext, requireForecastStore } from "@/lib/forecasting-access"
import { buildLastYearBasis, basisWindow } from "@/lib/goal-engine"
import { localDateStr } from "@/lib/reports"

// GET /api/forecasting/basis?storeId=&year= — what "use last year's Square
// sales" would produce: the weekday-aligned basis total plus cache coverage,
// so the settings panel can show the fetched total and offer a backfill when
// last year isn't fully cached yet.
export async function GET(req: Request) {
  const ctx = await requireForecastContext()
  if ("error" in ctx) return ctx.error

  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId") ?? ""
  const year = Number(url.searchParams.get("year"))
  if (!storeId || !Number.isInteger(year)) {
    return NextResponse.json({ error: "storeId and year are required" }, { status: 400 })
  }
  const store = await requireForecastStore(ctx, storeId)
  if ("error" in store) return store.error

  const coverage = await buildLastYearBasis(storeId, year)
  const win = basisWindow(year)
  const today = localDateStr(new Date(), store.timezone)

  return NextResponse.json({
    basisTotal: coverage.basisTotal,
    totalDays: coverage.totalDays,
    alignedDays: coverage.alignedDays,
    fallbackDays: coverage.fallbackDays,
    uncoveredDays: coverage.uncoveredDays,
    window: win,
    squareLinked: !!store.squareLocationId && !!ctx.org.squareAccessToken,
    // Days of the basis window that are in the past but not yet syncable count
    // toward backfill; the client polls /backfill until uncovered days stop shrinking.
    today,
  })
}
