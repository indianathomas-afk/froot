import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { getCurrentUser, getUserStoreScope, requireManagerOrAdmin, requireModule } from "@/lib/auth"

const LineSchema = z.object({
  ingredientId: z.string().min(1),
  quantityOrdered: z.number().positive(),
  unitCost: z.number().nonnegative(),
})

const CreateSchema = z.object({
  storeId: z.string().min(1),
  vendorId: z.string().min(1),
  invoiceNumber: z.string().optional().nullable(),
  expectedAt: z.string().datetime().optional().nullable(),
  lines: z.array(LineSchema).min(1),
})

async function nextPoNumber(organizationId: string) {
  const count = await prisma.purchaseOrder.count({ where: { organizationId } })
  return `PO-${String(count + 1).padStart(5, "0")}`
}

export async function GET(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  try {
    await requireModule("inventory")
  } catch {
    return NextResponse.json({ error: "MODULE_NOT_ACTIVE" }, { status: 403 })
  }

  const { isAdmin, storeIds } = await getUserStoreScope()

  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId")
  const status = url.searchParams.get("status")
  const from = url.searchParams.get("from")
  const to = url.searchParams.get("to")

  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where: {
      organizationId: org.id,
      ...(isAdmin ? {} : { storeId: { in: storeIds } }),
      ...(storeId ? { storeId } : {}),
      ...(status ? { status } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
    },
    include: { store: true, vendor: true, lines: { include: { ingredient: true } } },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(purchaseOrders)
}

export async function POST(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  try {
    await requireModule("inventory")
  } catch {
    return NextResponse.json({ error: "MODULE_NOT_ACTIVE" }, { status: 403 })
  }

  try {
    await requireManagerOrAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { isAdmin, storeIds } = await getUserStoreScope()
  const { dbUser } = await getCurrentUser()

  const body = await req.json()
  const data = CreateSchema.parse(body)

  if (!isAdmin && !storeIds.includes(data.storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const store = await prisma.store.findFirst({ where: { id: data.storeId, organizationId: org.id } })
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  const vendor = await prisma.vendor.findFirst({ where: { id: data.vendorId, organizationId: org.id } })
  if (!vendor) return NextResponse.json({ error: "Vendor not found" }, { status: 404 })

  const ingredients = await prisma.ingredient.findMany({
    where: { id: { in: data.lines.map((l) => l.ingredientId) }, organizationId: org.id },
  })
  const ingredientById = new Map(ingredients.map((i) => [i.id, i]))
  for (const line of data.lines) {
    if (!ingredientById.has(line.ingredientId)) {
      return NextResponse.json({ error: `Ingredient ${line.ingredientId} not found` }, { status: 404 })
    }
  }

  const totalAmount = data.lines.reduce((sum, l) => sum + l.quantityOrdered * l.unitCost, 0)

  const purchaseOrder = await prisma.purchaseOrder.create({
    data: {
      organizationId: org.id,
      storeId: data.storeId,
      vendorId: data.vendorId,
      poNumber: await nextPoNumber(org.id),
      invoiceNumber: data.invoiceNumber || null,
      expectedAt: data.expectedAt ? new Date(data.expectedAt) : null,
      totalAmount,
      status: "DRAFT",
      enteredByUserId: dbUser?.id ?? null,
      lines: {
        create: data.lines.map((l) => {
          const ingredient = ingredientById.get(l.ingredientId)!
          return {
            ingredientId: l.ingredientId,
            ingredientName: ingredient.brand ? `${ingredient.brand} ${ingredient.name}` : ingredient.name,
            quantityOrdered: l.quantityOrdered,
            unitCost: l.unitCost,
            lineTotal: l.quantityOrdered * l.unitCost,
          }
        }),
      },
    },
    include: { lines: true, store: true, vendor: true },
  })

  return NextResponse.json(purchaseOrder, { status: 201 })
}
