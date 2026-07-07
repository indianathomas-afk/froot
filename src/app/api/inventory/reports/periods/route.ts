import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireCountsContext } from "@/lib/count-access"
import { getInventoryPeriods, periodSalesWindow } from "@/lib/reports"
import { getSyncedThrough } from "@/lib/sales-sync"

// GET /api/inventory/reports/periods?storeId= — the period picker's data:
// inventory periods (newest first) + how far the sales cache reaches.
export async function GET(req: Request) {
  const ctx = await requireCountsContext()
  if ("error" in ctx) return ctx.error

  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId")
  if (!storeId) return NextResponse.json({ error: "storeId is required" }, { status: 400 })
  if (!ctx.isAdmin && !ctx.storeIds.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const store = await prisma.store.findFirst({ where: { id: storeId, organizationId: ctx.org.id } })
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  const periods = await getInventoryPeriods(ctx.org.id, storeId)
  const syncedThrough = await getSyncedThrough(storeId)

  return NextResponse.json({
    squareLinked: !!store.squareLocationId && !!ctx.org.squareAccessToken,
    syncedThrough,
    timezone: store.timezone,
    periods: periods
      .map((p) => {
        const window = periodSalesWindow(p, store.timezone)
        return {
          beginCountId: p.begin.countId,
          endCountId: p.end.countId,
          label: `${p.begin.name ?? window.start} → ${p.end.name ?? window.end}`,
          startDate: window.start,
          endDate: window.end,
          beginValue: p.begin.value,
          endValue: p.end.value,
          beginFinalizedAt: p.begin.finalizedAt.toISOString(),
          endFinalizedAt: p.end.finalizedAt.toISOString(),
        }
      })
      .reverse(),
  })
}
