import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireCountsContext } from "@/lib/count-access"

// GET /api/inventory/reports/valuation?date=yyyy-mm-dd (default today) —
// sitting inventory value per store in scope: the latest finalized, non-partial
// count on or before the date, plus a company-wide total.
export async function GET(req: Request) {
  const ctx = await requireCountsContext()
  if ("error" in ctx) return ctx.error

  const url = new URL(req.url)
  const dateStr = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10)
  const asOf = new Date(`${dateStr}T23:59:59.999Z`)

  const stores = await prisma.store.findMany({
    where: { organizationId: ctx.org.id, isActive: true, ...(ctx.isAdmin ? {} : { id: { in: ctx.storeIds } }) },
    orderBy: { name: "asc" },
  })

  const rows = await Promise.all(
    stores.map(async (store) => {
      const count = await prisma.inventoryCount.findFirst({
        where: {
          organizationId: ctx.org.id,
          storeId: store.id,
          status: "Finalized",
          isPartial: false,
          finalizedAt: { lte: asOf },
        },
        orderBy: { finalizedAt: "desc" },
        select: { id: true, name: true, finalizedAt: true, sittingInventoryVal: true },
      })
      return {
        storeId: store.id,
        storeName: store.name,
        value: count?.sittingInventoryVal ?? null,
        countId: count?.id ?? null,
        countName: count?.name ?? null,
        countFinalizedAt: count?.finalizedAt?.toISOString() ?? null,
      }
    })
  )

  const total = rows.reduce((s, r) => s + (r.value ?? 0), 0)
  return NextResponse.json({ asOf: dateStr, stores: rows, total })
}
