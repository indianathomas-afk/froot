/**
 * Phase F acceptance fixture — goal engine smoke test.
 *
 *   npx tsx scripts/verify-goal-engine.ts
 *
 * Creates a throwaway store in the first org, seeds a deterministic year of
 * 2025 SalesPeriodCache rows, then asserts:
 *   1. buildLastYearBasis is weekday-aligned (−364) with the same-calendar-date
 *      fallback for late-December, and covers all 365/366 days.
 *   2. regeneratePlan at +5% makes every month total EXACTLY
 *      round2(monthBasis × 1.05) (rounding drift lands on the month's last day).
 *   3. A day override survives a % recalculation (preserveOverrides).
 *   4. resetOverrides wipes it.
 *   5. redistributeMonth hits the requested total to the penny, weighted by basis.
 *   6. "Remaining days only" recalc leaves days before the cutoff untouched.
 * The store (and via cascade, its caches/plan/goals) is deleted afterwards.
 */
import "dotenv/config"
import { prisma } from "../src/lib/prisma"
import {
  buildLastYearBasis,
  redistributeMonth,
  regeneratePlan,
  round2,
  yearDates,
} from "../src/lib/goal-engine"

const YEAR = 2026
const LY = YEAR - 1

function dbDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`)
}

// Deterministic LY sales: $100 base + $25 × weekday + day-of-month cents.
function lySales(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  return round2(100 + 25 * d.getUTCDay() + d.getUTCDate() / 100)
}

let failures = 0
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures += 1
}

async function main() {
  const org = await prisma.organization.findFirst()
  if (!org) throw new Error("No organization in this database")

  const store = await prisma.store.create({
    data: { organizationId: org.id, name: "ZZ Goal Engine Fixture (safe to delete)" },
  })
  console.log(`Fixture store ${store.id} in org ${org.name}\n`)

  try {
    // Seed all of LY.
    await prisma.salesPeriodCache.createMany({
      data: yearDates(LY).map((dateStr) => ({
        organizationId: org.id,
        storeId: store.id,
        date: dbDate(dateStr),
        netSales: lySales(dateStr),
        grossSales: lySales(dateStr) * 1.08,
        taxTotal: lySales(dateStr) * 0.08,
        orderCount: 10,
      })),
    })

    // 1. Basis: weekday-aligned + fallback, full coverage.
    const coverage = await buildLastYearBasis(store.id, YEAR)
    check("basis covers every day", coverage.uncoveredDays === 0, `${coverage.uncoveredDays} uncovered`)
    const probe = `${YEAR}-06-15`
    const aligned = new Date(`${probe}T00:00:00.000Z`)
    aligned.setUTCDate(aligned.getUTCDate() - 364)
    const alignedStr = aligned.toISOString().slice(0, 10)
    check(
      "basis is weekday-aligned (−364)",
      coverage.basisByDay.get(probe) === lySales(alignedStr),
      `${probe} ← ${alignedStr}`
    )
    check(
      "weekday matches across the alignment",
      new Date(`${probe}T00:00:00Z`).getUTCDay() === new Date(`${alignedStr}T00:00:00Z`).getUTCDay()
    )
    // Late December falls outside −364 coverage → same-calendar-date fallback.
    const dec31 = coverage.basisByDay.get(`${YEAR}-12-31`)
    check("Dec 31 uses a fallback (not zero)", dec31 !== undefined && dec31 > 0, `got ${dec31}`)

    // 2. +5% plan: month totals exact.
    const PCT = 5
    await regeneratePlan({
      organizationId: org.id,
      storeId: store.id,
      year: YEAR,
      basisType: "SQUARE_LAST_YEAR",
      increasePct: PCT,
      basisByDay: coverage.basisByDay,
      updatedById: "fixture",
    })
    const goals = await prisma.dailyGoal.findMany({ where: { storeId: store.id } })
    check("365 DailyGoal rows", goals.length === yearDates(YEAR).length, `${goals.length}`)
    let monthsExact = true
    for (let m = 1; m <= 12; m++) {
      const mm = `${YEAR}-${String(m).padStart(2, "0")}`
      const monthGoals = goals.filter((g) => g.date.toISOString().startsWith(mm))
      const monthBasis = monthGoals.reduce((s, g) => s + g.basisAmount, 0)
      const monthGoal = round2(monthGoals.reduce((s, g) => s + g.goalAmount, 0))
      if (monthGoal !== round2(round2(monthBasis) * (1 + PCT / 100))) {
        monthsExact = false
        console.log(`   month ${mm}: goal ${monthGoal} vs expected ${round2(round2(monthBasis) * 1.05)}`)
      }
    }
    check("every month total = round2(basis × 1.05) exactly", monthsExact)
    const plan = await prisma.goalPlan.findUniqueOrThrow({ where: { storeId_year: { storeId: store.id, year: YEAR } } })
    check(
      "plan totals denormalized",
      plan.basisTotal === coverage.basisTotal && plan.goalTotal === round2(goals.reduce((s, g) => s + g.goalAmount, 0))
    )

    // 3. Override survives a % recalc.
    const overrideDate = `${YEAR}-03-10`
    await prisma.dailyGoal.update({
      where: { storeId_date: { storeId: store.id, date: dbDate(overrideDate) } },
      data: { goalAmount: 999.99, isOverride: true },
    })
    await regeneratePlan({
      organizationId: org.id,
      storeId: store.id,
      year: YEAR,
      basisType: "SQUARE_LAST_YEAR",
      increasePct: 10,
      basisByDay: coverage.basisByDay,
      updatedById: "fixture",
      preserveOverrides: true,
    })
    const kept = await prisma.dailyGoal.findUniqueOrThrow({
      where: { storeId_date: { storeId: store.id, date: dbDate(overrideDate) } },
    })
    check("override survives +10% recalc", kept.goalAmount === 999.99 && kept.isOverride)
    const neighbor = await prisma.dailyGoal.findUniqueOrThrow({
      where: { storeId_date: { storeId: store.id, date: dbDate(`${YEAR}-03-11`) } },
    })
    check("non-override day rescaled to +10%", neighbor.goalAmount === round2(neighbor.basisAmount * 1.1))

    // 4. resetOverrides wipes it.
    await regeneratePlan({
      organizationId: org.id,
      storeId: store.id,
      year: YEAR,
      basisType: "SQUARE_LAST_YEAR",
      increasePct: 10,
      basisByDay: coverage.basisByDay,
      updatedById: "fixture",
      preserveOverrides: false,
    })
    const reset = await prisma.dailyGoal.findUniqueOrThrow({
      where: { storeId_date: { storeId: store.id, date: dbDate(overrideDate) } },
    })
    check("resetOverrides recalculates the overridden day", !reset.isOverride && reset.goalAmount !== 999.99)

    // 5. Month redistribution to the penny.
    await redistributeMonth(plan.id, store.id, `${YEAR}-07`, 50000)
    const july = await prisma.dailyGoal.findMany({
      where: { storeId: store.id, date: { gte: dbDate(`${YEAR}-07-01`), lte: dbDate(`${YEAR}-07-31`) } },
    })
    check("July redistributed to exactly $50,000", round2(july.reduce((s, g) => s + g.goalAmount, 0)) === 50000)
    check("all July days marked override", july.every((g) => g.isOverride))
    const j1 = july.find((g) => g.date.toISOString().startsWith(`${YEAR}-07-01`))!
    const j4 = july.find((g) => g.date.toISOString().startsWith(`${YEAR}-07-04`))!
    check(
      "redistribution follows basis weights",
      Math.abs(j1.goalAmount / j4.goalAmount - j1.basisAmount / j4.basisAmount) < 0.001
    )

    // 6. Remaining-days-only recalc freezes the past.
    const cutoff = `${YEAR}-09-01`
    const beforeRow = await prisma.dailyGoal.findUniqueOrThrow({
      where: { storeId_date: { storeId: store.id, date: dbDate(`${YEAR}-02-14`) } },
    })
    await regeneratePlan({
      organizationId: org.id,
      storeId: store.id,
      year: YEAR,
      basisType: "SQUARE_LAST_YEAR",
      increasePct: 20,
      basisByDay: coverage.basisByDay,
      updatedById: "fixture",
      preserveOverrides: false,
      fromDate: cutoff,
    })
    const feb = await prisma.dailyGoal.findUniqueOrThrow({
      where: { storeId_date: { storeId: store.id, date: dbDate(`${YEAR}-02-14`) } },
    })
    const oct = await prisma.dailyGoal.findUniqueOrThrow({
      where: { storeId_date: { storeId: store.id, date: dbDate(`${YEAR}-10-14`) } },
    })
    check("day before cutoff untouched", feb.goalAmount === beforeRow.goalAmount)
    check("day after cutoff at +20%", oct.goalAmount === round2(oct.basisAmount * 1.2))
  } finally {
    await prisma.store.delete({ where: { id: store.id } })
    console.log("\nFixture store deleted.")
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`)
    process.exit(1)
  }
  console.log("\nAll goal-engine checks passed.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
