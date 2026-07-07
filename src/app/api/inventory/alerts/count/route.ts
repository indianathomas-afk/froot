import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireCountsContext } from "@/lib/count-access"
import { computeLowStockAlerts } from "@/lib/expected-inventory"

// GET /api/inventory/alerts/count — total low-stock alerts across the caller's
// stores; feeds the sidebar badge. Runs the full expected-inventory engine, so
// callers should fetch it once per page load, not poll.
export async function GET() {
  const ctx = await requireCountsContext()
  if ("error" in ctx) return ctx.error

  const stores = await prisma.store.findMany({
    where: { organizationId: ctx.org.id, isActive: true, ...(ctx.isAdmin ? {} : { id: { in: ctx.storeIds } }) },
  })

  const results = await Promise.all(stores.map((store) => computeLowStockAlerts(ctx.org, store)))
  const count = results.reduce((s, r) => s + r.alerts.length, 0)
  return NextResponse.json({ count })
}
