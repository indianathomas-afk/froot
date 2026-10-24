import { prisma } from "@/lib/prisma"
import type { Store } from "@prisma/client"
import { getMonthGoal } from "@/lib/month-goal"
import { projectMonthEnd } from "@/lib/pacing"
import { addDaysStr } from "@/lib/goal-engine"
import { localDateStr, dbDate } from "@/lib/reports"
import type { DeliveryMode, EmailSender } from "@/lib/notify"
import { dispatchNotifications, enqueueNotification } from "@/lib/notifications/dispatch"
import type { PaceAlertPayload } from "@/lib/notifications/kinds/pace-alert"
import type { ScheduleFrequency } from "@/lib/notifications/define"
import { periodKey } from "@/lib/notifications/schedule"

// ─── Behind-pace alerts (Phase F-5) ──────────────────────────────────────────
// A store is "behind pace" when MTD actual ÷ MTD goal drops below the
// threshold. Pace is measured through YESTERDAY (store-local) so a 7am cron
// doesn't compare a full MTD goal against half a morning of sales. The goal
// math is the same shared helpers the dashboard uses (month-goal.ts +
// pacing.ts) so the alert and the Monthly Goal card can't drift.
// Non-spammy: at most ONE alert per store per month.
//
// NOTIFY-6: THIS FILE IS NOW A PRODUCER. It evaluates the store exactly as
// before and, while the store is behind, ENQUEUES one "pace.alert" intent per
// store-month (dedupeKey "{storeId}:{YYYY-MM}"); the dispatcher in
// src/lib/notifications/dispatch.ts decides who gets it, in which mode, and
// records it. The sent-once lock is the intent's state. The email itself —
// subject and text byte for byte — lives in src/lib/notifications/kinds/
// pace-alert.ts, which also writes PaceAlertLog in parallel when the intent
// becomes sent (one release; NOTIFY-9 stops it).
//
// NOTIFY-SCHED: the caller may pass the store's schedule frequency. It sets
// the SEND-LOCK PERIOD only (F4): monthly — or no frequency at all, which is
// every run with no schedule row — keeps the dedupeKey "{storeId}:{YYYY-MM}"
// and every reason string byte for byte; weekly is "{storeId}:{YYYY-Www}" and
// daily "{storeId}:{YYYY-MM-DD}", both from the store-local TODAY. WHEN the
// store is evaluated is the hourly runner's (src/lib/scheduled-emails.ts), not
// this file's.

export const DEFAULT_PACE_THRESHOLD_PCT = 90

export function paceThresholdPct(): number {
  const n = Number(process.env.PACE_ALERT_THRESHOLD_PCT)
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : DEFAULT_PACE_THRESHOLD_PCT
}

// Pure decision — unit-tested in scripts/verify-f5-polish.ts.
export function evaluatePaceAlert(args: {
  mtdActual: number
  mtdGoal: number | null
  thresholdPct: number
  alreadySent: boolean
}): { pacePct: number | null; shouldAlert: boolean } {
  const { mtdActual, mtdGoal, thresholdPct, alreadySent } = args
  if (mtdGoal === null || mtdGoal <= 0) return { pacePct: null, shouldAlert: false }
  const pacePct = (mtdActual / mtdGoal) * 100
  return { pacePct, shouldAlert: !alreadySent && pacePct < thresholdPct }
}

export type PaceAlertResult = {
  storeId: string
  storeName: string
  pacePct: number | null
  alerted: boolean
  reason: string
  recipients?: string[]
}

// Evaluates one store and alerts at most once per store-month.
//
// NOTIFY-6: SAME SIGNATURE AND RESULT AS BEFORE (audit choice 10), so the cron
// and every fixture keep their entry point: evaluate → enqueue → dispatch this
// one intent with the caller's sender and mode as the transport. The reasons
// are NOTIFY-5's strings wherever the situation is the same one.
export async function processPaceAlertForStore(
  store: Store,
  // NOTIFY-5: `mode` is REQUIRED and comes from the caller, next to `sender`.
  // The cron resolves both once, before its store loop, so one run cannot mix
  // modes; deliveryMode() is still the only thing that decides it. Not
  // defaulted from the environment on purpose: verify-f5-polish.ts asserts
  // live behaviour, and a default would silently turn it into a dry-run test on
  // any machine without NOTIFY_EMAIL_PROVIDER set.
  opts: { thresholdPct: number; sender: EmailSender; mode: DeliveryMode; now?: Date; frequency?: ScheduleFrequency }
): Promise<PaceAlertResult> {
  const base = { storeId: store.id, storeName: store.name }
  const now = opts.now ?? new Date()
  const today = localDateStr(now, store.timezone)
  const asOf = addDaysStr(today, -1) // last complete day
  // NOTIFY-SCHED. Monthly and "no schedule" are one path, and it is the
  // pre-NOTIFY-SCHED path exactly.
  const monthly = opts.frequency === undefined || opts.frequency === "monthly"
  const periodWord = monthly ? "month" : opts.frequency === "weekly" ? "week" : "day"
  if (asOf.slice(0, 7) !== today.slice(0, 7)) {
    return { ...base, pacePct: null, alerted: false, reason: "month just started" }
  }

  const goal = await getMonthGoal(store.id, asOf)
  if (goal.source !== "plan" || goal.mtdGoal === null || goal.mtdGoal <= 0) {
    return { ...base, pacePct: null, alerted: false, reason: "no plan for this month" }
  }

  const mStart = `${asOf.slice(0, 7)}-01`
  const mtdAgg = await prisma.salesPeriodCache.aggregate({
    where: { storeId: store.id, date: { gte: dbDate(mStart), lte: dbDate(asOf) } },
    _sum: { netSales: true },
  })
  const mtdActual = mtdAgg._sum.netSales ?? 0

  // THE PaceAlertLog GATE STAYS FOR THE PARALLEL-WRITE RELEASE (audit W4). On
  // deploy day the intent table is empty, so a store alerted this month by the
  // pre-pipeline code has a PaceAlertLog row and no intent; without this read it
  // would be enqueued fresh and alerted a second time. It also keeps honouring
  // locks burned before NOTIFY-5. NOTIFY-9, which stops the PaceAlertLog write,
  // must move this gate onto the intent state in the same change.
  //
  // NOTIFY-SCHED (audit P1): MONTHLY ONLY. The row is keyed by month, so under a
  // daily or weekly period it would read "already sent" for the rest of the
  // month after the first alert and block every later one. Daily and weekly
  // periods began with this phase, so no pre-pipeline lock can exist for them;
  // their only lock is the intent.
  const already = monthly
    ? await prisma.paceAlertLog.findUnique({
        where: { storeId_month: { storeId: store.id, month: dbDate(mStart) } },
      })
    : null

  const verdict = evaluatePaceAlert({
    mtdActual,
    mtdGoal: goal.mtdGoal,
    thresholdPct: opts.thresholdPct,
    alreadySent: !!already,
  })
  if (!verdict.shouldAlert) {
    return {
      ...base,
      pacePct: verdict.pacePct,
      alerted: false,
      reason: already ? `already alerted this ${periodWord}` : "on pace",
    }
  }
  const pacePct = verdict.pacePct!

  const projected = projectMonthEnd({
    mtdActual,
    mtdGoal: goal.mtdGoal,
    monthGoal: goal.goalAmount,
    daysElapsed: goal.daysElapsed,
    daysInMonth: goal.daysInMonth,
  })
  const payload: PaceAlertPayload = {
    storeId: store.id,
    storeName: store.name,
    monthStart: mStart,
    asOf,
    mtdActual,
    mtdGoal: goal.mtdGoal,
    goalAmount: goal.goalAmount,
    projected,
    pacePct,
    thresholdPct: opts.thresholdPct,
    // Absent unless a schedule row chose it, so a no-row payload is the
    // pre-NOTIFY-SCHED payload exactly (F6).
    ...(opts.frequency ? { frequency: opts.frequency } : {}),
  }

  // ENQUEUE — refreshes a queued or expired intent with today's figures; a sent
  // one is left alone (sent stays sent).
  const enq = await enqueueNotification({
    organizationId: store.organizationId,
    kind: "pace.alert",
    // Monthly: the asOf month, as since NOTIFY-6. Daily/weekly: the period of
    // the store-local today the alert is sent on.
    dedupeKey: `${store.id}:${monthly ? mStart.slice(0, 7) : periodKey(opts.frequency!, today)}`,
    entityId: store.id,
    eventAt: now,
    payload,
  })
  // Rethrown into the cron's per-store catch, which records `error: …` and moves
  // on — the same place a send failure has always surfaced.
  if (!enq) throw new Error("could not record the pace-alert intent")
  if (enq.state === "sent" || enq.state === "known") {
    return { ...base, pacePct, alerted: false, reason: `already alerted this ${periodWord}` }
  }
  if (enq.state === "failed") {
    return { ...base, pacePct, alerted: false, reason: `gave up this ${periodWord} after repeated send failures` }
  }

  // DISPATCH — the caller's sender and mode are the transport.
  const [r] = await dispatchNotifications({
    transport: { mode: opts.mode, sender: () => opts.sender },
    trigger: "producer",
    intentIds: [enq.intentId],
    now,
  })
  if (!r) {
    // Partly sent and waiting out its backoff; the hourly sweep owns it now.
    return { ...base, pacePct, alerted: false, reason: "partly sent — retry scheduled" }
  }
  if (r.outcome === "expired") {
    // The org switch went off, or the intent aged out. The cron only evaluates
    // enabled orgs, so in production this is a switch flipped mid-run.
    return { ...base, pacePct, alerted: false, reason: r.reason }
  }
  if (r.eligible === 0) {
    // TWO DIFFERENT SILENCES, AND THE CRON LOG MUST TELL THEM APART (NOTIFY-2c).
    // "Nobody holds the role" is a setup problem; "every eligible person has the
    // row unticked" is an admin's deliberate choice. Nothing is consumed on
    // either path, so tomorrow re-evaluates from scratch.
    return {
      ...base,
      pacePct,
      alerted: false,
      // NOTIFY-12: candidates now include "Also send to" extras.
      reason:
        r.candidates === 0
          ? "no recipients (no admin/manager, no extras)"
          : "every admin/manager and extra has behind-pace alerts denied",
    }
  }

  const sentTo = r.recipients.filter((x) => x.status === "sent" && x.mode !== "dry-run").map((x) => x.to)
  const failed = r.recipients.filter((x) => x.status === "failed" && x.mode !== "dry-run")

  if (opts.mode === "live") {
    if (r.outcome === "sent") return { ...base, pacePct, alerted: true, reason: "behind pace", recipients: sentTo }
    if (sentTo.length > 0 || r.outcome === "partial") {
      return { ...base, pacePct, alerted: true, reason: `partly sent: ${r.reason}`, recipients: sentTo }
    }
    // DEBT-105's guarantee, kept: a send that fails leaves NO PaceAlertLog row,
    // and the failure still reaches the cron's per-store catch. The intent stays
    // queued with a backoff; the sweep and tomorrow's run both retry it.
    if (failed.length > 0) throw new Error(failed[0].error ?? "send failed")
    return { ...base, pacePct, alerted: false, reason: r.reason }
  }

  // sandbox: real mail to allow-listed addresses only, nothing consumed (P2).
  if (opts.mode === "sandbox") {
    if (r.withheld > 0) {
      console.log(
        `[pace-alerts] store=${store.id} sandbox: withheld ${r.withheld} recipient(s) not on the allowlist: ${r.recipients
          .filter((x) => x.mode === "dry-run")
          .map((x) => x.to)
          .join(", ")}`
      )
    }
    if (failed.length > 0) throw new Error(failed[0].error ?? "send failed")
    if (sentTo.length > 0) return { ...base, pacePct, alerted: true, reason: "sandbox", recipients: sentTo }
  }

  // dry-run — or a sandbox run whose allowlist held nobody.
  const wouldBe = r.recipients.map((x) => x.to)
  const loggedNow = r.recipients.some((x) => x.status === "dry-run" || x.status === "failed")
  return {
    ...base,
    pacePct,
    alerted: false,
    reason: loggedNow ? "dry-run" : `dry-run (already logged this ${periodWord})`,
    recipients: wouldBe,
  }
}
