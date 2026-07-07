import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { getCurrentUser } from "@/lib/auth"
import { requireCountsContext } from "@/lib/count-access"

// POST /api/inventory/orders — the Cart Builder's "create orders": one DRAFT
// PurchaseOrder per vendor from a mixed-vendor cart. From there the existing
// submit → receive lifecycle takes over. quantityOrdered is in PURCHASE units
// (cases), matching PurchaseOrderLine semantics.

const CartLineSchema = z.object({
  ingredientId: z.string().min(1),
  vendorId: z.string().min(1),
  quantityOrdered: z.number().positive(),
  unitCost: z.number().nonnegative(),
})

const CreateOrdersSchema = z.object({
  storeId: z.string().min(1),
  lines: z.array(CartLineSchema).min(1),
})

export async function POST(req: Request) {
  const ctx = await requireCountsContext()
  if ("error" in ctx) return ctx.error
  if (!ctx.canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await req.json()
  const data = CreateOrdersSchema.parse(body)

  if (!ctx.isAdmin && !ctx.storeIds.includes(data.storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const store = await prisma.store.findFirst({ where: { id: data.storeId, organizationId: ctx.org.id } })
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  const vendorIds = [...new Set(data.lines.map((l) => l.vendorId))]
  const vendors = await prisma.vendor.findMany({ where: { id: { in: vendorIds }, organizationId: ctx.org.id } })
  const vendorById = new Map(vendors.map((v) => [v.id, v]))
  for (const id of vendorIds) {
    if (!vendorById.has(id)) return NextResponse.json({ error: `Vendor ${id} not found` }, { status: 404 })
  }

  const ingredientIds = [...new Set(data.lines.map((l) => l.ingredientId))]
  const ingredients = await prisma.ingredient.findMany({
    where: { id: { in: ingredientIds }, organizationId: ctx.org.id },
  })
  const ingredientById = new Map(ingredients.map((i) => [i.id, i]))
  for (const line of data.lines) {
    if (!ingredientById.has(line.ingredientId)) {
      return NextResponse.json({ error: `Ingredient ${line.ingredientId} not found` }, { status: 404 })
    }
  }

  const { dbUser } = await getCurrentUser()

  const byVendor = new Map<string, typeof data.lines>()
  for (const line of data.lines) {
    const list = byVendor.get(line.vendorId) ?? []
    list.push(line)
    byVendor.set(line.vendorId, list)
  }

  const now = new Date()
  const created = await prisma.$transaction(async (tx) => {
    const existing = await tx.purchaseOrder.count({ where: { organizationId: ctx.org.id } })
    const results: { id: string; poNumber: string; vendorId: string; vendorName: string; totalAmount: number }[] = []
    let seq = 0
    for (const [vendorId, lines] of byVendor) {
      const vendor = vendorById.get(vendorId)!
      // Default the expected date from the vendor's lead time when set.
      const expectedAt = vendor.leadTimeDays
        ? new Date(now.getTime() + vendor.leadTimeDays * 86_400_000)
        : null
      const totalAmount = lines.reduce((s, l) => s + l.quantityOrdered * l.unitCost, 0)
      const po = await tx.purchaseOrder.create({
        data: {
          organizationId: ctx.org.id,
          storeId: data.storeId,
          vendorId,
          poNumber: `PO-${String(existing + ++seq).padStart(5, "0")}`,
          expectedAt,
          totalAmount,
          status: "DRAFT",
          enteredByUserId: dbUser?.id ?? null,
          lines: {
            create: lines.map((l) => {
              const ing = ingredientById.get(l.ingredientId)!
              return {
                ingredientId: l.ingredientId,
                ingredientName: ing.brand ? `${ing.brand} ${ing.name}` : ing.name,
                quantityOrdered: l.quantityOrdered,
                unitCost: l.unitCost,
                lineTotal: l.quantityOrdered * l.unitCost,
              }
            }),
          },
        },
      })
      results.push({ id: po.id, poNumber: po.poNumber, vendorId, vendorName: vendor.name, totalAmount })
    }
    return results
  })

  return NextResponse.json({ orders: created }, { status: 201 })
}
