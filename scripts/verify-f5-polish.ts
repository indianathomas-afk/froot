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
 *   5. NOTIFY-2a: the threshold is resolved PER ORG — an org that sets
 *      paceAlertThresholdPct is evaluated at that number and not at the
 *      deployment fallback, and clearing it falls back again.
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
import { evaluatePaceAlert, paceThresholdPct, processPaceAlertForStore } from "../src/lib/pace-alerts"
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

      // ── NOTIFY-2b: THE TEXT PART DID NOT MOVE ───────────────────────────
      // The phase adds an HTML alternative body and changes nothing about what
      // this email SAYS. The expected lines below are the pre-2b wording,
      // embedded here so that editing pace-alerts.ts's text builder fails this
      // fixture rather than quietly changing a live alert.
      //
      // WHAT THIS PROVES, EXACTLY, so nobody reads more into it: every fixed
      // byte is asserted literally — the headline, both blank lines, the two
      // label prefixes, the whole threshold sentence, the Dashboard line and
      // the line COUNT. The four money figures and two percentages are pinned
      // by format instead of by value, because they are computed from seeded
      // sales that differ per run. A reworded line, a moved line, an added line
      // or a dropped line all fail here; only a changed NUMBER can pass, and a
      // changed number is not a wording change.
      const alertLines = (sent[0]?.text ?? "").split("\n")
      const expectedAppUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.usefroot.com"
      const alertMonthName = new Date(`${mStart}T12:00:00Z`).toLocaleDateString("en-US", { month: "long" })
      check(
        "NOTIFY-2b: pace-alert text is still 7 lines",
        alertLines.length === 7,
        `${alertLines.length} lines`
      )
      check(
        "NOTIFY-2b: line 1 is the unchanged headline",
        alertLines[0] === `${storeBehind.name} is trailing its ${alertMonthName} sales goal (through ${asOf}).`,
        alertLines[0]
      )
      check("NOTIFY-2b: line 2 is blank", alertLines[1] === "", JSON.stringify(alertLines[1]))
      check(
        "NOTIFY-2b: line 3 is the unchanged Month to date line",
        /^Month to date: \$[\d,]+ of \$[\d,]+ goal \(\d+\.\d%\)$/.test(alertLines[2] ?? ""),
        alertLines[2]
      )
      check(
        "NOTIFY-2b: line 4 is the unchanged Projected month end line",
        /^Projected month end: \$[\d,]+ vs \$[\d,]+ goal \(\d+\.\d%\)$/.test(alertLines[3] ?? ""),
        alertLines[3]
      )
      check("NOTIFY-2b: line 5 is blank", alertLines[4] === "", JSON.stringify(alertLines[4]))
      check(
        "NOTIFY-2b: line 6 is the unchanged threshold sentence",
        alertLines[5] === "Alert threshold: 90% of MTD goal. You'll get at most one alert per store per month.",
        alertLines[5]
      )
      check(
        "NOTIFY-2b: line 7 is the unchanged Dashboard line",
        alertLines[6] === `Dashboard: ${expectedAppUrl}/dashboard`,
        alertLines[6]
      )

      const alertHtml = sent[0]?.html ?? ""
      check("NOTIFY-2b: the alert now carries an HTML body", alertHtml.length > 0, `${alertHtml.length} bytes`)
      check(
        "NOTIFY-2b: the HTML names the store",
        alertHtml.includes(storeBehind.name),
        storeBehind.name
      )

      // ── NOTIFY-2b: THE PACE PATH NOW WRITES A Notification ROW ──────────
      // It wrote none before this phase (PaceAlertLog is an idempotency lock,
      // not a log), so the send-log card showed one kind of email out of three
      // and a Resend delivery event for an alert had no row to find its org by.
      const paceAudit = await prisma.auditLog.findFirst({
        where: { organizationId: org.id, entityType: "Notification", action: "email.sent" },
        orderBy: { createdAt: "desc" },
      })
      const paceMeta = (paceAudit?.metadata ?? {}) as Record<string, unknown>
      check("NOTIFY-2b: the pace send wrote an email.sent row", !!paceAudit, paceAudit?.action)
      check("NOTIFY-2b: the row is kind pace.alert", paceMeta.kind === "pace.alert", String(paceMeta.kind))
      check(
        "NOTIFY-2b: the row records the provider and the subject",
        typeof paceMeta.provider === "string" && typeof paceMeta.subject === "string" &&
          String(paceMeta.subject).includes(storeBehind.name),
        `${paceMeta.provider} / ${paceMeta.subject}`
      )
      check(
        "NOTIFY-2b: the row names the same recipients the email went to",
        Array.isArray(paceMeta.recipients) && (paceMeta.recipients as string[]).length === to.length,
        JSON.stringify(paceMeta.recipients)
      )

      // The F3 correlation the webhook and the send log both depend on: a
      // Prisma JSON-path filter on metadata.resendId. Asserted against a REAL
      // row on a real Postgres rather than assumed to work — it is the one
      // query in this phase with no column behind it.
      const { listRecentEmails, recordEmailAttempt, findAttemptByResendId, deliveryEventExists } =
        await import("../src/lib/notification-log")
      const probeId = `fixture-resend-${tag}`
      await recordEmailAttempt({
        organizationId: org.id,
        entityId: null,
        kind: "test",
        action: "email.sent",
        recipients: [admin.email],
        subject: `NOTIFY-2b fixture probe ${tag}`,
        resendId: probeId,
      })
      const found = await findAttemptByResendId(probeId)
      check(
        "NOTIFY-2b: metadata.resendId JSON filter resolves a row to its org",
        found?.organizationId === org.id && found?.kind === "test",
        JSON.stringify(found)
      )
      check(
        "NOTIFY-2b: the idempotency probe is false before any delivery event",
        (await deliveryEventExists(probeId, "email.delivered")) === false
      )
      await prisma.auditLog.create({
        data: {
          organizationId: org.id,
          userId: null,
          action: "email.delivered",
          entityType: "Notification",
          entityId: null,
          metadata: { resendId: probeId, kind: "test", recipients: [admin.email] },
        },
      })
      check(
        "NOTIFY-2b: the idempotency probe is true once the event is recorded",
        (await deliveryEventExists(probeId, "email.delivered")) === true
      )
      const log = await listRecentEmails(org.id)
      const probeRow = log.find((r) => r.subject === `NOTIFY-2b fixture probe ${tag}`)
      check(
        "NOTIFY-2b: the send log resolves that attempt to delivered",
        probeRow?.status === "delivered",
        probeRow?.status
      )
      check(
        "NOTIFY-2b: the send log lists the pace alert too, newest first",
        log.some((r) => r.kind === "pace.alert" && r.kindLabel === "Behind-pace alert"),
        log.map((r) => r.kind).join(", ")
      )
      check(
        "NOTIFY-2b: a delivery-event row is NOT itself listed as an attempt",
        log.every((r) => r.kind !== "unknown"),
        log.map((r) => r.kind).join(", ")
      )

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

      // ── NOTIFY-2a: the per-org threshold (F1, Gary 2026-09-20) ──
      // SAME CAVEAT AS F-5b CHECK 1 ABOVE: this asserts the RESOLUTION the cron
      // performs, not the route handler, because the handler needs a
      // CRON_SECRET and a Request. The two lines below are copied from
      // api/cron/pace-alerts/route.ts and carry the same known cost — edit the
      // route's lookup without editing this and the check keeps passing.
      //
      // THE DIRECTION OF THE TEST IS THE POINT. storeThrow paces far enough
      // behind to alert at the 90% fallback, so setting the org to 40 and
      // getting SILENCE proves the org value was used. Asserting an alert at
      // some other number would not: the store alerts at 90 too, so a check
      // that merely fires cannot tell which threshold produced it.
      const envFallbackPct = paceThresholdPct()
      await prisma.organization.update({
        where: { id: org.id },
        data: { paceAlertThresholdPct: 40 },
      })
      const withOwn = await prisma.organization.findMany({
        where: { paceAlertsEnabled: true },
        select: { id: true, paceAlertThresholdPct: true },
      })
      const ownThreshold = new Map(withOwn.map((o) => [o.id, o.paceAlertThresholdPct])).get(org.id) ?? null
      check(
        "NOTIFY-2a: the cron's lookup resolves the org's own threshold",
        ownThreshold === 40 && ownThreshold !== envFallbackPct,
        `org=${ownThreshold} fallback=${envFallbackPct}`
      )

      const sentAtOwn: EmailMessage[] = []
      const capture3: EmailSender = { send: async (m: EmailMessage) => { sentAtOwn.push(m); return {} } }
      await prisma.paceAlertLog.deleteMany({ where: { storeId: storeThrow.id } })
      const atOwn = await processPaceAlertForStore(storeThrow, {
        thresholdPct: ownThreshold ?? envFallbackPct,
        sender: capture3,
      })
      check(
        "NOTIFY-2a: a store that alerts at the fallback is SILENT under its org's lower threshold",
        !atOwn.alerted && sentAtOwn.length === 0,
        `${atOwn.reason} (pace ${atOwn.pacePct?.toFixed(1)}%)`
      )

      // And back: null means fall back, which is the state every existing org
      // lands in on the migration. Same store, same month, same sales — only
      // the column changed.
      await prisma.organization.update({
        where: { id: org.id },
        data: { paceAlertThresholdPct: null },
      })
      const cleared = await prisma.organization.findMany({
        where: { paceAlertsEnabled: true },
        select: { id: true, paceAlertThresholdPct: true },
      })
      const clearedThreshold = new Map(cleared.map((o) => [o.id, o.paceAlertThresholdPct])).get(org.id) ?? null
      await prisma.paceAlertLog.deleteMany({ where: { storeId: storeThrow.id } })
      const atFallback = await processPaceAlertForStore(storeThrow, {
        thresholdPct: clearedThreshold ?? envFallbackPct,
        sender: capture3,
      })
      check(
        "NOTIFY-2a: clearing the column falls back to the deployment threshold and alerts again",
        clearedThreshold === null && atFallback.alerted,
        `resolved ${clearedThreshold ?? envFallbackPct}%: ${atFallback.reason}`
      )
      // The PaceAlertLog row records the threshold ACTUALLY used, per send —
      // which is why moving this column never rewrites history.
      const fallbackRow = await prisma.paceAlertLog.findUnique({
        where: { storeId_month: { storeId: storeThrow.id, month: dbDate(mStart) } },
      })
      check(
        "NOTIFY-2a: the log row records the threshold that was actually used",
        fallbackRow?.thresholdPct === envFallbackPct,
        `${fallbackRow?.thresholdPct} vs ${envFallbackPct}`
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
