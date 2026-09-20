import { prisma } from "@/lib/prisma"
import { Prisma, type Store } from "@prisma/client"
import { getMonthGoal } from "@/lib/month-goal"
import { projectMonthEnd, round2 } from "@/lib/pacing"
import { addDaysStr } from "@/lib/goal-engine"
import { localDateStr, dbDate } from "@/lib/reports"
import type { EmailSender } from "@/lib/notify"

// ─── Behind-pace alerts (Phase F-5) ──────────────────────────────────────────
// A store is "behind pace" when MTD actual ÷ MTD goal drops below the
// threshold. Pace is measured through YESTERDAY (store-local) so a 7am cron
// doesn't compare a full MTD goal against half a morning of sales. The goal
// math is the same shared helpers the dashboard uses (month-goal.ts +
// pacing.ts) so the alert and the Monthly Goal card can't drift.
// Non-spammy: at most ONE alert per store per month, enforced by the
// PaceAlertLog unique constraint.

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

// Evaluates one store and sends at most one alert per store-month.
export async function processPaceAlertForStore(
  store: Store,
  opts: { thresholdPct: number; sender: EmailSender; now?: Date }
): Promise<PaceAlertResult> {
  const base = { storeId: store.id, storeName: store.name }
  const today = localDateStr(opts.now ?? new Date(), store.timezone)
  const asOf = addDaysStr(today, -1) // last complete day
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

  const monthKey = dbDate(mStart)
  const already = await prisma.paceAlertLog.findUnique({
    where: { storeId_month: { storeId: store.id, month: monthKey } },
  })

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
      reason: already ? "already alerted this month" : "on pace",
    }
  }

  const users = await prisma.user.findMany({
    where: {
      organizationId: store.organizationId,
      OR: [{ role: "ADMIN" }, { role: "MANAGER", storeAssignments: { some: { storeId: store.id } } }],
    },
    select: { email: true },
  })
  const recipients = [...new Set(users.map((u) => u.email).filter(Boolean))]
  if (recipients.length === 0) {
    return { ...base, pacePct: verdict.pacePct, alerted: false, reason: "no admin/manager recipients" }
  }

  // ORDERING: LOCK -> SEND -> RELEASE ON FAILURE (DEBT-105, F3, Gary 2026-09-20).
  //
  // The log row is the idempotency lock — write it BEFORE sending so a crash
  // or concurrent run can't double-alert. A unique violation means another
  // run got here first. That half is unchanged and was never the defect.
  //
  // What was missing is the release. Until F-5b nothing undid this row when the
  // send then threw, so a single runtime failure — a non-2xx from Resend, the
  // 10s AbortController timeout — burned the store's one-alert-per-month lock
  // and the NEXT day's run reported the reassuring "already alerted this month"
  // for a mail that never left. See the release at the send below.
  let lock: { id: string }
  try {
    lock = await prisma.paceAlertLog.create({
      data: {
        organizationId: store.organizationId,
        storeId: store.id,
        month: monthKey,
        pacePct: round2(verdict.pacePct!),
        thresholdPct: opts.thresholdPct,
        recipients,
      },
      select: { id: true },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ...base, pacePct: verdict.pacePct, alerted: false, reason: "already alerted this month" }
    }
    throw e
  }

  const projected = projectMonthEnd({
    mtdActual,
    mtdGoal: goal.mtdGoal,
    monthGoal: goal.goalAmount,
    daysElapsed: goal.daysElapsed,
    daysInMonth: goal.daysInMonth,
  })
  const monthName = new Date(`${mStart}T12:00:00Z`).toLocaleDateString("en-US", { month: "long" })
  const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.usefroot.com"

  // RELEASE ON FAILURE. Deleting BY ID is the whole of the concurrency
  // argument and is not a style choice: a delete by the {storeId, month} unique
  // key would destroy whichever row is there, and on a concurrent run that is
  // the WINNER'S row — the one whose email is in flight or already delivered.
  // `lock.id` can only ever name the row this call created, so a loser that
  // fails has nothing of anyone else's to delete.
  //
  // Then RETHROW, so the per-store catch in the cron route still records
  // `error: …` against this store and the run continues to the next one. The
  // net effect is that tomorrow's run re-evaluates this store from scratch and
  // may alert; a double-alert stays impossible, because a send that SUCCEEDS
  // leaves the row exactly where it has always been.
  try {
    await opts.sender.send({
      to: recipients,
      subject: `${store.name} is behind pace for ${monthName} — ${verdict.pacePct!.toFixed(1)}% of MTD goal`,
      text: [
        `${store.name} is trailing its ${monthName} sales goal (through ${asOf}).`,
        ``,
        `Month to date: ${usd(mtdActual)} of ${usd(goal.mtdGoal)} goal (${verdict.pacePct!.toFixed(1)}%)`,
        goal.goalAmount !== null
          ? `Projected month end: ${usd(projected)} vs ${usd(goal.goalAmount)} goal (${((projected / goal.goalAmount) * 100).toFixed(1)}%)`
          : null,
        ``,
        `Alert threshold: ${opts.thresholdPct}% of MTD goal. You'll get at most one alert per store per month.`,
        `Dashboard: ${appUrl}/dashboard`,
      ]
        .filter((l) => l !== null)
        .join("\n"),
    })
  } catch (e) {
    // The release itself must not mask the send failure. If the delete also
    // throws — the row is already gone, the connection is down — the ORIGINAL
    // error is still what gets rethrown, because that is the one that explains
    // why no email went out. A swallowed delete failure leaves the lock in
    // place, which is exactly the pre-F-5b behaviour and no worse.
    await prisma.paceAlertLog
      .delete({ where: { id: lock.id } })
      .catch((delErr) =>
        console.error(`[pace-alerts] store=${store.id}: send failed AND lock release failed (lock ${lock.id}): ${delErr}`)
      )
    throw e
  }

  return { ...base, pacePct: verdict.pacePct, alerted: true, reason: "behind pace", recipients }
}
