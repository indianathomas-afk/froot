/**
 * NOTIFY-5 acceptance fixture — one delivery mode (live / sandbox / dry-run).
 *
 *   npx tsx scripts/verify-notify5.ts
 *
 * Runs against the DEV database (local .env). Creates one throwaway org named
 * "NOTIFY-5 Fixture Org", its users, stores and one signed HR record, then:
 *   A. the mode table, every row, by setting env in-process; an unknown
 *      provider throws; `resend` without a key throws in every resend mode;
 *      the allowlist is trimmed, lower-cased, case-insensitive, empty = nobody.
 *   B. pace in dry-run: no PaceAlertLog, one `email.dryrun` row; a second run
 *      the same month writes no second row; then LIVE in the same month alerts
 *      and writes the lock — the console-mode burn is gone.
 *   C. pace in sandbox: only allow-listed recipients are mailed, no lock, the
 *      sent row names only them; an empty allowlist behaves as dry-run.
 *   D. acknowledgment: dry-run outcome and no `email.sent`; sandbox filters the
 *      list; a throwing provider still never throws; the no-recipients skip
 *      stays row-less.
 *   E. log: "Dry run — not sent", legacy console "Logged only", provider-less
 *      "unknown"; findAttemptByResendId never returns a dry-run row.
 * Everything is deleted afterwards and every env var restored.
 *
 * Resend is never contacted: pace takes an injected capture sender, and the
 * acknowledgment path (which builds its own sender) runs against a stubbed
 * globalThis.fetch for api.resend.com (NOTIFY-5 audit, choice 5).
 *
 * NEGATIVE CONTROL: set NOTIFY5_NEGATIVE_CONTROL=1 after hand-breaking a rule
 * (the session that wrote this disabled the dry-run branch in pace-alerts.ts so
 * dry-run fell through to the lock) — B must then FAIL.
 */
import "dotenv/config"
import { prisma } from "../src/lib/prisma"
import { localDateStr, dbDate } from "../src/lib/reports"
import { addDaysStr } from "../src/lib/goal-engine"
import { monthStart, daysInMonth } from "../src/lib/pacing"
import { writeAuditLog } from "../src/lib/audit"
import { processPaceAlertForStore } from "../src/lib/pace-alerts"
import {
  deliveryMode,
  getEmailSender,
  sandboxAllows,
  type DeliveryMode,
  type EmailMessage,
  type EmailSender,
} from "../src/lib/notify"
import {
  ACTION_DRY_RUN,
  ACTION_SENT,
  NOTIFICATION_ENTITY_TYPE,
  findAttemptByResendId,
  listRecentEmails,
} from "../src/lib/notification-log"
import { sendAckNotification } from "../src/lib/hr-ack-notification"

const TZ = "America/Los_Angeles"

let failures = 0
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures += 1
}

// ── env, set in-process and always restored ──────────────────────────────────
const ENV_KEYS = [
  "VERCEL_ENV",
  "NOTIFY_EMAIL_PROVIDER",
  "RESEND_API_KEY",
  "NOTIFY_FROM_EMAIL",
  "NOTIFY_SANDBOX_ALLOWLIST",
  "NEXT_PUBLIC_APP_URL",
] as const
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
function setEnv(vals: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  for (const k of ENV_KEYS) {
    if (!(k in vals)) continue
    const v = vals[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}
function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
}
// Fake Resend config. Never a real key; fetch to Resend is stubbed below.
const FAKE_RESEND = { RESEND_API_KEY: "re_notify5_fixture_fake", NOTIFY_FROM_EMAIL: "NOTIFY-5 <n5@example.com>" }
const DRY = { VERCEL_ENV: undefined, NOTIFY_EMAIL_PROVIDER: "console" }
const SANDBOX = { VERCEL_ENV: "preview", NOTIFY_EMAIL_PROVIDER: "resend", ...FAKE_RESEND }
const LIVE = { VERCEL_ENV: "production", NOTIFY_EMAIL_PROVIDER: "resend", ...FAKE_RESEND }

// ── fetch stub for api.resend.com ────────────────────────────────────────────
const realFetch = globalThis.fetch
const resendCalls: { to: string[] }[] = []
let resendFails = false
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (url.startsWith("https://api.resend.com/")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { to: string[] }
    resendCalls.push({ to: body.to })
    if (resendFails) return new Response('{"message":"fixture failure"}', { status: 500, statusText: "Internal" })
    return new Response(JSON.stringify({ id: `n5-${resendCalls.length}` }), { status: 200 })
  }
  return realFetch(input, init)
}) as typeof fetch

function capture(): { sender: EmailSender; sent: EmailMessage[] } {
  const sent: EmailMessage[] = []
  return { sent, sender: { send: async (m) => { sent.push(m); return { id: `cap-${sent.length}` } } } }
}
function toList(to: EmailMessage["to"]): string[] {
  return Array.isArray(to) ? to : [to]
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
function throws(fn: () => unknown): boolean {
  try {
    fn()
    return false
  } catch {
    return true
  }
}

async function main() {
  // ── A. the mode table ──────────────────────────────────────────────────────
  const table: [string | undefined, string | undefined, DeliveryMode][] = [
    [undefined, undefined, "dry-run"],
    ["production", undefined, "dry-run"],
    ["production", "console", "dry-run"],
    ["preview", "console", "dry-run"],
    ["preview", "  ", "dry-run"],
    ["production", "resend", "live"],
    ["production", " Resend ", "live"],
    ["preview", "resend", "sandbox"],
    ["development", "resend", "sandbox"],
    [undefined, "resend", "sandbox"],
  ]
  for (const [vercelEnv, provider, want] of table) {
    setEnv({ VERCEL_ENV: vercelEnv, NOTIFY_EMAIL_PROVIDER: provider })
    let got: string
    try {
      got = deliveryMode()
    } catch (e) {
      got = `threw: ${(e as Error).message}`
    }
    check(`mode: VERCEL_ENV=${vercelEnv ?? "(unset)"} provider=${JSON.stringify(provider ?? null)} → ${want}`, got === want, got)
  }
  setEnv({ VERCEL_ENV: "production", NOTIFY_EMAIL_PROVIDER: "sendgrid" })
  check("unknown provider: deliveryMode() throws", throws(() => deliveryMode()))
  check("unknown provider: getEmailSender() still throws", throws(() => getEmailSender()))
  for (const env of ["production", "preview", undefined]) {
    setEnv({ VERCEL_ENV: env, NOTIFY_EMAIL_PROVIDER: "resend", RESEND_API_KEY: undefined, NOTIFY_FROM_EMAIL: "x <x@example.com>" })
    check(`resend without key throws (VERCEL_ENV=${env ?? "(unset)"}, mode ${deliveryMode()})`, throws(() => getEmailSender()))
    setEnv({ RESEND_API_KEY: "re_fake", NOTIFY_FROM_EMAIL: undefined })
    check(`resend without from-address throws (VERCEL_ENV=${env ?? "(unset)"})`, throws(() => getEmailSender()))
  }
  setEnv({ ...DRY, RESEND_API_KEY: undefined, NOTIFY_FROM_EMAIL: undefined })
  check("dry-run needs no Resend config (getEmailSender returns the console sender)", !throws(() => getEmailSender()))

  setEnv({ NOTIFY_SANDBOX_ALLOWLIST: undefined })
  check("allowlist unset = nobody", !sandboxAllows("a@example.com"))
  setEnv({ NOTIFY_SANDBOX_ALLOWLIST: " , " })
  check("allowlist empty = nobody", !sandboxAllows("a@example.com") && !sandboxAllows(""))
  setEnv({ NOTIFY_SANDBOX_ALLOWLIST: " Gary@Example.com , b@example.com" })
  check(
    "allowlist trimmed and case-insensitive",
    sandboxAllows("gary@example.com") && sandboxAllows(" GARY@EXAMPLE.COM ") && sandboxAllows("b@example.com") && !sandboxAllows("c@example.com")
  )

  // ── fixture org ────────────────────────────────────────────────────────────
  const tag = Math.random().toString(36).slice(2, 8)
  const today = localDateStr(new Date(), TZ)
  const asOf = addDaysStr(today, -1)
  const paceRunnable = asOf.slice(0, 7) === today.slice(0, 7)
  const mStart = monthStart(today)
  const monthEnd = `${mStart.slice(0, 7)}-${String(daysInMonth(today)).padStart(2, "0")}`

  const org = await prisma.organization.create({
    data: {
      clerkOrgId: `notify5-fixture-${tag}`,
      name: "NOTIFY-5 Fixture Org (safe to delete)",
      activeModules: ["hr"],
      paceAlertsEnabled: true,
    },
  })
  console.log(`\nFixture org ${org.id} (NOTIFY-5) on the DEV database · month ${mStart} · through ${asOf}\n`)

  const hrIds: { docId?: string; staffId?: string } = {}
  try {
    const adminEmail = `notify5-admin-${tag}@example.com`
    const managerEmail = `notify5-mgr-${tag}@example.com`
    const [storeA, storeB, storeC, storeNeg] = await Promise.all(
      ["A", "B", "C", "Neg"].map((s) =>
        prisma.store.create({ data: { organizationId: org.id, name: `NOTIFY-5 Store ${s}`, timezone: TZ } })
      )
    )
    const admin = await prisma.user.create({
      data: { clerkUserId: `notify5-admin-${tag}`, organizationId: org.id, email: adminEmail, role: "ADMIN" },
    })
    const manager = await prisma.user.create({
      data: { clerkUserId: `notify5-mgr-${tag}`, organizationId: org.id, email: managerEmail, role: "MANAGER" },
    })
    for (const s of [storeA, storeB, storeC, storeNeg]) {
      await prisma.storeUserAssignment.create({ data: { userId: manager.id, storeId: s.id } })
    }
    void admin

    // $1,000/day plan, $500/day sales → 50% pace, behind a 90% threshold.
    for (const s of [storeA, storeB, storeC, storeNeg]) {
      const plan = await prisma.goalPlan.create({
        data: { organizationId: org.id, storeId: s.id, year: Number(today.slice(0, 4)), basisType: "MANUAL", updatedById: "notify5-fixture" },
      })
      await prisma.dailyGoal.createMany({
        data: eachDate(mStart, monthEnd).map((d) => ({ planId: plan.id, storeId: s.id, date: dbDate(d), basisAmount: 1000, goalAmount: 1000 })),
      })
      if (paceRunnable) {
        await prisma.salesPeriodCache.createMany({
          data: eachDate(mStart, asOf).map((d) => ({
            organizationId: org.id, storeId: s.id, date: dbDate(d), netSales: 500, grossSales: 540, taxTotal: 40, orderCount: 5,
          })),
        })
      }
    }

    const lockFor = (storeId: string) =>
      prisma.paceAlertLog.findUnique({ where: { storeId_month: { storeId, month: dbDate(mStart) } } })
    const rowsFor = (entityId: string, action: string) =>
      prisma.auditLog.findMany({
        where: { organizationId: org.id, entityType: NOTIFICATION_ENTITY_TYPE, entityId, action },
      })
    const meta = (r: { metadata: unknown } | undefined) => (r?.metadata ?? {}) as Record<string, unknown>

    if (!paceRunnable) {
      console.log("… skipping pace checks B and C (first of the month in store time — no complete day yet)")
    } else {
      // ── B. pace in dry-run; then live in the same month ────────────────────
      setEnv({ ...DRY })
      const capB = capture()
      const dry1 = await processPaceAlertForStore(storeA, { thresholdPct: 90, sender: capB.sender, mode: "dry-run" })
      const lockAfterDry = await lockFor(storeA.id)
      const dryRows1 = await rowsFor(storeA.id, ACTION_DRY_RUN)
      check("B pace dry-run: alerted false, reason dry-run", !dry1.alerted && dry1.reason === "dry-run", dry1.reason)
      check("B pace dry-run: NO PaceAlertLog row (the lock is not burned)", lockAfterDry === null)
      check("B pace dry-run: the injected sender is never called", capB.sent.length === 0)
      check(
        "B pace dry-run: exactly one email.dryrun row, kind pace.alert, both would-be recipients, mode dry-run",
        dryRows1.length === 1 &&
          meta(dryRows1[0]).kind === "pace.alert" &&
          meta(dryRows1[0]).mode === "dry-run" &&
          (meta(dryRows1[0]).recipients as string[]).length === 2 &&
          typeof meta(dryRows1[0]).subject === "string",
        `${dryRows1.length} row(s)`
      )
      check("B pace dry-run: no email.sent row", (await rowsFor(storeA.id, ACTION_SENT)).length === 0)
      const dry2 = await processPaceAlertForStore(storeA, { thresholdPct: 90, sender: capB.sender, mode: "dry-run" })
      check(
        "B pace dry-run: a second run the same month writes NO second dry-run row",
        (await rowsFor(storeA.id, ACTION_DRY_RUN)).length === 1 && !dry2.alerted,
        dry2.reason
      )

      setEnv({ ...LIVE })
      const capLive = capture()
      const live = await processPaceAlertForStore(storeA, { thresholdPct: 90, sender: capLive.sender, mode: "live" })
      const lockAfterLive = await lockFor(storeA.id)
      check(
        "B THE BURN IS GONE: live in the same month alerts after dry-run and writes the lock",
        live.alerted && lockAfterLive !== null && capLive.sent.length === 1,
        live.reason
      )
      const liveRow = (await rowsFor(storeA.id, ACTION_SENT))[0]
      check("B live: email.sent row stamped mode live", meta(liveRow).mode === "live" && meta(liveRow).provider === "resend")
      const live2 = await processPaceAlertForStore(storeA, { thresholdPct: 90, sender: capLive.sender, mode: "live" })
      check("B live: still one alert per store per month", !live2.alerted && capLive.sent.length === 1, live2.reason)

      // ── C. pace in sandbox ─────────────────────────────────────────────────
      setEnv({ ...SANDBOX, NOTIFY_SANDBOX_ALLOWLIST: adminEmail.toUpperCase() })
      const capC = capture()
      const sb = await processPaceAlertForStore(storeB, { thresholdPct: 90, sender: capC.sender, mode: "sandbox" })
      const sbSent = capC.sent.map((m) => toList(m.to))
      check("C pace sandbox: alerted, reason sandbox", sb.alerted && sb.reason === "sandbox", sb.reason)
      check(
        "C pace sandbox: ONLY the allow-listed recipient is mailed (manager withheld)",
        sbSent.length === 1 && sbSent[0].length === 1 && sbSent[0][0] === adminEmail,
        JSON.stringify(sbSent)
      )
      check("C pace sandbox: NO PaceAlertLog row (staging never consumes a month)", (await lockFor(storeB.id)) === null)
      const sbRow = (await rowsFor(storeB.id, ACTION_SENT))[0]
      check(
        "C pace sandbox: email.sent names only the address sent to, withheld 1, mode sandbox",
        JSON.stringify(meta(sbRow).recipients) === JSON.stringify([adminEmail]) &&
          meta(sbRow).withheld === 1 &&
          meta(sbRow).mode === "sandbox"
      )

      setEnv({ NOTIFY_SANDBOX_ALLOWLIST: "" })
      const capC2 = capture()
      const sbEmpty = await processPaceAlertForStore(storeC, { thresholdPct: 90, sender: capC2.sender, mode: "sandbox" })
      check(
        "C pace sandbox, empty allowlist → behaves as dry-run (no send, no lock, one dry-run row)",
        !sbEmpty.alerted &&
          sbEmpty.reason === "dry-run" &&
          capC2.sent.length === 0 &&
          (await lockFor(storeC.id)) === null &&
          (await rowsFor(storeC.id, ACTION_DRY_RUN)).length === 1,
        sbEmpty.reason
      )
    }

    // ── D. signed acknowledgment ───────────────────────────────────────────────
    const allowed = `notify5-hr-allowed-${tag}@example.com`
    const other = `notify5-hr-other-${tag}@example.com`
    const doc = await prisma.hrDocument.create({
      data: { organizationId: org.id, kind: "Acknowledgment", title: "NOTIFY-5 Handbook", category: "Policy" },
    })
    hrIds.docId = doc.id
    const version = await prisma.hrDocumentVersion.create({
      data: {
        hrDocumentId: doc.id, versionNumber: 1, fileUrl: "notify5://fixture", fileName: "notify5.pdf",
        contentType: "application/pdf", sizeBytes: 1, fileHash: "notify5", uploadedByUserId: "notify5-fixture",
      },
    })
    const checkpoint = await prisma.hrDocumentCheckpoint.create({
      data: { hrDocumentId: doc.id, name: "NOTIFY-5 Signature", type: "Signature", orderIndex: 0 },
    })
    const staff = await prisma.staffMember.create({ data: { organizationId: org.id, displayName: "NOTIFY-5 Staff" } })
    hrIds.staffId = staff.id
    await prisma.hrDocumentAcknowledgment.create({
      data: {
        checkpointId: checkpoint.id, hrDocumentVersionId: version.id, staffMemberId: staff.id,
        checkpointName: checkpoint.name, checkpointType: "Signature", documentTitle: doc.title,
        documentVersionNumber: 1, documentFileHash: "notify5", staffName: "NOTIFY-5 Staff",
        typedName: "NOTIFY-5 Staff", method: "Signature", authMethod: "ClerkSession", consentGiven: true,
      },
    })
    const record = await prisma.hrSignedRecord.create({
      data: {
        hrDocumentVersionId: version.id, staffMemberId: staff.id, completedAt: new Date(),
        signedPdfPathname: "notify5/fixture.pdf", signedPdfHash: "notify5",
      },
    })
    const setAckList = (list: string[]) =>
      prisma.organization.update({ where: { id: org.id }, data: { hrAckRecipients: list } })
    const ackRows = async (action: string) => rowsFor(record.id, action)
    const clearAckRows = () => prisma.auditLog.deleteMany({ where: { organizationId: org.id, entityId: record.id } })

    setEnv({ NEXT_PUBLIC_APP_URL: "https://notify5.example.com" })

    // No recipients: skip stays first and row-less (F3, 2026-09-20).
    setEnv({ ...SANDBOX, NOTIFY_SANDBOX_ALLOWLIST: allowed })
    await setAckList([])
    const skip = await sendAckNotification(record.id)
    check(
      "D ack: no recipients → skipped, no row",
      skip.status === "skipped" && (await prisma.auditLog.count({ where: { entityId: record.id } })) === 0,
      skip.status
    )
    await setAckList([allowed, other])

    setEnv({ ...DRY, RESEND_API_KEY: undefined, NOTIFY_FROM_EMAIL: undefined })
    resendCalls.length = 0
    const ackDry = await sendAckNotification(record.id)
    check(
      "D ack dry-run: outcome dry-run with both would-be recipients",
      ackDry.status === "dry-run" && ackDry.recipients.length === 2,
      ackDry.status
    )
    check("D ack dry-run: no email.sent row, one email.dryrun row, nothing reached Resend",
      (await ackRows(ACTION_SENT)).length === 0 && (await ackRows(ACTION_DRY_RUN)).length === 1 && resendCalls.length === 0)
    await clearAckRows()

    setEnv({ ...SANDBOX, NOTIFY_SANDBOX_ALLOWLIST: allowed.toUpperCase() })
    resendCalls.length = 0
    const ackSb = await sendAckNotification(record.id)
    const ackSbRow = (await ackRows(ACTION_SENT))[0]
    check(
      "D ack sandbox: sent to the allow-listed address only",
      ackSb.status === "sent" && resendCalls.length === 1 && JSON.stringify(resendCalls[0].to) === JSON.stringify([allowed]),
      JSON.stringify(resendCalls)
    )
    check(
      "D ack sandbox: email.sent names only it, withheld 1, mode sandbox",
      JSON.stringify(meta(ackSbRow).recipients) === JSON.stringify([allowed]) &&
        meta(ackSbRow).withheld === 1 &&
        meta(ackSbRow).mode === "sandbox"
    )
    await clearAckRows()

    setEnv({ NOTIFY_SANDBOX_ALLOWLIST: undefined })
    resendCalls.length = 0
    const ackSbEmpty = await sendAckNotification(record.id)
    check(
      "D ack sandbox, empty allowlist → dry-run, nothing reached Resend",
      ackSbEmpty.status === "dry-run" && resendCalls.length === 0 && (await ackRows(ACTION_DRY_RUN)).length === 1,
      ackSbEmpty.status
    )
    await clearAckRows()

    setEnv({ NOTIFY_SANDBOX_ALLOWLIST: allowed })
    resendFails = true
    let ackThrew = false
    let ackFail: Awaited<ReturnType<typeof sendAckNotification>> | null = null
    try {
      ackFail = await sendAckNotification(record.id)
    } catch {
      ackThrew = true
    }
    resendFails = false
    const failRow = (await ackRows("email.failed"))[0]
    check(
      "D ack: a throwing provider still never throws; outcome failed naming only the attempted address",
      !ackThrew && ackFail?.status === "failed" && JSON.stringify(meta(failRow).recipients) === JSON.stringify([allowed]),
      ackFail?.status ?? "threw"
    )
    await clearAckRows()

    setEnv({ ...LIVE })
    resendCalls.length = 0
    const ackLive = await sendAckNotification(record.id)
    check(
      "D ack live: unchanged — sent to the whole list",
      ackLive.status === "sent" && resendCalls.length === 1 && resendCalls[0].to.length === 2,
      JSON.stringify(resendCalls)
    )
    await clearAckRows()

    // ── E. the log ─────────────────────────────────────────────────────────────
    setEnv({ ...DRY })
    await writeAuditLog({
      organizationId: org.id, userId: null, action: ACTION_SENT, entityType: NOTIFICATION_ENTITY_TYPE, entityId: "notify5-legacy-console",
      metadata: { kind: "test", provider: "console", recipients: ["legacy@example.com"], subject: "NOTIFY-5 legacy console" },
    })
    await writeAuditLog({
      organizationId: org.id, userId: null, action: ACTION_SENT, entityType: NOTIFICATION_ENTITY_TYPE, entityId: "notify5-legacy-none",
      metadata: { kind: "test", recipients: ["legacy@example.com"], subject: "NOTIFY-5 legacy no provider" },
    })
    // A dry-run row CARRYING a resendId, which no real writer produces — so
    // the only thing that can exclude it is the explicit action list.
    const probe = `notify5-probe-${tag}`
    await writeAuditLog({
      organizationId: org.id, userId: null, action: ACTION_DRY_RUN, entityType: NOTIFICATION_ENTITY_TYPE, entityId: "notify5-probe",
      metadata: { kind: "test", provider: "console", mode: "dry-run", recipients: ["p@example.com"], subject: "NOTIFY-5 probe", resendId: probe },
    })
    const log = await listRecentEmails(org.id)
    const bySubject = (s: string) => log.find((e) => e.subject === s)
    check("E log: a legacy console email.sent still reads 'logged only'", bySubject("NOTIFY-5 legacy console")?.status === "logged only")
    check("E log: a provider-less row still reads 'unknown'", bySubject("NOTIFY-5 legacy no provider")?.status === "unknown")
    check("E log: an email.dryrun row reads 'dry run'", bySubject("NOTIFY-5 probe")?.status === "dry run")
    if (paceRunnable) {
      check("E log: the pace dry-run row is listed in Recent emails", log.some((e) => e.kind === "pace.alert" && e.status === "dry run"))
    }
    check("E log: findAttemptByResendId never returns a dry-run row", (await findAttemptByResendId(probe)) === null)

    // ── Negative-control hook ─────────────────────────────────────────────────
    if (process.env.NOTIFY5_NEGATIVE_CONTROL === "1" && paceRunnable) {
      setEnv({ ...DRY })
      const capN = capture()
      await processPaceAlertForStore(storeNeg, { thresholdPct: 90, sender: capN.sender, mode: "dry-run" })
      check("NEGATIVE CONTROL: dry-run wrote no lock", (await lockFor(storeNeg.id)) === null)
    }
  } finally {
    globalThis.fetch = realFetch
    restoreEnv()
    await prisma.auditLog.deleteMany({ where: { organizationId: org.id } })
    if (hrIds.docId) {
      const versions = await prisma.hrDocumentVersion.findMany({ where: { hrDocumentId: hrIds.docId }, select: { id: true } })
      const vIds = versions.map((v) => v.id)
      await prisma.hrSignedRecord.deleteMany({ where: { hrDocumentVersionId: { in: vIds } } })
      await prisma.hrDocumentAcknowledgment.deleteMany({ where: { hrDocumentVersionId: { in: vIds } } })
      await prisma.hrDocumentCheckpoint.deleteMany({ where: { hrDocumentId: hrIds.docId } })
      await prisma.hrDocumentVersion.deleteMany({ where: { hrDocumentId: hrIds.docId } })
      await prisma.hrDocument.delete({ where: { id: hrIds.docId } })
    }
    if (hrIds.staffId) await prisma.staffMember.delete({ where: { id: hrIds.staffId } })
    await prisma.storeUserAssignment.deleteMany({ where: { user: { organizationId: org.id } } })
    await prisma.user.deleteMany({ where: { organizationId: org.id } })
    await prisma.store.deleteMany({ where: { organizationId: org.id } })
    await prisma.organization.delete({ where: { id: org.id } })
    console.log(`\nFixture org ${org.id} (NOTIFY-5) and everything under it deleted.`)
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`)
    process.exit(1)
  }
  console.log("\nAll NOTIFY-5 checks passed.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
