import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireLaborContext, requireLaborStore } from "@/lib/labor-access"
import { dbDate, localDateStr } from "@/lib/reports"
import { mondayOfWeekStr } from "@/lib/labor-week"
import { getWeeklyDayPlan } from "@/lib/labor-plan"

// L-3B cross-day rebalancing writes. PUT replaces a week's per-DATE hour
// overrides (only the days the manager pinned); the remaining days keep the
// floor-first split of whatever weekly hours are left. DELETE clears the week's
// overrides (back to floor-first). Constrained so the pinned overrides never
// exceed the weekly hourly total. ADMIN/MANAGER only.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TOLERANCE = 0.5 // absorb 0.5-hr split flooring

const putSchema = z.object({
  storeId: z.string().min(1),
  weekStart: z.string().regex(DATE_RE),
  overrides: z
    .array(z.object({ date: z.string().regex(DATE_RE), hours: z.number().min(0).max(999) }))
    .max(7),
})

export async function PUT(req: Request) {
  const ctx = await requireLaborContext({ write: true })
  if ("error" in ctx) return ctx.error
  const parsed = putSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  const { storeId, overrides } = parsed.data
  const weekStart = mondayOfWeekStr(parsed.data.weekStart)

  const store = await requireLaborStore(ctx, storeId)
  if ("error" in store) return store.error

  // Every override date must fall inside this Monday-anchored week.
  const weekDates = new Set(Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${weekStart}T00:00:00.000Z`)
    d.setUTCDate(d.getUTCDate() + i)
    return d.toISOString().slice(0, 10)
  }))
  if (overrides.some((o) => !weekDates.has(o.date))) {
    return NextResponse.json({ error: "Override date is outside the target week" }, { status: 400 })
  }
  // No duplicate dates.
  if (new Set(overrides.map((o) => o.date)).size !== overrides.length) {
    return NextResponse.json({ error: "Duplicate override date" }, { status: 400 })
  }

  // Constraint: pinned hours can't exceed the weekly hourly total (else the
  // remaining floor-first days would go negative / over-budget).
  const today = localDateStr(new Date(), store.timezone)
  const plan = await getWeeklyDayPlan(storeId, weekStart, today)
  if (!plan.budget) return NextResponse.json({ error: "No budget for this week" }, { status: 409 })
  const sum = overrides.reduce((s, o) => s + o.hours, 0)
  if (sum > plan.weeklyHourlyHours + TOLERANCE) {
    return NextResponse.json(
      { error: `Pinned hours (${sum.toFixed(1)}) exceed the week's hourly budget (${plan.weeklyHourlyHours.toFixed(1)}).`, weeklyHourlyHours: plan.weeklyHourlyHours },
      { status: 422 }
    )
  }

  const createdById = ctx.dbUser?.id ?? ctx.userId
  await prisma.$transaction([
    // Replace the week's overrides with exactly the pinned set.
    prisma.weeklyDayHours.deleteMany({ where: { storeId, weekStart: dbDate(weekStart) } }),
    ...overrides.map((o) =>
      prisma.weeklyDayHours.create({
        data: {
          organizationId: ctx.org.id,
          storeId,
          weekStart: dbDate(weekStart),
          date: dbDate(o.date),
          hoursOverride: o.hours,
          createdById,
        },
      })
    ),
  ])

  return NextResponse.json({ ok: true, weeklyHourlyHours: plan.weeklyHourlyHours })
}

// DELETE ?storeId=&weekStart= — clear the week's overrides (reset to floor-first).
export async function DELETE(req: Request) {
  const ctx = await requireLaborContext({ write: true })
  if ("error" in ctx) return ctx.error
  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId") ?? ""
  const weekStartParam = url.searchParams.get("weekStart") ?? ""
  if (!DATE_RE.test(weekStartParam)) return NextResponse.json({ error: "weekStart required" }, { status: 400 })
  const weekStart = mondayOfWeekStr(weekStartParam)

  const store = await requireLaborStore(ctx, storeId)
  if ("error" in store) return store.error

  await prisma.weeklyDayHours.deleteMany({ where: { storeId, weekStart: dbDate(weekStart) } })
  return NextResponse.json({ ok: true })
}
