import { prisma } from "@/lib/prisma"
import { Prisma, type Store } from "@prisma/client"
import { getMonthGoal } from "@/lib/month-goal"
import { projectMonthEnd, round2 } from "@/lib/pacing"
import { addDaysStr } from "@/lib/goal-engine"
import { localDateStr, dbDate } from "@/lib/reports"
import type { EmailSender } from "@/lib/notify"
import { renderEmail } from "@/lib/email-template"
import { ACTION_FAILED, ACTION_SENT, recordEmailAttempt } from "@/lib/notification-log"
import { can, grantsFrom, overridesFrom } from "@/lib/permissions"

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

  // NOTIFY-2c — ROLE ARM IN SQL, PER-USER DENIAL IN can(), AND IT IS STILL ONE
  // QUERY. The `where` is untouched: every ADMIN plus the store's assigned
  // MANAGERs, exactly as before. What is new is three more COLUMNS on the same
  // round trip and a filter through can() on the rows that come back — so the
  // "post-filter" costs no second query, and the choice between the two
  // placements is about correctness alone (F2, 2026-09-20).
  //
  // WHY NOT `NOT: { deniedCapabilities: { has: … } }` IN THE QUERY. It would be
  // right today and quietly wrong later. can() is not a single array test — it
  // is a fail-closed load (overridesFrom), a role baseline, and an elevation
  // branch gated on GRANTABLE_CAPABILITIES, evaluated in that order. An SQL
  // predicate can express today's snapshot of that and cannot express the
  // ordering, so the day a precedence rule moves, the grid and the mailing list
  // would disagree with nothing to say which was right. The rule this file
  // follows is the registry's own: ask can(), never re-derive it.
  //
  // THE THREE COLUMNS ARE ALL REQUIRED. `deniedCapabilities` is the answer;
  // `role` is what the baseline is read against; `grantedCapabilities` is
  // selected even though notify.pace.receive is NOT in GRANTABLE_CAPABILITIES
  // today — a select that omits it would become an under-mail the moment that
  // changed, and overridesFrom's three-state contract exists precisely because
  // a forgotten column looks identical to an empty one.
  const users = await prisma.user.findMany({
    where: {
      organizationId: store.organizationId,
      OR: [{ role: "ADMIN" }, { role: "MANAGER", storeAssignments: { some: { storeId: store.id } } }],
    },
    select: { email: true, role: true, deniedCapabilities: true, grantedCapabilities: true },
  })
  const recipients = [
    ...new Set(
      users
        .filter((u) =>
          can(
            {
              role: u.role,
              overrides: overridesFrom(u.deniedCapabilities),
              grants: grantsFrom(u.grantedCapabilities),
            },
            "notify.pace.receive"
          )
        )
        .map((u) => u.email)
        .filter(Boolean)
    ),
  ]
  if (recipients.length === 0) {
    // TWO DIFFERENT SILENCES, AND THE CRON LOG MUST TELL THEM APART. "Nobody
    // holds the role" is a setup problem; "every eligible person has the row
    // unticked" is an admin's deliberate choice, and reading the first when it
    // was the second is how someone goes looking for a bug in the query. No
    // lock is written on either path, so tomorrow re-evaluates from scratch.
    const reason =
      users.length === 0
        ? "no admin/manager recipients"
        : "every admin/manager has behind-pace alerts denied"
    return { ...base, pacePct: verdict.pacePct, alerted: false, reason }
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

  // NOTIFY-2b. THE ORG NAME IS FETCHED HERE RATHER THAN WIDENING THE SIGNATURE.
  // processPaceAlertForStore is typed `store: Store` and NOTIFY-2a deliberately
  // kept it that way — including `organization` on the cron's store query would
  // make every caller, the fixture included, carry a payload the function does
  // not read. This query runs ONLY on the alert path, which by construction
  // happens at most once per store per month, so it is one round trip a year
  // per store and not one per cron run. A missing row cannot happen (the store
  // has a foreign key to it) but is tolerated rather than thrown on: an
  // untitled header is not worth losing the alert over.
  const orgRow = await prisma.organization.findUnique({
    where: { id: store.organizationId },
    select: { name: true },
  })
  const orgName = orgRow?.name ?? store.name

  // THE SUBJECT AND TEXT ARE UNCHANGED FROM F-5, BYTE FOR BYTE. They are
  // assembled here instead of inline at the send so the audit row below can
  // name the subject and the template can take the text verbatim. Anything
  // that edits these lines is changing the wording of a live alert, which is
  // NOT what NOTIFY-2b was asked to do — the phase adds an HTML alternative
  // body and nothing else about what this email says.
  const subject = `${store.name} is behind pace for ${monthName} — ${verdict.pacePct!.toFixed(1)}% of MTD goal`
  const headline = `${store.name} is trailing its ${monthName} sales goal (through ${asOf}).`
  const mtdLine = `${usd(mtdActual)} of ${usd(goal.mtdGoal)} goal (${verdict.pacePct!.toFixed(1)}%)`
  const projectedLine =
    goal.goalAmount !== null
      ? `${usd(projected)} vs ${usd(goal.goalAmount)} goal (${((projected / goal.goalAmount) * 100).toFixed(1)}%)`
      : null
  const text = [
    headline,
    ``,
    `Month to date: ${mtdLine}`,
    projectedLine !== null ? `Projected month end: ${projectedLine}` : null,
    ``,
    `Alert threshold: ${opts.thresholdPct}% of MTD goal. You'll get at most one alert per store per month.`,
    `Dashboard: ${appUrl}/dashboard`,
  ]
    .filter((l) => l !== null)
    .join("\n")

  const { html } = renderEmail({
    orgName,
    heading: headline,
    intro: "",
    rows: [
      { label: "Month to date", value: mtdLine },
      ...(projectedLine !== null ? [{ label: "Projected month end", value: projectedLine }] : []),
      { label: "Alert threshold", value: `${opts.thresholdPct}% of MTD goal` },
    ],
    cta: { label: "Open the dashboard", url: `${appUrl}/dashboard` },
    footer: `You'll get at most one alert per store per month. Sent by USE Froot on behalf of ${orgName}. This address does not accept replies.`,
    appUrl,
    text,
  })

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
    const { id } = await opts.sender.send({ to: recipients, subject, text, html })
    // NOTIFY-2b. THE FIRST AuditLog ROW THIS PATH HAS EVER WRITTEN. PaceAlertLog
    // above records that an alert went out, but it is a per-store-month
    // idempotency lock — it carries no provider, no subject and no failure row,
    // so nothing in it can tell a real send from a console-mode one, and a
    // Resend delivery event had no row to find its org by. Both of those are
    // what the send log and the webhook need. AFTER the send, never before: the
    // lock is the thing that must precede the send, and this is a record of
    // what happened rather than a claim staked in advance.
    await recordEmailAttempt({
      organizationId: store.organizationId,
      entityId: store.id,
      kind: "pace.alert",
      action: ACTION_SENT,
      recipients,
      subject,
      resendId: id ?? null,
    })
  } catch (e) {
    // Recorded BEFORE the lock release below, so the row exists even if the
    // delete then throws. recordEmailAttempt never throws (it catches its own
    // failures), so it cannot displace the original error on the way out.
    await recordEmailAttempt({
      organizationId: store.organizationId,
      entityId: store.id,
      kind: "pace.alert",
      action: ACTION_FAILED,
      recipients,
      subject,
      error: e instanceof Error ? e.message : String(e),
    })
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
