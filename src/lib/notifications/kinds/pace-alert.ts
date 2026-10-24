// ─── NOTIFY-6: kind "pace.alert" — behind-pace alert (Phase F-5) ─────────────
// The producer is src/lib/pace-alerts.ts (the daily evaluation). It enqueues
// one intent per store-month, dedupeKey "{storeId}:{YYYY-MM}", while the store
// is behind, and refreshes the payload every day it stays behind — so a store
// enqueued in dry-run on day 3 still alerts on day 20 once mail is live (the
// console-mode burn stays gone, NOTIFY-5).
//
// THE SUBJECT AND TEXT ARE F-5's, BYTE FOR BYTE. They moved here from
// pace-alerts.ts unchanged; verify-f5-polish.ts pins every fixed byte. Anything
// that edits these lines is changing the wording of a live alert.
// NOTIFY-SCHED (F13): the one "at most one alert per store per month" sentence
// now comes from paceAlertLimitLine(), and is byte-identical whenever the
// intent carries no frequency or "monthly" — every send with no schedule row.

import { prisma } from "@/lib/prisma"
import { dbDate } from "@/lib/reports"
import { round2 } from "@/lib/pacing"
import { renderEmail } from "@/lib/email-template"
import { defineNotification, type ScheduleFrequency } from "../define"

export type PaceAlertPayload = {
  storeId: string
  storeName: string
  /** Store-local first of the month, YYYY-MM-DD. */
  monthStart: string
  /** Last complete store-local day, YYYY-MM-DD. */
  asOf: string
  mtdActual: number
  mtdGoal: number
  goalAmount: number | null
  projected: number
  pacePct: number
  thresholdPct: number
  /**
   * NOTIFY-SCHED: the schedule's frequency when this intent was enqueued — the
   * send-lock period in its dedupeKey. ABSENT ON EVERY PRE-NOTIFY-SCHED INTENT
   * and on every run with no schedule row; absent and "monthly" render the F-5
   * text byte for byte (F6, F13).
   */
  frequency?: ScheduleFrequency
}

/**
 * F13 (Gary, 2026-10-24): "wording follows the schedule, default unchanged".
 * The monthly sentence is F-5's, pinned by verify-f5-polish.ts.
 */
export function paceAlertLimitLine(frequency: ScheduleFrequency | undefined): string {
  if (frequency === "daily") return "You'll get at most one alert per store per day."
  if (frequency === "weekly") return "You'll get at most one alert per store per week."
  return "You'll get at most one alert per store per month."
}

export const paceAlertKind = defineNotification<PaceAlertPayload>({
  kind: "pace.alert",
  label: "Behind-pace alert",
  roleDefault: { summary: "Every admin, and the store's assigned managers.", usersLink: true },
  // F4: an extra gets every store's alert; per-store extras are deferred.
  extras: true,
  capability: "notify.pace.receive",
  enabled: (org) => org.paceAlertsEnabled,
  // NOTIFY-SCHED. Per store, in Store.timezone. F10: 5 AM–8 PM local. F11:
  // monthly keeps today's behaviour — evaluated every allowed day, at most one
  // alert per store-month.
  schedule: {
    scope: "store",
    frequencies: ["daily", "weekly", "monthly"],
    monthly: "every-allowed-day",
    hours: { min: 5, max: 20 },
    legacyUtcHour: 15,
  },
  // The producer re-enqueues daily while the store stays behind, refreshing
  // eventAt; a queued intent a day stale means the store recovered or the cron
  // stopped, and either way yesterday's figures are not worth mailing.
  freshnessMinutes: 24 * 60,
  batch: "per-intent",

  // Every ADMIN plus the store's assigned MANAGERs — the F-5 query, unchanged.
  // can() is applied by the dispatcher (NOTIFY-2c's rule: ask can(), never
  // re-derive it in SQL).
  async resolveRecipients(intent) {
    const users = await prisma.user.findMany({
      where: {
        organizationId: intent.organizationId,
        OR: [
          { role: "ADMIN" },
          { role: "MANAGER", storeAssignments: { some: { storeId: intent.payload.storeId } } },
        ],
      },
      select: { id: true, email: true, role: true, deniedCapabilities: true, grantedCapabilities: true },
    })
    return users
      .filter((u) => !!u.email)
      .map((u) => ({
        email: u.email,
        user: {
          id: u.id,
          role: u.role,
          deniedCapabilities: u.deniedCapabilities,
          grantedCapabilities: u.grantedCapabilities,
        },
      }))
  },

  render(p, org) {
    const monthName = new Date(`${p.monthStart}T12:00:00Z`).toLocaleDateString("en-US", { month: "long" })
    const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.usefroot.com"
    const orgName = org.name

    const subject = `${p.storeName} is behind pace for ${monthName} — ${p.pacePct.toFixed(1)}% of MTD goal`
    const headline = `${p.storeName} is trailing its ${monthName} sales goal (through ${p.asOf}).`
    const mtdLine = `${usd(p.mtdActual)} of ${usd(p.mtdGoal)} goal (${p.pacePct.toFixed(1)}%)`
    const projectedLine =
      p.goalAmount !== null
        ? `${usd(p.projected)} vs ${usd(p.goalAmount)} goal (${((p.projected / p.goalAmount) * 100).toFixed(1)}%)`
        : null
    const text = [
      headline,
      ``,
      `Month to date: ${mtdLine}`,
      projectedLine !== null ? `Projected month end: ${projectedLine}` : null,
      ``,
      `Alert threshold: ${p.thresholdPct}% of MTD goal. ${paceAlertLimitLine(p.frequency)}`,
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
        { label: "Alert threshold", value: `${p.thresholdPct}% of MTD goal` },
      ],
      cta: { label: "Open the dashboard", url: `${appUrl}/dashboard` },
      footer: `${paceAlertLimitLine(p.frequency)} Sent by USE Froot on behalf of ${orgName}. This address does not accept replies.`,
      appUrl,
      text,
    })
    return { subject, text, html }
  },

  // THE PARALLEL PaceAlertLog WRITE (one release; NOTIFY-9 stops it). Written
  // when the intent first becomes `sent`, so the row still means "this store
  // was alerted this month" and `recipients` is exactly who has a `sent`
  // delivery. A unique violation means a pre-pipeline row already exists for
  // the store-month, which the producer gate should have stopped — tolerated,
  // never thrown: the email has already gone.
  //
  // NOTIFY-SCHED: under a daily or weekly schedule the store-month row already
  // exists from the month's first alert, so a conflict becomes routine — the
  // row records that the store was alerted this month, not every alert. Hence
  // ON CONFLICT DO NOTHING (skipDuplicates) rather than create() + catch
  // P2002, which would print a prisma:error line for every such send. The
  // outcome on conflict is unchanged: nothing written, nothing thrown.
  async onSent(intent, sentTo) {
    const p = intent.payload
    try {
      await prisma.paceAlertLog.createMany({
        data: [
          {
            organizationId: intent.organizationId,
            storeId: p.storeId,
            month: dbDate(p.monthStart),
            pacePct: round2(p.pacePct),
            thresholdPct: p.thresholdPct,
            recipients: sentTo,
          },
        ],
        skipDuplicates: true,
      })
    } catch (e) {
      console.error(`[pace-alerts] intent=${intent.id} store=${p.storeId}: PaceAlertLog parallel write failed: ${e}`)
    }
  },
})
