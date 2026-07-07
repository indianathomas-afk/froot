import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireCountsContext } from "@/lib/count-access"
import { computeWeeklyUsage } from "@/lib/expected-inventory"

// Pars and reorder points per ingredient per store, in REPORTING units.

// parLevel/reorderPoint: undefined = leave unchanged (bulk edits can touch one
// field only), null = clear. A row left with both null is deleted.
const UpsertSchema = z.object({
  storeId: z.string().min(1),
  pars: z
    .array(
      z.object({
        ingredientId: z.string().min(1),
        parLevel: z.number().nonnegative().nullable().optional(),
        reorderPoint: z.number().nonnegative().nullable().optional(),
      })
    )
    .min(1),
})

// GET /api/inventory/pars?storeId= → pars + average weekly usage for the store.
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

  const [pars, weekly] = await Promise.all([
    prisma.storeIngredientPar.findMany({
      where: { storeId, organizationId: ctx.org.id },
      select: { ingredientId: true, parLevel: true, reorderPoint: true },
    }),
    computeWeeklyUsage(ctx.org, store),
  ])

  return NextResponse.json({
    pars,
    weeklyUsage: Object.fromEntries(weekly.usage),
    usageBasis: weekly.basis,
  })
}

// POST /api/inventory/pars — upsert pars (single row or bulk). A row whose
// parLevel AND reorderPoint are both null is removed entirely.
export async function POST(req: Request) {
  const ctx = await requireCountsContext()
  if ("error" in ctx) return ctx.error
  if (!ctx.canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await req.json()
  const data = UpsertSchema.parse(body)

  if (!ctx.isAdmin && !ctx.storeIds.includes(data.storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const store = await prisma.store.findFirst({ where: { id: data.storeId, organizationId: ctx.org.id } })
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  const ingredientIds = data.pars.map((p) => p.ingredientId)
  const owned = await prisma.ingredient.findMany({
    where: { id: { in: ingredientIds }, organizationId: ctx.org.id },
    select: { id: true },
  })
  const ownedIds = new Set(owned.map((i) => i.id))
  const rows = data.pars.filter((p) => ownedIds.has(p.ingredientId))
  if (rows.length === 0) return NextResponse.json({ error: "No matching ingredients" }, { status: 404 })

  await prisma.$transaction(async (tx) => {
    for (const p of rows) {
      if (p.parLevel === undefined && p.reorderPoint === undefined) continue
      await tx.storeIngredientPar.upsert({
        where: { storeId_ingredientId: { storeId: data.storeId, ingredientId: p.ingredientId } },
        create: {
          organizationId: ctx.org.id,
          storeId: data.storeId,
          ingredientId: p.ingredientId,
          parLevel: p.parLevel ?? null,
          reorderPoint: p.reorderPoint ?? null,
        },
        update: {
          ...(p.parLevel !== undefined && { parLevel: p.parLevel }),
          ...(p.reorderPoint !== undefined && { reorderPoint: p.reorderPoint }),
        },
      })
      // Fully cleared rows don't linger.
      await tx.storeIngredientPar.deleteMany({
        where: { storeId: data.storeId, ingredientId: p.ingredientId, parLevel: null, reorderPoint: null },
      })
    }
  })

  return NextResponse.json({ updated: rows.length })
}
