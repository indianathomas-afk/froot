import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireCountsContext } from "@/lib/count-access"

// GET /api/inventory/reports/vendor-spend?storeId=&from=&to= — received value
// per vendor over the window (storeId optional = all stores in scope), monthly
// trend, and average lead time (receivedAt − orderedAt) in days.
export async function GET(req: Request) {
  const ctx = await requireCountsContext()
  if ("error" in ctx) return ctx.error

  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId")
  const from = url.searchParams.get("from")
  const to = url.searchParams.get("to")
  if (storeId && !ctx.isAdmin && !ctx.storeIds.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const after = from ? new Date(`${from}T00:00:00.000Z`) : new Date(0)
  const through = to ? new Date(`${to}T23:59:59.999Z`) : new Date()

  const lines = await prisma.purchaseOrderLine.findMany({
    where: {
      receivedAt: { gte: after, lte: through },
      quantityReceived: { gt: 0 },
      purchaseOrder: {
        organizationId: ctx.org.id,
        ...(storeId ? { storeId } : ctx.isAdmin ? {} : { storeId: { in: ctx.storeIds } }),
      },
    },
    include: { purchaseOrder: { include: { vendor: true } } },
  })

  type VendorRow = {
    vendorId: string
    vendorName: string
    total: number
    poIds: Set<string>
    leadTimes: number[]
    monthly: Map<string, number>
  }
  const byVendor = new Map<string, VendorRow>()

  for (const l of lines) {
    const po = l.purchaseOrder
    const row: VendorRow = byVendor.get(po.vendorId) ?? {
      vendorId: po.vendorId,
      vendorName: po.vendor.name,
      total: 0,
      poIds: new Set<string>(),
      leadTimes: [],
      monthly: new Map<string, number>(),
    }
    const value = l.quantityReceived * l.unitCost
    row.total += value
    if (!row.poIds.has(po.id)) {
      row.poIds.add(po.id)
      if (po.orderedAt && l.receivedAt) {
        row.leadTimes.push((l.receivedAt.getTime() - po.orderedAt.getTime()) / (24 * 60 * 60 * 1000))
      }
    }
    const month = (l.receivedAt as Date).toISOString().slice(0, 7)
    row.monthly.set(month, (row.monthly.get(month) ?? 0) + value)
    byVendor.set(po.vendorId, row)
  }

  const vendors = [...byVendor.values()]
    .map((v) => ({
      vendorId: v.vendorId,
      vendorName: v.vendorName,
      total: v.total,
      poCount: v.poIds.size,
      avgLeadTimeDays: v.leadTimes.length
        ? v.leadTimes.reduce((s, d) => s + d, 0) / v.leadTimes.length
        : null,
      monthly: [...v.monthly.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, value]) => ({ month, value })),
    }))
    .sort((a, b) => b.total - a.total)

  return NextResponse.json({ vendors, total: vendors.reduce((s, v) => s + v.total, 0) })
}
