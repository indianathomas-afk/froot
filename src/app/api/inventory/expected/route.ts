import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireCountsContext } from "@/lib/count-access"
import { computeExpectedInventory } from "@/lib/expected-inventory"

// GET /api/inventory/expected?storeId=
// Expected on-hand per ingredient (reporting units + value) as of now, rolled
// forward from the last finalized full count. See src/lib/expected-inventory.ts.
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

  const result = await computeExpectedInventory(ctx.org, store)
  return NextResponse.json(result)
}
