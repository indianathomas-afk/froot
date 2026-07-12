/**
 * Phase F-4 acceptance fixture — all-locations rollup + Square webhook.
 *
 *   npx tsx scripts/verify-f4-rollup-webhook.ts
 *
 * Creates a throwaway org with three stores (A + B have Forecasting plans,
 * C has only a manual StoreMonthlyGoal), seeds this month's DailyGoal and
 * SalesPeriodCache rows, then asserts:
 *   1. getMonthGoal per store matches the seeded plan / manual goal exactly.
 *   2. Rollup totals (today / MTD / MTD goal / month goal) equal the
 *      per-store numbers summed.
 *   3. The rollup projection equals the goal-weighted formula applied to the
 *      summed plan totals (Σ MTD ÷ Σ MTD goal × Σ month goal), with the
 *      manual-goal store folded in via linear proration — which reduces to
 *      run-rate, matching the Monthly Goal card.
 *   4. The Square webhook handler accepts a correctly signed payload (200),
 *      rejects a bad signature and a missing header (401), and ignores an
 *      unknown location without erroring (200).
 * Everything (org, stores, plans, caches) is deleted afterwards.
 */
import "dotenv/config"
import { prisma } from "../src/lib/prisma"
import { localDateStr, dbDate } from "../src/lib/reports"
import { round2, monthStart, daysInMonth, projectMonthEnd, computeRollup, effectiveMtdGoal, type RollupStoreInput } from "../src/lib/pacing"
import { getMonthGoal } from "../src/lib/month-goal"
import { squareWebhookSignature, SQUARE_SIGNATURE_HEADER } from "../src/lib/square-webhook"
import { POST as squareWebhookPost } from "../src/app/api/webhooks/square/route"

const TZ = "America/Los_Angeles"

let failures = 0
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures += 1
}

function eachMonthDate(mStart: string, through: string): string[] {
  const out: string[] = []
  const d = new Date(`${mStart}T00:00:00.000Z`)
  const end = new Date(`${through}T00:00:00.000Z`)
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

async function main() {
  const tag = Math.random().toString(36).slice(2, 8)
  const today = localDateStr(new Date(), TZ)
  const mStart = monthStart(today)
  const totalDays = daysInMonth(today)
  const monthEnd = `${mStart.slice(0, 7)}-${String(totalDays).padStart(2, "0")}`
  const daysElapsed = Number(today.slice(8, 10))
  const monthDates = eachMonthDate(mStart, monthEnd)
  const mtdDates = eachMonthDate(mStart, today)

  // Deterministic per-day amounts: goals and sales differ so pace ≠ 100%.
  const goalFor = (storeIdx: number, dayIdx: number) => round2(1000 * storeIdx + 10 * (dayIdx + 1))
  const salesFor = (storeIdx: number, dayIdx: number) => round2(900 * storeIdx + 12 * (dayIdx + 1))

  // Throwaway org — NO Square token, so webhook processing stops safely after
  // the store lookup instead of calling the real Square API.
  const org = await prisma.organization.create({
    data: { clerkOrgId: `fixture-f4-${tag}`, name: "ZZ F-4 Fixture Org (safe to delete)", activeModules: ["inventory"] },
  })
  console.log(`Fixture org ${org.id} · month ${mStart} · ${daysElapsed}/${totalDays} days elapsed\n`)

  try {
    // Stores A/B: plan-backed. Store C: manual goal only.
    const [storeA, storeB, storeC] = await Promise.all(
      [1, 2, 3].map((i) =>
        prisma.store.create({
          data: {
            organizationId: org.id,
            name: `ZZ F-4 Fixture Store ${i}`,
            timezone: TZ,
            squareLocationId: `FIXTURE-F4-${tag}-${i}`,
          },
        })
      )
    )

    for (const [idx, store] of [storeA, storeB].entries()) {
      const storeIdx = idx + 1
      const plan = await prisma.goalPlan.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          year: Number(today.slice(0, 4)),
          basisType: "MANUAL",
          updatedById: "fixture",
        },
      })
      await prisma.dailyGoal.createMany({
        data: monthDates.map((dateStr, dayIdx) => ({
          planId: plan.id,
          storeId: store.id,
          date: dbDate(dateStr),
          basisAmount: goalFor(storeIdx, dayIdx),
          goalAmount: goalFor(storeIdx, dayIdx),
        })),
      })
    }
    const manualGoalC = 45000
    await prisma.storeMonthlyGoal.create({
      data: { organizationId: org.id, storeId: storeC.id, month: dbDate(mStart), goalAmount: manualGoalC },
    })

    for (const [idx, store] of [storeA, storeB, storeC].entries()) {
      const storeIdx = idx + 1
      await prisma.salesPeriodCache.createMany({
        data: mtdDates.map((dateStr, dayIdx) => ({
          organizationId: org.id,
          storeId: store.id,
          date: dbDate(dateStr),
          netSales: salesFor(storeIdx, dayIdx),
          grossSales: salesFor(storeIdx, dayIdx) * 1.08,
          taxTotal: salesFor(storeIdx, dayIdx) * 0.08,
          orderCount: 5,
        })),
      })
    }

    // Hand-computed expectations.
    const sum = (n: number, f: (dayIdx: number) => number) => round2(Array.from({ length: n }, (_, i) => f(i)).reduce((s, v) => s + v, 0))
    const monthGoalA = sum(totalDays, (i) => goalFor(1, i))
    const monthGoalB = sum(totalDays, (i) => goalFor(2, i))
    const mtdGoalA = sum(daysElapsed, (i) => goalFor(1, i))
    const mtdGoalB = sum(daysElapsed, (i) => goalFor(2, i))
    const mtdA = sum(daysElapsed, (i) => salesFor(1, i))
    const mtdB = sum(daysElapsed, (i) => salesFor(2, i))
    const mtdC = sum(daysElapsed, (i) => salesFor(3, i))
    const todayNetAll = round2(salesFor(1, daysElapsed - 1) + salesFor(2, daysElapsed - 1) + salesFor(3, daysElapsed - 1))

    // 1. getMonthGoal per store.
    const [goalA, goalB, goalC] = await Promise.all([storeA, storeB, storeC].map((s) => getMonthGoal(s.id, today)))
    check("store A: plan month goal", goalA.source === "plan" && goalA.goalAmount === monthGoalA, `${goalA.goalAmount} vs ${monthGoalA}`)
    check("store A: plan MTD goal", goalA.mtdGoal === mtdGoalA, `${goalA.mtdGoal} vs ${mtdGoalA}`)
    check("store B: plan month goal", goalB.source === "plan" && goalB.goalAmount === monthGoalB)
    check("store C: manual goal, no MTD distribution", goalC.source === "manual" && goalC.goalAmount === manualGoalC && goalC.mtdGoal === null)

    // 2 + 3. Rollup sums and projection — same inputs the rollup route builds.
    const inputs: RollupStoreInput[] = [
      { todayNet: salesFor(1, daysElapsed - 1), mtdActual: mtdA, mtdGoal: goalA.mtdGoal, monthGoal: goalA.goalAmount, goalSource: goalA.source, daysElapsed, daysInMonth: totalDays },
      { todayNet: salesFor(2, daysElapsed - 1), mtdActual: mtdB, mtdGoal: goalB.mtdGoal, monthGoal: goalB.goalAmount, goalSource: goalB.source, daysElapsed, daysInMonth: totalDays },
      { todayNet: salesFor(3, daysElapsed - 1), mtdActual: mtdC, mtdGoal: goalC.mtdGoal, monthGoal: goalC.goalAmount, goalSource: goalC.source, daysElapsed, daysInMonth: totalDays },
    ]
    const totals = computeRollup(inputs)
    check("rollup today = per-store today summed", totals.todayNet === todayNetAll, `${totals.todayNet} vs ${todayNetAll}`)
    check("rollup MTD = per-store MTD summed", totals.mtdActual === round2(mtdA + mtdB + mtdC))
    const proratedC = round2(manualGoalC * (daysElapsed / totalDays))
    check("rollup MTD goal = plan sums + prorated manual", totals.mtdGoal === round2(mtdGoalA + mtdGoalB + proratedC), `${totals.mtdGoal}`)
    check("rollup month goal = per-store goals summed", totals.monthGoal === round2(monthGoalA + monthGoalB + manualGoalC))
    const expectedProjected = round2(
      ((mtdA + mtdB + mtdC) / (mtdGoalA + mtdGoalB + proratedC)) * (monthGoalA + monthGoalB + manualGoalC)
    )
    check("rollup projection = goal-weighted formula on summed totals", totals.projected === expectedProjected, `${totals.projected} vs ${expectedProjected}`)
    // Manual-goal proration reduces to the card's run-rate for that store.
    const projC = projectMonthEnd({ mtdActual: mtdC, mtdGoal: effectiveMtdGoal(inputs[2]), monthGoal: manualGoalC, daysElapsed, daysInMonth: totalDays })
    const runRateC = (mtdC / daysElapsed) * totalDays
    check("manual store: prorated goal-weighting == run-rate", Math.abs(projC - runRateC) < 0.02, `${round2(projC)} vs ${round2(runRateC)}`)

    // 4. Webhook handler: signed accept, bad signature reject.
    const signatureKey = `fixture-key-${tag}`
    process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = signatureKey
    process.env.NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://fixture.usefroot.test"
    const notificationUrl = new URL("/api/webhooks/square", process.env.NEXT_PUBLIC_APP_URL).toString()
    const nowIso = new Date().toISOString()
    const makeBody = (locationId: string) =>
      JSON.stringify({
        merchant_id: "FIXTURE",
        type: "order.updated",
        event_id: `evt-${tag}`,
        created_at: nowIso,
        data: {
          type: "order_updated",
          id: `order-${tag}`,
          object: { order_updated: { order_id: `order-${tag}`, location_id: locationId, state: "OPEN", created_at: nowIso, updated_at: nowIso } },
        },
      })
    const callWebhook = (body: string, signature: string | null) =>
      squareWebhookPost(
        new Request(notificationUrl, {
          method: "POST",
          headers: signature === null ? {} : { [SQUARE_SIGNATURE_HEADER]: signature },
          body,
        })
      )

    const goodBody = makeBody(storeA.squareLocationId!)
    const goodSig = squareWebhookSignature(notificationUrl, goodBody, signatureKey)
    const accepted = await callWebhook(goodBody, goodSig)
    check("webhook: signed payload accepted", accepted.status === 200, `status ${accepted.status}`)

    // Signed with the wrong key — same length, guaranteed mismatch.
    const badSig = squareWebhookSignature(notificationUrl, goodBody, "not-the-key")
    const rejected = await callWebhook(goodBody, badSig)
    check("webhook: bad signature rejected with 401", rejected.status === 401, `status ${rejected.status}`)

    const missing = await callWebhook(goodBody, null)
    check("webhook: missing signature rejected with 401", missing.status === 401, `status ${missing.status}`)

    const unknownBody = makeBody(`FIXTURE-F4-${tag}-NOPE`)
    const unknown = await callWebhook(unknownBody, squareWebhookSignature(notificationUrl, unknownBody, signatureKey))
    check("webhook: unknown location acked without error", unknown.status === 200, `status ${unknown.status}`)
  } finally {
    await prisma.store.deleteMany({ where: { organizationId: org.id } })
    await prisma.organization.delete({ where: { id: org.id } })
    console.log("\nFixture org + stores deleted.")
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`)
    process.exit(1)
  }
  console.log("\nAll F-4 rollup + webhook checks passed.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
