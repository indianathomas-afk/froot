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
 *   4. F-5b: a new org defaults to paceAlertsEnabled=false (F1); the cron's
 *      store predicate evaluates nothing while the org is disabled and
 *      evaluates again once it is enabled; DEBT-105 — a send that throws leaves
 *      NO PaceAlertLog row behind and the next run alerts rather than reporting
 *      a phantom send. Plus one characterization check pinning the offboarding
 *      recipient gap that F2 ruled out of scope.
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
import type { EmailMessage, EmailSender } from "../src/lib/notify"

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
    // F-5b adds a THIRD store, used only by the send-failure check below. It
    // needs its own store because the DEBT-105 assertion is "no PaceAlertLog row
    // remains", which cannot be made about a store that already has one.
    const [storeBehind, storeNoPlan, storeThrow] = await Promise.all(
      [1, 2, 3].map((i) =>
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

    // Same $1,000/day plan and $500/day sales for the send-failure store, so it
    // is behind pace on identical numbers and the only variable under test is
    // whether the sender throws.
    const throwPlan = await prisma.goalPlan.create({
      data: { organizationId: org.id, storeId: storeThrow.id, year, basisType: "MANUAL", updatedById: "fixture" },
    })
    await prisma.dailyGoal.createMany({
      data: monthDates.map((dateStr, i) => ({
        planId: throwPlan.id,
        storeId: storeThrow.id,
        date: dbDate(dateStr),
        basisAmount: 1000 + i,
        goalAmount: 1000 + i,
      })),
    })
    await prisma.salesPeriodCache.createMany({
      data: mtdDates.map((dateStr) => ({
        organizationId: org.id,
        storeId: storeThrow.id,
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
      // NOTIFY-1: send() now resolves to an EmailSendResult (the provider
      // message id where there is one), so the capture returns {} rather
      // than undefined. Typed as EmailSender so the next signature change
      // fails here rather than at the call site.
      const capture: EmailSender = { send: async (m: EmailMessage) => { sent.push(m); return {} } }

      const first = await processPaceAlertForStore(storeBehind, { thresholdPct: 90, sender: capture })
      check("behind-pace store alerts", first.alerted && sent.length === 1, first.reason)
      check("pace is ~50%", first.pacePct !== null && Math.abs(first.pacePct - 50) < 2, `${first.pacePct?.toFixed(1)}%`)
      // NOTIFY-1 widened EmailMessage.to to `string | string[]`.
      // pace-alerts.ts still passes an array; normalise so this fixture
      // keeps checking the recipient LIST either way.
      const capturedTo = sent[0]?.to ?? []
      const to = Array.isArray(capturedTo) ? capturedTo : [capturedTo]
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

      // ── F-5b check 1: the org gate ──
      // THIS ASSERTS THE PREDICATE, NOT THE ROUTE HANDLER. The cron's gate lives
      // in its store query (api/cron/pace-alerts/route.ts) and the handler needs
      // a CRON_SECRET and a Request to call, so the fixture runs the same query
      // instead. The duplication is the known cost: if the route's filter is
      // edited and this one is not, this check keeps passing. It is still worth
      // having — it proves the COLUMN excludes a store that otherwise qualifies,
      // which is the thing F-5b added.
      const storeFilter = {
        isActive: true,
        dailyGoals: { some: { date: { gte: new Date(`${mStart.slice(0, 7)}-01T00:00:00.000Z`) } } },
        organizationId: org.id,
      }
      // The fixture org was created without paceAlertsEnabled, so it lands on
      // the F1 default — which is itself the first thing worth asserting.
      const orgRow = await prisma.organization.findUnique({ where: { id: org.id } })
      check("new org defaults to pace alerts DISABLED (F1)", orgRow?.paceAlertsEnabled === false)

      const whileDisabled = await prisma.store.findMany({
        where: { ...storeFilter, organization: { paceAlertsEnabled: true } },
      })
      const skippedWhileDisabled = await prisma.store.count({
        where: { ...storeFilter, organization: { paceAlertsEnabled: false } },
      })
      check(
        "disabled org: no store is evaluated, and the skipped count names them",
        whileDisabled.length === 0 && skippedWhileDisabled === 2,
        `evaluated ${whileDisabled.length}, skipped ${skippedWhileDisabled}`
      )

      await prisma.organization.update({ where: { id: org.id }, data: { paceAlertsEnabled: true } })
      const whileEnabled = await prisma.store.findMany({
        where: { ...storeFilter, organization: { paceAlertsEnabled: true } },
      })
      check(
        "enabled org: the planned stores are evaluated again",
        whileEnabled.length === 2,
        `evaluated ${whileEnabled.length}`
      )

      // ── F-5b check 2: DEBT-105, the lock is released on a failed send ──
      const boom: EmailSender = {
        send: async () => {
          throw new Error("simulated provider 500")
        },
      }
      let sendThrew = false
      try {
        await processPaceAlertForStore(storeThrow, { thresholdPct: 90, sender: boom })
      } catch {
        sendThrew = true
      }
      check("send failure propagates to the cron's per-store catch", sendThrew)

      const burned = await prisma.paceAlertLog.findUnique({
        where: { storeId_month: { storeId: storeThrow.id, month: dbDate(mStart) } },
      })
      check("DEBT-105: no PaceAlertLog row survives a failed send", burned === null)

      // The whole point of releasing the lock: the NEXT run must be able to
      // alert. Pre-F-5b this returned "already alerted this month" and the store
      // was dark for the rest of the calendar month.
      const retry = await processPaceAlertForStore(storeThrow, { thresholdPct: 90, sender: capture })
      check("DEBT-105: the next run alerts instead of reporting a phantom send", retry.alerted, retry.reason)
      const retryRow = await prisma.paceAlertLog.findUnique({
        where: { storeId_month: { storeId: storeThrow.id, month: dbDate(mStart) } },
      })
      check("DEBT-105: the successful retry does leave a lock behind", !!retryRow)

      // ── F-5b check 3: recipients ──
      // F2 (Gary, 2026-09-20) ruled the query at pace-alerts.ts:91-98 is LEFT
      // AS-IS and the offboarding gap is filed as a DEBT row instead. So there
      // is no new exclusion to assert, and inventing one would test code that
      // was deliberately not written.
      //
      // What follows is a CHARACTERIZATION check, not an endorsement: it pins
      // the gap the DEBT row describes so the claim is executable rather than
      // prose. An ADMIN with no store assignments — the exact shape a departed
      // admin leaves behind, since organizationMembership.deleted deletes the
      // assignments but not the User row and never touches the role — is still
      // a recipient. WHEN THE WEBHOOK IS FIXED, THIS CHECK IS EXPECTED TO FAIL
      // AND SHOULD BE UPDATED, NOT WORKED AROUND.
      const departedAdmin = await prisma.user.create({
        data: {
          clerkUserId: `fixture-f5b-departed-${tag}`,
          organizationId: org.id,
          email: `f5b-departed-${tag}@example.com`,
          role: "ADMIN",
        },
      })
      const sentAfter: EmailMessage[] = []
      const capture2: EmailSender = { send: async (m: EmailMessage) => { sentAfter.push(m); return {} } }
      await prisma.paceAlertLog.deleteMany({ where: { storeId: storeThrow.id } })
      await processPaceAlertForStore(storeThrow, { thresholdPct: 90, sender: capture2 })
      const to2raw = sentAfter[0]?.to ?? []
      const to2 = Array.isArray(to2raw) ? to2raw : [to2raw]
      check(
        "characterization (DEBT row): an assignment-less ADMIN is still a recipient",
        to2.includes(departedAdmin.email),
        "documents the offboarding gap; expected to fail once the Clerk webhook is fixed"
      )
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
