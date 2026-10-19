/**
 * NOTIFY-6 acceptance fixture — one notification pipeline.
 *
 *   npx tsx scripts/verify-notify6.ts
 *
 * Runs against the DEV database (local .env). Creates two throwaway orgs,
 * "NOTIFY-6 Fixture Org A" and "… B", with users, a behind-pace store, and one
 * signed HR record, then checks:
 *   A. enqueue upsert — create; no-op on sent / partial / known / failed;
 *      refresh on queued / expired; never throws.
 *   B. every row of the mode table (transport set in-process): dry-run and
 *      sandbox never move an intent's state and never write a delivery;
 *      sandbox mails only allow-listed addresses; the test kind reaches its
 *      caller in sandbox with an empty allowlist; dry-run logs once per
 *      (intent, recipient); THE SWEEP NEVER RE-SENDS IN SANDBOX (R2) while a
 *      producer dispatch does (NOTIFY-5 choice 4).
 *   C. one message per recipient, no shared `to:`.
 *   D. THE BURN STAYS GONE: pace in dry-run, then live the same month → sends
 *      and PaceAlertLog is written; the pre-pipeline PaceAlertLog gate (W4).
 *   E. P6: a sender that fails one recipient of three → intent `partial`, two
 *      `sent` deliveries; the sweep retries → exactly one more message, to the
 *      failed recipient only; nobody gets it twice.
 *   F. retry cap → `failed`, and the reader says "gave up after 5 attempts".
 *   G. freshness → `expired` (hr.ack 7 days, test 15 minutes); org switch off
 *      → `expired` (hr.ack list emptied, pace switch off).
 *   H. concurrency (audit C8): two dispatches of one intent at once → one
 *      message per recipient.
 *   I. hr.ack: sendAckNotification never throws when the provider throws; the
 *      empty-list skip writes no intent; scheduleAckNotification outside a
 *      request scope does not throw.
 *   J. the webhook route, signed with Svix: lookup by providerMessageId finds
 *      the message and appends one NotificationEvent (+ the parallel AuditLog
 *      row); a duplicate is not appended twice; a pre-pipeline resendId still
 *      resolves through the AuditLog fallback; an unknown id is a 200.
 *   K. tenant isolation: the same dedupeKey in two orgs is two intents; a
 *      dispatch scoped to A never touches B; B's log has none of A's rows.
 *   L. the reader: pipeline rows and pre-pipeline rows both render, the legacy
 *      derivations ("Logged only", "unknown", "Dry run") unchanged, and no
 *      parallel AuditLog row is listed twice.
 *
 * A TEMPLATE FOR THE NEXT KIND: sections A, B, E, F, G and H drive the pipeline
 * through `ackIntent()` — swap in an intent factory for the new kind and they
 * apply unchanged; the kind adds only its resolver checks.
 *
 * Resend is never contacted: dispatch takes an injected capture transport, and
 * paths that build their own sender run against a stubbed globalThis.fetch.
 *
 * NEGATIVE CONTROL: hand-break the P6 filter in src/lib/notifications/
 * dispatch.ts (retry everyone: `const remaining = eligible`) — E must FAIL.
 */
import "dotenv/config"
import { Webhook } from "svix"
import { prisma } from "../src/lib/prisma"
import { localDateStr, dbDate } from "../src/lib/reports"
import { addDaysStr } from "../src/lib/goal-engine"
import { monthStart, daysInMonth } from "../src/lib/pacing"
import { writeAuditLog } from "../src/lib/audit"
import { processPaceAlertForStore } from "../src/lib/pace-alerts"
import type { DeliveryMode, EmailMessage, EmailSender } from "../src/lib/notify"
import {
  ACTION_DRY_RUN,
  ACTION_SENT,
  NOTIFICATION_ENTITY_TYPE,
  findAttemptByResendId,
  listRecentEmails,
} from "../src/lib/notification-log"
import {
  MAX_ATTEMPTS,
  dispatchNotifications,
  enqueueNotification,
  type DispatchTrigger,
  type Transport,
} from "../src/lib/notifications/dispatch"
import type { HrAckPayload } from "../src/lib/notifications/kinds/hr-ack"
import { scheduleAckNotification, sendAckNotification } from "../src/lib/hr-ack-notification"
import { POST as resendWebhook } from "../src/app/api/webhooks/resend/route"

const TZ = "America/Los_Angeles"
const HOUR = 3_600_000

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
  "RESEND_WEBHOOK_SECRET",
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
const FAKE_RESEND = { RESEND_API_KEY: "re_notify6_fixture_fake", NOTIFY_FROM_EMAIL: "NOTIFY-6 <n6@example.com>" }
const LIVE_ENV = { VERCEL_ENV: "production", NOTIFY_EMAIL_PROVIDER: "resend", ...FAKE_RESEND }

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
    return new Response(JSON.stringify({ id: `n6-fetch-${resendCalls.length}-${Math.random().toString(36).slice(2, 8)}` }), { status: 200 })
  }
  return realFetch(input, init)
}) as typeof fetch

// ── capture transport ────────────────────────────────────────────────────────
type Capture = { sent: EmailMessage[]; attempts: string[]; sender: EmailSender }
function capture(opts: { failFor?: string[]; delayMs?: number } = {}): Capture {
  const sent: EmailMessage[] = []
  const attempts: string[] = []
  const fail = new Set((opts.failFor ?? []).map((s) => s.toLowerCase()))
  return {
    sent,
    attempts,
    sender: {
      async send(m) {
        const to = Array.isArray(m.to) ? m.to.join(",") : m.to
        attempts.push(to)
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
        if (fail.has(to.toLowerCase())) throw new Error(`fixture: ${to} refused`)
        sent.push(m)
        return { id: `n6-cap-${Math.random().toString(36).slice(2, 10)}` }
      },
    },
  }
}
const transport = (mode: DeliveryMode, cap: Capture): Transport => ({ mode, sender: () => cap.sender })

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
  const asOf = addDaysStr(today, -1)
  const paceRunnable = asOf.slice(0, 7) === today.slice(0, 7)
  const mStart = monthStart(today)
  const monthEnd = `${mStart.slice(0, 7)}-${String(daysInMonth(today)).padStart(2, "0")}`

  const A = `notify6-a-${tag}@example.com`
  const B = `notify6-b-${tag}@example.com`
  const C = `notify6-c-${tag}@example.com`
  const OTHER = `notify6-orgb-${tag}@example.com`

  const [orgA, orgB] = await Promise.all(
    ["A", "B"].map((x) =>
      prisma.organization.create({
        data: {
          clerkOrgId: `notify6-fixture-${x.toLowerCase()}-${tag}`,
          name: `NOTIFY-6 Fixture Org ${x} (safe to delete)`,
          activeModules: ["hr"],
          paceAlertsEnabled: true,
          hrAckRecipients: x === "A" ? [A, B, C] : [OTHER],
        },
      })
    )
  )
  const orgIds = [orgA.id, orgB.id]
  // The branch is a product of the same connection as every row below
  // (CLAUDE.md § Database Evidence — belt and braces). Null off Neon.
  const [{ branch }] = await prisma.$queryRaw<{ branch: string | null }[]>`SELECT current_setting('neon.branch_id', true) AS branch`
  console.log(
    `\nFixture orgs ${orgA.id} (A), ${orgB.id} (B) — NOTIFY-6 · neon.branch_id=${branch ?? "(null)"} · month ${mStart}\n`
  )

  const hrIds: { docId?: string; staffId?: string } = {}
  let seq = 0
  // The intent factory every pipeline section uses. hr.ack, because its
  // recipients are the org's address list — three addresses, no users.
  const ackPayload = (n: number): HrAckPayload => ({
    signedRecordId: `notify6-record-${tag}-${n}`,
    title: "NOTIFY-6 Handbook",
    versionNumber: 1,
    nameOnRecord: "NOTIFY-6 Staff",
    executedName: "NOTIFY-6 Staff",
    storeName: null,
    completedAt: new Date().toISOString(),
  })
  async function ackIntent(orgId = orgA.id, eventAt = new Date()): Promise<string> {
    seq += 1
    const r = await enqueueNotification({
      organizationId: orgId,
      kind: "hr.ack",
      dedupeKey: `notify6-${tag}-${seq}`,
      entityId: null,
      eventAt,
      payload: ackPayload(seq),
    })
    if (!r) throw new Error("fixture: enqueue failed")
    return r.intentId
  }
  const dispatch = (intentId: string, t: Transport, trigger: DispatchTrigger = "producer", now?: Date) =>
    dispatchNotifications({ transport: t, trigger, intentIds: [intentId], now })
  const intentOf = (id: string) => prisma.notificationIntent.findUniqueOrThrow({ where: { id } })
  const messagesOf = (intentId: string) =>
    prisma.notificationMessage.findMany({ where: { intentId }, orderBy: { createdAt: "asc" } })
  const deliveriesOf = (intentId: string) => prisma.notificationDelivery.findMany({ where: { intentId } })

  try {
    setEnv({ NEXT_PUBLIC_APP_URL: "https://notify6.example.com", NOTIFY_EMAIL_PROVIDER: "console", VERCEL_ENV: undefined })

    // ── A. enqueue upsert ────────────────────────────────────────────────────
    {
      const key = `notify6-upsert-${tag}`
      const args = (n: number) => ({
        organizationId: orgA.id,
        kind: "hr.ack",
        dedupeKey: key,
        entityId: null,
        eventAt: new Date(),
        payload: ackPayload(n),
      })
      const created = await enqueueNotification(args(1))
      check("A enqueue: no row → created, queued", !!created && created.created && created.state === "queued")
      const id = created!.intentId
      for (const state of ["sent", "partial", "known", "failed"] as const) {
        await prisma.notificationIntent.update({ where: { id }, data: { state, payload: ackPayload(100) } })
        const r = await enqueueNotification(args(2))
        const row = await intentOf(id)
        check(
          `A enqueue: ${state} → no-op (state and payload untouched)`,
          !!r && !r.created && !r.refreshed && row.state === state && (row.payload as HrAckPayload).signedRecordId.endsWith("-100")
        )
      }
      for (const state of ["queued", "expired"] as const) {
        await prisma.notificationIntent.update({
          where: { id },
          data: { state, payload: ackPayload(100), nextAttemptAt: new Date(Date.now() + HOUR) },
        })
        const r = await enqueueNotification(args(3))
        const row = await intentOf(id)
        check(
          `A enqueue: ${state} → refreshed to queued, new payload, nextAttemptAt cleared`,
          !!r && r.refreshed && row.state === "queued" && (row.payload as HrAckPayload).signedRecordId.endsWith("-3") && row.nextAttemptAt === null
        )
      }
      let threw = false
      let res: unknown = "unset"
      try {
        res = await enqueueNotification({ ...args(4), organizationId: `notify6-no-such-org-${tag}`, dedupeKey: `x-${tag}` })
      } catch {
        threw = true
      }
      check("A enqueue: never throws — a failed write returns null", !threw && res === null)
    }

    // ── B. the mode table ─────────────────────────────────────────────────────
    {
      // dry-run
      const id = await ackIntent()
      const cap = capture()
      await dispatch(id, transport("dry-run", cap))
      const msgs = await messagesOf(id)
      check("B dry-run: nothing reaches the sender", cap.attempts.length === 0)
      check("B dry-run: intent state unchanged (queued)", (await intentOf(id)).state === "queued")
      check("B dry-run: no delivery row", (await deliveriesOf(id)).length === 0)
      check(
        "B dry-run: one dry-run message per recipient, provider console",
        msgs.length === 3 && msgs.every((m) => m.mode === "dry-run" && m.status === "dry-run" && m.provider === "console")
      )
      await dispatch(id, transport("dry-run", cap))
      await dispatch(id, transport("dry-run", cap), "sweep")
      check("B dry-run: logged once per (intent, recipient) — repeat dispatches write nothing", (await messagesOf(id)).length === 3)
      let parallel = 0
      for (const m of msgs) {
        parallel += await prisma.auditLog.count({
          where: { organizationId: orgA.id, action: ACTION_DRY_RUN, metadata: { path: ["notificationMessageId"], equals: m.id } },
        })
      }
      check("B dry-run: exactly one parallel email.dryrun AuditLog row per message", parallel === 3, `${parallel}`)
    }
    {
      // sandbox, allowlist = A only
      setEnv({ NOTIFY_SANDBOX_ALLOWLIST: ` ${A.toUpperCase()} ` })
      const id = await ackIntent()
      const cap = capture()
      await dispatch(id, transport("sandbox", cap))
      const msgs = await messagesOf(id)
      check(
        "B sandbox: ONLY the allow-listed address is mailed",
        cap.sent.length === 1 && cap.sent[0].to === A,
        JSON.stringify(cap.sent.map((m) => m.to))
      )
      check("B sandbox: intent state unchanged (queued), no delivery row", (await intentOf(id)).state === "queued" && (await deliveriesOf(id)).length === 0)
      check(
        "B sandbox: the others are dry-run messages; A's is a sandbox message",
        msgs.filter((m) => m.mode === "sandbox" && m.status === "sent").length === 1 &&
          msgs.filter((m) => m.mode === "dry-run").length === 2
      )
      const sbRow = await prisma.auditLog.findFirst({
        where: { organizationId: orgA.id, action: ACTION_SENT, metadata: { path: ["notificationMessageId"], equals: msgs.find((m) => m.mode === "sandbox")!.id } },
      })
      const sbMeta = (sbRow?.metadata ?? {}) as Record<string, unknown>
      check("B sandbox: the parallel email.sent row names only A, withheld 2", JSON.stringify(sbMeta.recipients) === JSON.stringify([A]) && sbMeta.withheld === 2)

      await dispatch(id, transport("sandbox", cap), "sweep")
      check("B sandbox (R2): the SWEEP never re-sends in sandbox", cap.sent.length === 1, `${cap.sent.length} sends`)
      await dispatch(id, transport("sandbox", cap), "producer")
      check("B sandbox (NOTIFY-5 choice 4): a producer dispatch DOES re-send", cap.sent.length === 2, `${cap.sent.length} sends`)
      check("B sandbox: dry-run rows still written once", (await messagesOf(id)).filter((m) => m.mode === "dry-run").length === 2)

      setEnv({ NOTIFY_SANDBOX_ALLOWLIST: "" })
      const id2 = await ackIntent()
      const cap2 = capture()
      await dispatch(id2, transport("sandbox", cap2))
      check(
        "B sandbox, empty allowlist: nobody mailed, three dry-run messages, state unchanged",
        cap2.attempts.length === 0 &&
          (await messagesOf(id2)).filter((m) => m.mode === "dry-run").length === 3 &&
          (await intentOf(id2)).state === "queued"
      )

      // The test kind reaches its caller in sandbox with an EMPTY allowlist.
      const caller = `notify6-caller-${tag}@example.com`
      const t = await enqueueNotification({
        organizationId: orgA.id,
        kind: "test",
        dedupeKey: `notify6-test-${tag}`,
        entityId: null,
        eventAt: new Date(),
        payload: { to: caller, provider: "resend", stamp: new Date().toISOString(), deployEnv: "fixture", sha: "notify6" },
      })
      const cap3 = capture()
      await dispatch(t!.intentId, transport("sandbox", cap3))
      check(
        "B test kind: sandbox + empty allowlist still reaches its caller (Gary's NOTIFY-5 ruling)",
        cap3.sent.length === 1 && cap3.sent[0].to === caller && (await intentOf(t!.intentId)).state === "queued"
      )
    }

    // ── C. live: one message per recipient ────────────────────────────────────
    let liveIntent = ""
    let liveProviderId = ""
    {
      liveIntent = await ackIntent()
      const cap = capture()
      await dispatch(liveIntent, transport("live", cap))
      const tos = cap.sent.map((m) => m.to)
      check(
        "C live: one message per recipient, each `to` a single address — no shared to:",
        cap.sent.length === 3 && tos.every((t) => typeof t === "string") && new Set(tos).size === 3,
        JSON.stringify(tos)
      )
      const ds = await deliveriesOf(liveIntent)
      const row = await intentOf(liveIntent)
      check("C live: three `sent` deliveries; intent sent with sentAt", ds.length === 3 && ds.every((d) => d.state === "sent" && d.messageId) && row.state === "sent" && !!row.sentAt)
      const msgs = await messagesOf(liveIntent)
      check("C live: three live messages carrying provider ids", msgs.length === 3 && msgs.every((m) => m.mode === "live" && m.providerMessageId))
      liveProviderId = msgs[0].providerMessageId!
      await dispatch(liveIntent, transport("live", cap))
      check("C live: a sent intent is never dispatched again", cap.attempts.length === 3)
    }

    // ── D. pace: the burn stays gone; the PaceAlertLog gate (W4) ──────────────
    if (!paceRunnable) {
      console.log("… skipping D (first of the month in store time — no complete day yet)")
    } else {
      const [store, gated] = await Promise.all(
        ["Burn", "Gate"].map((s) => prisma.store.create({ data: { organizationId: orgA.id, name: `NOTIFY-6 Store ${s}`, timezone: TZ } }))
      )
      const admin = await prisma.user.create({
        data: { clerkUserId: `notify6-admin-${tag}`, organizationId: orgA.id, email: `notify6-admin-${tag}@example.com`, role: "ADMIN" },
      })
      const manager = await prisma.user.create({
        data: { clerkUserId: `notify6-mgr-${tag}`, organizationId: orgA.id, email: `notify6-mgr-${tag}@example.com`, role: "MANAGER" },
      })
      for (const s of [store, gated]) {
        await prisma.storeUserAssignment.create({ data: { userId: manager.id, storeId: s.id } })
        const plan = await prisma.goalPlan.create({
          data: { organizationId: orgA.id, storeId: s.id, year: Number(today.slice(0, 4)), basisType: "MANUAL", updatedById: "notify6-fixture" },
        })
        await prisma.dailyGoal.createMany({
          data: eachDate(mStart, monthEnd).map((d) => ({ planId: plan.id, storeId: s.id, date: dbDate(d), basisAmount: 1000, goalAmount: 1000 })),
        })
        await prisma.salesPeriodCache.createMany({
          data: eachDate(mStart, asOf).map((d) => ({
            organizationId: orgA.id, storeId: s.id, date: dbDate(d), netSales: 500, grossSales: 540, taxTotal: 40, orderCount: 5,
          })),
        })
      }
      const lockFor = (storeId: string) =>
        prisma.paceAlertLog.findUnique({ where: { storeId_month: { storeId, month: dbDate(mStart) } } })
      const paceIntent = (storeId: string) =>
        prisma.notificationIntent.findUnique({
          where: { organizationId_kind_dedupeKey: { organizationId: orgA.id, kind: "pace.alert", dedupeKey: `${storeId}:${mStart.slice(0, 7)}` } },
        })

      const capDry = capture()
      const dry = await processPaceAlertForStore(store, { thresholdPct: 90, sender: capDry.sender, mode: "dry-run" })
      check("D pace dry-run: not alerted, reason dry-run, no lock", !dry.alerted && dry.reason === "dry-run" && (await lockFor(store.id)) === null, dry.reason)
      check("D pace dry-run: the intent stays queued", (await paceIntent(store.id))?.state === "queued")
      const dry2 = await processPaceAlertForStore(store, { thresholdPct: 90, sender: capDry.sender, mode: "dry-run" })
      check("D pace dry-run: the second run logs nothing new", dry2.reason === "dry-run (already logged this month)", dry2.reason)

      const capLive = capture()
      const live = await processPaceAlertForStore(store, { thresholdPct: 90, sender: capLive.sender, mode: "live" })
      const lock = await lockFor(store.id)
      check(
        "D THE BURN STAYS GONE: live later the same month sends, intent sent, PaceAlertLog written",
        live.alerted && capLive.sent.length === 2 && (await paceIntent(store.id))?.state === "sent" && !!lock,
        live.reason
      )
      check(
        "D PaceAlertLog.recipients is exactly who has a sent delivery",
        !!lock && lock.recipients.length === 2 && lock.recipients.includes(admin.email) && lock.recipients.includes(manager.email)
      )
      const again = await processPaceAlertForStore(store, { thresholdPct: 90, sender: capLive.sender, mode: "live" })
      check("D pace: still one alert per store per month", !again.alerted && capLive.sent.length === 2, again.reason)

      // W4: a pre-pipeline lock (no intent) must keep the store quiet.
      await prisma.paceAlertLog.create({
        data: { organizationId: orgA.id, storeId: gated.id, month: dbDate(mStart), pacePct: 50, thresholdPct: 90, recipients: ["pre-pipeline@example.com"] },
      })
      const capGate = capture()
      const gatedRun = await processPaceAlertForStore(gated, { thresholdPct: 90, sender: capGate.sender, mode: "live" })
      check(
        "D W4: a pre-pipeline PaceAlertLog row gates the producer — no intent, no send",
        !gatedRun.alerted && gatedRun.reason === "already alerted this month" && capGate.attempts.length === 0 && (await paceIntent(gated.id)) === null,
        gatedRun.reason
      )
    }

    // ── E. P6: retry only the recipient who did not get it ───────────────────
    {
      const id = await ackIntent()
      const t0 = new Date()
      const cap1 = capture({ failFor: [B] })
      await dispatch(id, transport("live", cap1), "producer", t0)
      const row1 = await intentOf(id)
      const ds1 = await deliveriesOf(id)
      check(
        "E P6: one of three fails → intent partial, two `sent` deliveries, one `failed`",
        row1.state === "partial" && ds1.filter((d) => d.state === "sent").length === 2 && ds1.filter((d) => d.state === "failed").length === 1,
        `${row1.state} ${ds1.map((d) => d.state).join(",")}`
      )
      check(
        "E P6: backoff set to ~1h and attempts = 1",
        row1.attempts === 1 && !!row1.nextAttemptAt && Math.abs(row1.nextAttemptAt.getTime() - t0.getTime() - HOUR) < 5000
      )
      const capEarly = capture()
      await dispatchNotifications({ transport: transport("live", capEarly), trigger: "sweep", organizationId: orgA.id, intentIds: [id], now: new Date(t0.getTime() + 30 * 60_000) })
      check("E P6: the sweep before nextAttemptAt does nothing", capEarly.attempts.length === 0)
      const cap2 = capture()
      const [retry] = await dispatchNotifications({ transport: transport("live", cap2), trigger: "sweep", organizationId: orgA.id, intentIds: [id], now: new Date(t0.getTime() + 2 * HOUR) })
      // The P6 FILTER on its own: the retry never even considers A or C. (claim()
      // would also refuse their `sent` rows — the second guard — so this is the
      // check that fails if only the filter breaks.)
      check(
        "E P6: the retry considers only the recipient without a `sent` delivery",
        JSON.stringify(retry?.recipients.map((x) => x.to)) === JSON.stringify([B]),
        JSON.stringify(retry?.recipients)
      )
      check(
        "E P6: the sweep retries → exactly ONE more message, to the failed recipient only",
        cap2.attempts.length === 1 && cap2.attempts[0] === B,
        JSON.stringify(cap2.attempts)
      )
      const okByAddress = new Map<string, number>()
      for (const m of [...cap1.sent, ...cap2.sent]) okByAddress.set(String(m.to), (okByAddress.get(String(m.to)) ?? 0) + 1)
      check(
        "E P6: nobody got it twice — each address delivered exactly once",
        [A, B, C].every((x) => okByAddress.get(x) === 1),
        JSON.stringify([...okByAddress])
      )
      check("E P6: intent sent", (await intentOf(id)).state === "sent")
    }

    // ── F. retry cap → failed ──────────────────────────────────────────────────
    let cappedIntent = ""
    {
      cappedIntent = await ackIntent()
      const capFail = capture({ failFor: [A, B, C] })
      let now = Date.now()
      const states: string[] = []
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        await dispatchNotifications({ transport: transport("live", capFail), trigger: "sweep", organizationId: orgA.id, intentIds: [cappedIntent], now: new Date(now) })
        states.push((await intentOf(cappedIntent)).state)
        now += 9 * HOUR // past every backoff step
      }
      const row = await intentOf(cappedIntent)
      check(
        `F retry cap: all-failed stays queued until attempt ${MAX_ATTEMPTS}, then failed`,
        states.slice(0, -1).every((s) => s === "queued") && row.state === "failed" && row.attempts === MAX_ATTEMPTS && row.nextAttemptAt === null,
        states.join(" → ")
      )
      const capAfter = capture()
      await dispatch(cappedIntent, transport("live", capAfter))
      check("F retry cap: a failed intent is never dispatched again", capAfter.attempts.length === 0)
    }

    // ── G. freshness and the org switch ────────────────────────────────────────
    {
      const stale = await ackIntent(orgA.id, new Date(Date.now() - 8 * 24 * HOUR))
      const cap = capture()
      await dispatch(stale, transport("live", cap))
      check("G freshness: hr.ack 8 days old → expired, nothing sent", (await intentOf(stale)).state === "expired" && cap.attempts.length === 0)

      const oldTest = await enqueueNotification({
        organizationId: orgA.id, kind: "test", dedupeKey: `notify6-oldtest-${tag}`, entityId: null,
        eventAt: new Date(Date.now() - 20 * 60_000),
        payload: { to: A, provider: "resend", stamp: "x", deployEnv: "fixture", sha: "notify6" },
      })
      await dispatch(oldTest!.intentId, transport("live", cap), "sweep")
      check("G freshness: a test 20 minutes old → expired, never sent (W3)", (await intentOf(oldTest!.intentId)).state === "expired" && cap.attempts.length === 0)

      const freshTest = await enqueueNotification({
        organizationId: orgA.id, kind: "test", dedupeKey: `notify6-freshtest-${tag}`, entityId: null, eventAt: new Date(),
        payload: { to: A, provider: "resend", stamp: "x", deployEnv: "fixture", sha: "notify6" },
      })
      await dispatch(freshTest!.intentId, transport("live", cap))
      check("G freshness: a test dispatched inline is sent, not expired (W3)", (await intentOf(freshTest!.intentId)).state === "sent")

      const switchedOff = await ackIntent()
      await prisma.organization.update({ where: { id: orgA.id }, data: { hrAckRecipients: [] } })
      const cap2 = capture()
      await dispatch(switchedOff, transport("live", cap2))
      check("G org switch: hr.ack list emptied → expired, nothing sent", (await intentOf(switchedOff)).state === "expired" && cap2.attempts.length === 0)
      await prisma.organization.update({ where: { id: orgA.id }, data: { hrAckRecipients: [A, B, C] } })

      const pace = await enqueueNotification({
        organizationId: orgA.id, kind: "pace.alert", dedupeKey: `notify6-paceoff-${tag}`, entityId: null, eventAt: new Date(),
        payload: { storeId: "none", storeName: "NOTIFY-6", monthStart: mStart, asOf, mtdActual: 1, mtdGoal: 2, goalAmount: null, projected: 1, pacePct: 50, thresholdPct: 90 },
      })
      await prisma.organization.update({ where: { id: orgA.id }, data: { paceAlertsEnabled: false } })
      await dispatch(pace!.intentId, transport("live", cap2))
      check("G org switch: pace switched off → expired", (await intentOf(pace!.intentId)).state === "expired")
      await prisma.organization.update({ where: { id: orgA.id }, data: { paceAlertsEnabled: true } })
    }

    // ── H. concurrency ─────────────────────────────────────────────────────────
    {
      const id = await ackIntent()
      const slow = capture({ delayMs: 200 })
      await Promise.all([dispatch(id, transport("live", slow)), dispatch(id, transport("live", slow), "sweep")])
      const ds = await deliveriesOf(id)
      check(
        "H concurrency: two dispatches at once → exactly one message per recipient",
        slow.attempts.length === 3 && new Set(slow.attempts).size === 3,
        JSON.stringify(slow.attempts)
      )
      check("H concurrency: three sent deliveries, intent sent", ds.length === 3 && ds.every((d) => d.state === "sent") && (await intentOf(id)).state === "sent")
      check("H concurrency: three messages, not six", (await messagesOf(id)).length === 3)
    }

    // ── I. hr.ack through the real producer ───────────────────────────────────
    {
      const doc = await prisma.hrDocument.create({
        data: { organizationId: orgA.id, kind: "Acknowledgment", title: "NOTIFY-6 Handbook", category: "Policy" },
      })
      hrIds.docId = doc.id
      const version = await prisma.hrDocumentVersion.create({
        data: {
          hrDocumentId: doc.id, versionNumber: 1, fileUrl: "notify6://fixture", fileName: "notify6.pdf",
          contentType: "application/pdf", sizeBytes: 1, fileHash: "notify6", uploadedByUserId: "notify6-fixture",
        },
      })
      const checkpoint = await prisma.hrDocumentCheckpoint.create({
        data: { hrDocumentId: doc.id, name: "NOTIFY-6 Signature", type: "Signature", orderIndex: 0 },
      })
      const staff = await prisma.staffMember.create({ data: { organizationId: orgA.id, displayName: "NOTIFY-6 Staff" } })
      hrIds.staffId = staff.id
      await prisma.hrDocumentAcknowledgment.create({
        data: {
          checkpointId: checkpoint.id, hrDocumentVersionId: version.id, staffMemberId: staff.id,
          checkpointName: checkpoint.name, checkpointType: "Signature", documentTitle: doc.title,
          documentVersionNumber: 1, documentFileHash: "notify6", staffName: "NOTIFY-6 Staff",
          typedName: "NOTIFY-6 Staff", method: "Signature", authMethod: "ClerkSession", consentGiven: true,
        },
      })
      const record = await prisma.hrSignedRecord.create({
        data: {
          hrDocumentVersionId: version.id, staffMemberId: staff.id, completedAt: new Date(),
          signedPdfPathname: "notify6/fixture.pdf", signedPdfHash: "notify6",
        },
      })
      const ackIntentRow = () =>
        prisma.notificationIntent.findUnique({
          where: { organizationId_kind_dedupeKey: { organizationId: orgA.id, kind: "hr.ack", dedupeKey: record.id } },
        })

      await prisma.organization.update({ where: { id: orgA.id }, data: { hrAckRecipients: [] } })
      const skip = await sendAckNotification(record.id)
      check("I ack: empty list → skipped, and NO intent written (F3, row-less)", skip.status === "skipped" && (await ackIntentRow()) === null)
      await prisma.organization.update({ where: { id: orgA.id }, data: { hrAckRecipients: [A, B, C] } })

      setEnv({ ...LIVE_ENV })
      resendFails = true
      resendCalls.length = 0
      let threw = false
      let out: Awaited<ReturnType<typeof sendAckNotification>> | null = null
      try {
        out = await sendAckNotification(record.id)
      } catch {
        threw = true
      }
      resendFails = false
      const row = await ackIntentRow()
      check(
        "I ack: the provider throws → sendAckNotification does NOT throw; outcome failed; intent queued, attempts 1",
        !threw && out?.status === "failed" && row?.state === "queued" && row?.attempts === 1,
        `${out?.status} ${row?.state} ${row?.attempts}`
      )
      check("I ack: one Resend call per address (no shared to:)", resendCalls.length === 3 && resendCalls.every((c) => c.to.length === 1))

      let schedThrew = false
      try {
        scheduleAckNotification(record.id) // no request scope here: after() throws, and must be caught
      } catch {
        schedThrew = true
      }
      check("I ack: scheduleAckNotification outside a request scope does not throw", !schedThrew)
      setEnv({ NOTIFY_EMAIL_PROVIDER: "console", VERCEL_ENV: undefined })
    }

    // ── J. the webhook route ───────────────────────────────────────────────────
    {
      const secret = `whsec_${Buffer.from(`notify6-${tag}-secret-key-material`).toString("base64")}`
      setEnv({ RESEND_WEBHOOK_SECRET: secret })
      const wh = new Webhook(secret)
      const post = async (type: string, emailId: string) => {
        const body = JSON.stringify({ type, created_at: new Date().toISOString(), data: { email_id: emailId, to: ["x@example.com"] } })
        const msgId = `msg_${Math.random().toString(36).slice(2)}`
        const ts = new Date()
        const sig = wh.sign(msgId, ts, body)
        const res = await resendWebhook(
          new Request("https://notify6.example.com/api/webhooks/resend", {
            method: "POST",
            headers: { "svix-id": msgId, "svix-timestamp": String(Math.floor(ts.getTime() / 1000)), "svix-signature": sig },
            body,
          })
        )
        return { status: res.status, json: (await res.json()) as Record<string, unknown> }
      }
      const msg = await prisma.notificationMessage.findUniqueOrThrow({ where: { providerMessageId: liveProviderId } })
      const r1 = await post("email.delivered", liveProviderId)
      const evs = await prisma.notificationEvent.findMany({ where: { messageId: msg.id } })
      check("J webhook: lookup by providerMessageId → one NotificationEvent on that message", r1.status === 200 && r1.json.recorded === "email.delivered" && evs.length === 1)
      const parallelEv = await prisma.auditLog.count({
        where: { organizationId: msg.organizationId, action: "email.delivered", metadata: { path: ["resendId"], equals: liveProviderId } },
      })
      check("J webhook: the parallel AuditLog event row is written, under the message's org", parallelEv === 1)
      const r2 = await post("email.delivered", liveProviderId)
      check(
        "J webhook: a duplicate event is not appended twice",
        r2.status === 200 && r2.json.ignored === "already recorded" && (await prisma.notificationEvent.count({ where: { messageId: msg.id } })) === 1
      )
      const legacyId = `notify6-legacy-resend-${tag}`
      await writeAuditLog({
        organizationId: orgA.id, userId: null, action: ACTION_SENT, entityType: NOTIFICATION_ENTITY_TYPE, entityId: null,
        metadata: { kind: "test", provider: "resend", recipients: [A], subject: "NOTIFY-6 legacy", resendId: legacyId },
      })
      const r3 = await post("email.bounced", legacyId)
      check(
        "J webhook: a pre-pipeline resendId still resolves through the AuditLog fallback",
        r3.status === 200 && r3.json.recorded === "email.bounced" && (await findAttemptByResendId(legacyId))?.organizationId === orgA.id
      )
      const r4 = await post("email.delivered", `notify6-unknown-${tag}`)
      check("J webhook: an id nobody sent is a 200, ignored", r4.status === 200 && r4.json.ignored === "no matching send")
    }

    // ── K. tenant isolation ────────────────────────────────────────────────────
    {
      const key = `notify6-shared-key-${tag}`
      const mk = (orgId: string) =>
        enqueueNotification({ organizationId: orgId, kind: "hr.ack", dedupeKey: key, entityId: null, eventAt: new Date(), payload: ackPayload(900) })
      const [ka, kb] = await Promise.all([mk(orgA.id), mk(orgB.id)])
      check("K isolation: the same dedupeKey in two orgs is two intents", !!ka && !!kb && ka.intentId !== kb.intentId && ka.created && kb.created)
      const cap = capture()
      await dispatchNotifications({ transport: transport("live", cap), trigger: "sweep", organizationId: orgA.id, intentIds: [ka!.intentId, kb!.intentId] })
      check(
        "K isolation: a dispatch scoped to A sends only A's recipients and leaves B's intent queued",
        cap.attempts.length === 3 && !cap.attempts.includes(OTHER) && (await intentOf(kb!.intentId)).state === "queued"
      )
      const capB = capture()
      await dispatch(kb!.intentId, transport("live", capB))
      check("K isolation: B's intent reaches only B's list", capB.attempts.length === 1 && capB.attempts[0] === OTHER)
      const logB = await listRecentEmails(orgB.id)
      check("K isolation: B's log holds none of A's messages", logB.length === 1 && logB[0].recipients[0] === OTHER)
    }

    // ── L. the reader ──────────────────────────────────────────────────────────
    {
      // Pre-pipeline history, backdated before the org's first message — which
      // is what "legacy" means: rows written before the pipeline existed.
      const old = new Date(Date.now() - 400 * 24 * HOUR)
      const legacy = [
        { subject: "NOTIFY-6 legacy console", metadata: { kind: "test", provider: "console", recipients: ["l@example.com"], subject: "NOTIFY-6 legacy console" }, action: ACTION_SENT },
        { subject: "NOTIFY-6 legacy no provider", metadata: { kind: "test", recipients: ["l@example.com"], subject: "NOTIFY-6 legacy no provider" }, action: ACTION_SENT },
        { subject: "NOTIFY-6 legacy dry run", metadata: { kind: "test", provider: "console", mode: "dry-run", recipients: ["l@example.com"], subject: "NOTIFY-6 legacy dry run" }, action: ACTION_DRY_RUN },
      ]
      for (const l of legacy) {
        await prisma.auditLog.create({
          data: { organizationId: orgA.id, userId: null, action: l.action, entityType: NOTIFICATION_ENTITY_TYPE, entityId: null, metadata: l.metadata, createdAt: old },
        })
      }
      const log = await listRecentEmails(orgA.id, 200)
      const pipeline = log.filter((e) => e.section === "pipeline")
      const hist = log.filter((e) => e.section === "legacy")
      const bySubject = (s: string) => hist.find((e) => e.subject === s)
      check("L reader: pipeline rows come first, one per recipient", pipeline.length > 0 && log.indexOf(pipeline[0]) === 0 && pipeline.every((e) => e.recipients.length === 1))
      check("L reader: legacy console row still reads 'logged only'", bySubject("NOTIFY-6 legacy console")?.status === "logged only")
      check("L reader: legacy provider-less row still reads 'unknown'", bySubject("NOTIFY-6 legacy no provider")?.status === "unknown")
      check("L reader: legacy dry-run row still reads 'dry run'", bySubject("NOTIFY-6 legacy dry run")?.status === "dry run")
      check(
        "L reader: no parallel AuditLog copy is listed as history",
        hist.length === 3,
        `${hist.length} legacy rows: ${hist.map((h) => h.subject).join(" | ")}`
      )
      const liveMsg = await prisma.notificationMessage.findUniqueOrThrow({ where: { providerMessageId: liveProviderId } })
      check("L reader: a message with a delivered event reads 'delivered'", pipeline.find((e) => e.id === liveMsg.id)?.status === "delivered")
      check("L reader: pipeline dry-run rows read 'dry run'", pipeline.some((e) => e.status === "dry run"))
      const gaveUp = pipeline.filter((e) => e.status === "failed" && (e.detail ?? "").includes(`gave up after ${MAX_ATTEMPTS} attempts`))
      check("L reader: a failed intent's newest failed row says it gave up, once", gaveUp.length === 1, `${gaveUp.length}`)
    }
  } finally {
    globalThis.fetch = realFetch
    restoreEnv()
    for (const orgId of orgIds) {
      const intents = await prisma.notificationIntent.findMany({ where: { organizationId: orgId }, select: { id: true } })
      await prisma.notificationDelivery.deleteMany({ where: { intentId: { in: intents.map((i) => i.id) } } })
      await prisma.notificationMessage.deleteMany({ where: { organizationId: orgId } })
      await prisma.notificationIntent.deleteMany({ where: { organizationId: orgId } })
      await prisma.auditLog.deleteMany({ where: { organizationId: orgId } })
    }
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
    for (const orgId of orgIds) {
      await prisma.storeUserAssignment.deleteMany({ where: { user: { organizationId: orgId } } })
      await prisma.user.deleteMany({ where: { organizationId: orgId } })
      await prisma.store.deleteMany({ where: { organizationId: orgId } })
      await prisma.organization.delete({ where: { id: orgId } })
    }
    console.log(`\nFixture orgs ${orgIds.join(", ")} (NOTIFY-6) and everything under them deleted.`)
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`)
    process.exit(1)
  }
  console.log("\nAll NOTIFY-6 checks passed.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
