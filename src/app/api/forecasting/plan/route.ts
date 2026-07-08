import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireForecastContext, requireForecastStore } from "@/lib/forecasting-access"
import { buildLastYearBasis, regeneratePlan, yearDates } from "@/lib/goal-engine"
import { localDateStr } from "@/lib/reports"

// GET /api/forecasting/plan?storeId=&year= — plan metadata (or null).
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

  const plan = await prisma.goalPlan.findUnique({ where: { storeId_year: { storeId, year } } })
  return NextResponse.json({
    plan: plan
      ? {
          id: plan.id,
          year: plan.year,
          basisType: plan.basisType,
          basisTotal: plan.basisTotal,
          increasePct: plan.increasePct,
          goalTotal: plan.goalTotal,
          importFileUrl: plan.importFileUrl,
          updatedAt: plan.updatedAt,
        }
      : null,
    canEdit: ctx.isAdmin,
  })
}

const PutSchema = z.object({
  storeId: z.string().min(1),
  year: z.number().int().min(2020).max(2100),
  // IMPORT is only accepted to re-apply a % on an already-imported plan —
  // fresh imports go through /api/forecasting/import.
  basisType: z.enum(["SQUARE_LAST_YEAR", "IMPORT", "MANUAL"]),
  increasePct: z.number().min(-100).max(1000),
  applyScope: z.enum(["all", "remaining"]).default("all"),
  resetOverrides: z.boolean().default(false),
})

// PUT /api/forecasting/plan — create or regenerate a store-year plan (admin).
// Regenerates all non-override DailyGoal rows transactionally; applyScope
// "remaining" only touches days from today (store-local) forward.
export async function PUT(req: Request) {
  const ctx = await requireForecastContext({ write: true })
  if ("error" in ctx) return ctx.error

  const parsed = PutSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 })
  }
  const { storeId, year, basisType, increasePct, applyScope, resetOverrides } = parsed.data

  const store = await requireForecastStore(ctx, storeId)
  if ("error" in store) return store.error

  let basisByDay: Map<string, number>
  if (basisType === "SQUARE_LAST_YEAR") {
    const coverage = await buildLastYearBasis(storeId, year)
    if (coverage.alignedDays + coverage.fallbackDays === 0) {
      return NextResponse.json(
        { error: "No last-year sales are cached for this store yet — import last year's Square sales first." },
        { status: 400 }
      )
    }
    basisByDay = coverage.basisByDay
  } else {
    // IMPORT / MANUAL: re-apply the % to the per-day basis already stored, so
    // no re-upload (or Square call) is needed to change the increase.
    const existing = await prisma.goalPlan.findUnique({
      where: { storeId_year: { storeId, year } },
      include: { dailyGoals: { select: { date: true, basisAmount: true } } },
    })
    if (basisType === "IMPORT" && (!existing || existing.basisType !== "IMPORT")) {
      return NextResponse.json({ error: "Import a file first — there is no imported basis for this year." }, { status: 400 })
    }
    basisByDay = new Map(yearDates(year).map((d) => [d, 0]))
    for (const g of existing?.dailyGoals ?? []) {
      basisByDay.set(g.date.toISOString().slice(0, 10), g.basisAmount)
    }
  }

  const fromDate = applyScope === "remaining" ? localDateStr(new Date(), store.timezone) : undefined
  const plan = await regeneratePlan({
    organizationId: ctx.org.id,
    storeId,
    year,
    basisType,
    increasePct,
    basisByDay,
    updatedById: ctx.userId,
    preserveOverrides: !resetOverrides,
    fromDate,
  })

  return NextResponse.json({
    plan: {
      id: plan.id,
      year,
      basisType,
      basisTotal: plan.basisTotal,
      increasePct,
      goalTotal: plan.goalTotal,
    },
  })
}
