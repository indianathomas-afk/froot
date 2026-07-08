import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireCountsContext } from "@/lib/count-access"
import { computeLowStockAlerts } from "@/lib/expected-inventory"

// GET /api/inventory/alerts[?storeId=] — low-stock alerts grouped by store.
// Without storeId, every store in the caller's scope is evaluated.
export async function GET(req: Request) {
  const ctx = await requireCountsContext()
  if ("error" in ctx) return ctx.error

  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId")
  if (storeId && !ctx.isAdmin && !ctx.storeIds.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const stores = await prisma.store.findMany({
    where: {
      organizationId: ctx.org.id,
      isActive: true,
      ...(storeId ? { id: storeId } : ctx.isAdmin ? {} : { id: { in: ctx.storeIds } }),
    },
    orderBy: { name: "asc" },
  })
  if (storeId && stores.length === 0) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 })
  }

  const results = await Promise.all(stores.map((store) => computeLowStockAlerts(ctx.org, store)))
  return NextResponse.json({ stores: results })
}
