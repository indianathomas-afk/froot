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

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { dbDate } from "@/lib/reports"
import { round2 } from "@/lib/pacing"
import { renderEmail } from "@/lib/email-template"
import { defineNotification } from "../define"

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
}

export const paceAlertKind = defineNotification<PaceAlertPayload>({
  kind: "pace.alert",
  label: "Behind-pace alert",
  capability: "notify.pace.receive",
  enabled: (org) => org.paceAlertsEnabled,
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
      `Alert threshold: ${p.thresholdPct}% of MTD goal. You'll get at most one alert per store per month.`,
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
      footer: `You'll get at most one alert per store per month. Sent by USE Froot on behalf of ${orgName}. This address does not accept replies.`,
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
  async onSent(intent, sentTo) {
    const p = intent.payload
    try {
      await prisma.paceAlertLog.create({
        data: {
          organizationId: intent.organizationId,
          storeId: p.storeId,
          month: dbDate(p.monthStart),
          pacePct: round2(p.pacePct),
          thresholdPct: p.thresholdPct,
          recipients: sentTo,
        },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return
      console.error(`[pace-alerts] intent=${intent.id} store=${p.storeId}: PaceAlertLog parallel write failed: ${e}`)
    }
  },
})
