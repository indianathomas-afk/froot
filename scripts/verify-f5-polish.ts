/**
 * Phase F-5 acceptance fixture — audit log, CSV export round-trip, pace alerts.
 *
 *   npx tsx scripts/verify-f5-polish.ts
 *
 * Creates a throwaway org (admin + assigned manager + unrelated manager) with
 * two stores, seeds a current-month plan + sales, then asserts:
 *   1. writeAuditLog persists action/entity/metadata (before → after) and
 *      swallows failures (bad org id) instead of throwing.
 *   2. The export CSV (buildForecastCsv) round-trips through the importer's
 *      parser (parseImportRows): shape detected, no errors, every day's goal
 *      survives to the penny; extra actual/variance columns are ignored.
 *   3. Pace alerts: evaluatePaceAlert fires below threshold, stays silent above
 *      it and without a goal; processPaceAlertForStore sends once with the
 *      right recipients (admin + assigned manager, not the unrelated manager),
 *      suppresses the duplicate on a second run, and skips no-plan stores.
 * Everything is deleted afterwards.
 */
import "dotenv/config"
import Papa from "papaparse"
import { prisma } from "../src/lib/prisma"
import { localDateStr, dbDate } from "../src/lib/reports"
import { addDaysStr } from "../src/lib/goal-engine"
import { monthStart, daysInMonth, round2 } from "../src/lib/pacing"
import { writeAuditLog } from "../src/lib/audit"
import { buildForecastCsv } from "../src/lib/forecast-csv"
import { parseImportRows } from "../src/lib/forecast-import"
import { evaluatePaceAlert, processPaceAlertForStore } from "../src/lib/pace-alerts"
import type { EmailMessage } from "../src/lib/notify"

const TZ = "America/Los_Angeles"

let failures = 0
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures += 1
}

function eachDate(from: string, to: string): string[] {
  const out: string[] = []
  const d = new Date(`${from}T00:00:00.000Z`)
  const end = new Date(`${to}T00:00:00.000Z`)
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

async function main() {
  const tag = Math.random().toString(36).slice(2, 8)
  const today = localDateStr(new Date(), TZ)
  const asOf = addDaysStr(today, -1) // pace alerts measure through yesterday
  if (asOf.slice(0, 7) !== today.slice(0, 7)) {
    console.log("NOTE: first of the month — pace-alert checks would be skipped; seeding last month instead is not supported. Re-run tomorrow.")
  }
  const mStart = monthStart(today)
  const year = Number(today.slice(0, 4))
  const totalDays = daysInMonth(today)
  const monthEnd = `${mStart.slice(0, 7)}-${String(totalDays).padStart(2, "0")}`
  const monthDates = eachDate(mStart, monthEnd)
  const mtdDates = eachDate(mStart, asOf)

  const org = await prisma.organization.create({
    data: { clerkOrgId: `fixture-f5-${tag}`, name: "ZZ F-5 Fixture Org (safe to delete)", activeModules: ["inventory"] },
  })
  console.log(`Fixture org ${org.id} · month ${mStart} · through ${asOf}\n`)

  try {
    const [storeBehind, storeNoPlan] = await Promise.all(
      [1, 2].map((i) =>
        prisma.store.create({
          data: { organizationId: org.id, name: `ZZ F-5 Store ${i}`, timezone: TZ },
        })
      )
    )
    const [admin, manager, otherManager] = await Promise.all([
      prisma.user.create({
        data: { clerkUserId: `fixture-f5-admin-${tag}`, organizationId: org.id, email: `f5-admin-${tag}@example.com`, role: "ADMIN" },
      }),
      prisma.user.create({
        data: { clerkUserId: `fixture-f5-mgr-${tag}`, organizationId: org.id, email: `f5-mgr-${tag}@example.com`, role: "MANAGER" },
      }),
      prisma.user.create({
        data: { clerkUserId: `fixture-f5-other-${tag}`, organizationId: org.id, email: `f5-other-${tag}@example.com`, role: "MANAGER" },
      }),
    ])
    await prisma.storeUserAssignment.create({ data: { userId: manager.id, storeId: storeBehind.id } })
    await prisma.storeUserAssignment.create({ data: { userId: otherManager.id, storeId: storeNoPlan.id } })

    // Plan: $1,000/day. Sales: $500/day → pace 50%, well behind a 90% threshold.
    const plan = await prisma.goalPlan.create({
      data: { organizationId: org.id, storeId: storeBehind.id, year, basisType: "MANUAL", updatedById: "fixture" },
    })
    await prisma.dailyGoal.createMany({
      data: monthDates.map((dateStr, i) => ({
        planId: plan.id,
        storeId: storeBehind.id,
        date: dbDate(dateStr),
        basisAmount: 1000 + i,
        goalAmount: 1000 + i,
      })),
    })
    await prisma.salesPeriodCache.createMany({
      data: mtdDates.map((dateStr) => ({
        organizationId: org.id,
        storeId: storeBehind.id,
        date: dbDate(dateStr),
        netSales: 500,
        grossSales: 540,
        taxTotal: 40,
        orderCount: 5,
      })),
    })

    // ── 1. Audit log ──
    await writeAuditLog({
      organizationId: org.id,
      userId: admin.clerkUserId,
      action: "goal.day_override",
      entityType: "daily_goal",
      entityId: "fixture-entity",
      metadata: { storeId: storeBehind.id, storeName: storeBehind.name, period: `${mStart.slice(0, 7)}-15`, before: 1014, after: 999.99, source: "day" },
    })
    const auditRow = await prisma.auditLog.findFirst({
      where: { organizationId: org.id, action: "goal.day_override" },
      orderBy: { createdAt: "desc" },
    })
    const meta = (auditRow?.metadata ?? {}) as Record<string, unknown>
    check("audit row written with action + entity", auditRow?.entityType === "daily_goal" && auditRow?.entityId === "fixture-entity")
    check("audit metadata captures before → after", meta.before === 1014 && meta.after === 999.99 && meta.source === "day")
    check("audit row records the editor", auditRow?.userId === admin.clerkUserId)
    let threw = false
    try {
      await writeAuditLog({ organizationId: "nonexistent-org", userId: null, action: "goal.day_override", entityType: "daily_goal", metadata: {} })
    } catch {
      threw = true
    }
    check("audit write failure is swallowed (never blocks the mutation)", !threw)

    // ── 2. CSV export round-trips through the importer ──
    const goals = await prisma.dailyGoal.findMany({ where: { storeId: storeBehind.id }, orderBy: { date: "asc" } })
    const actualByDate = new Map(mtdDates.map((d) => [d, 500]))
    const csv = buildForecastCsv(
      "daily",
      goals.map((g) => {
        const key = g.date.toISOString().slice(0, 10)
        return { key, goal: g.goalAmount, actual: actualByDate.get(key) ?? null }
      })
    )
    const rawRows = Papa.parse<string[]>(csv, { skipEmptyLines: true }).data
    const parsed = parseImportRows(rawRows, year)
    if ("error" in parsed) {
      check("export parses through the importer", false, parsed.error)
    } else {
      check("round-trip: shape detected as daily", parsed.shape === "daily")
      check("round-trip: no errors", parsed.errors.length === 0, parsed.errors[0])
      check("round-trip: header row dropped, all data rows kept", parsed.rowCount === goals.length, `${parsed.rowCount} vs ${goals.length}`)
      const allMatch = goals.every((g) => parsed.dailyAmounts.get(g.date.toISOString().slice(0, 10)) === round2(g.goalAmount))
      check("round-trip: every day's goal survives to the penny", allMatch)
    }

    // ── 3. Pace alerts ──
    check("evaluate: fires below threshold", evaluatePaceAlert({ mtdActual: 500, mtdGoal: 1000, thresholdPct: 90, alreadySent: false }).shouldAlert)
    check("evaluate: silent at/above threshold", !evaluatePaceAlert({ mtdActual: 950, mtdGoal: 1000, thresholdPct: 90, alreadySent: false }).shouldAlert)
    check("evaluate: silent when already sent", !evaluatePaceAlert({ mtdActual: 500, mtdGoal: 1000, thresholdPct: 90, alreadySent: true }).shouldAlert)
    check("evaluate: silent without an MTD goal", !evaluatePaceAlert({ mtdActual: 500, mtdGoal: null, thresholdPct: 90, alreadySent: false }).shouldAlert)

    if (asOf.slice(0, 7) === today.slice(0, 7)) {
      const sent: EmailMessage[] = []
      const capture = { send: async (m: EmailMessage) => void sent.push(m) }

      const first = await processPaceAlertForStore(storeBehind, { thresholdPct: 90, sender: capture })
      check("behind-pace store alerts", first.alerted && sent.length === 1, first.reason)
      check("pace is ~50%", first.pacePct !== null && Math.abs(first.pacePct - 50) < 2, `${first.pacePct?.toFixed(1)}%`)
      const to = sent[0]?.to ?? []
      check(
        "recipients = admin + assigned manager only",
        to.includes(admin.email) && to.includes(manager.email) && !to.includes(otherManager.email),
        to.join(", ")
      )
      check("alert email names the store", (sent[0]?.subject ?? "").includes(storeBehind.name))

      const second = await processPaceAlertForStore(storeBehind, { thresholdPct: 90, sender: capture })
      check("duplicate suppressed within the month", !second.alerted && sent.length === 1, second.reason)

      const noPlan = await processPaceAlertForStore(storeNoPlan, { thresholdPct: 90, sender: capture })
      check("store without a plan is skipped", !noPlan.alerted && noPlan.reason === "no plan for this month")

      const logRow = await prisma.paceAlertLog.findUnique({
        where: { storeId_month: { storeId: storeBehind.id, month: dbDate(mStart) } },
      })
      check("PaceAlertLog row records the send", !!logRow && logRow.thresholdPct === 90 && logRow.recipients.length === to.length)
    } else {
      console.log("… skipping live pace-alert checks (month just started)")
    }
  } finally {
    await prisma.auditLog.deleteMany({ where: { organizationId: org.id } })
    await prisma.storeUserAssignment.deleteMany({ where: { user: { organizationId: org.id } } })
    await prisma.user.deleteMany({ where: { organizationId: org.id } })
    await prisma.store.deleteMany({ where: { organizationId: org.id } })
    await prisma.organization.delete({ where: { id: org.id } })
    console.log("\nFixture org, users, and stores deleted.")
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`)
    process.exit(1)
  }
  console.log("\nAll F-5 polish checks passed.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
