// ─── MS-4b: kind "milestone.reached" — staff milestone emails ────────────────
// The producer is src/lib/milestone-alerts.ts, inside the daily pace-alerts
// cron. One intent per (member, milestone), dedupeKey
// "{staffMemberId}:{tenure|checklist}:{milestoneId}", so a milestone that was
// sent stays sent — un-reached and re-reached included (Gary, MS-4a: "a
// milestone email that was sent stays sent — if the milestone is lost and
// re-reached, don't send again").
//
// GROUPED (ruling 1, Gary 2026-10-19: "one email per person per day, via a new
// grouping mode in the dispatcher"). The dispatcher hands renderGroup every
// milestone due for one recipient; this file never decides who gets what.
//
// RECIPIENTS (F6): every ADMIN, plus every MANAGER with a StoreUserAssignment
// to ANY of the member's StoreStaffAssignment stores — the /staff rule.
// Corporate staff (isCorporate): ADMINs only, decided BEFORE the manager arm is
// built. can("notify.milestone.receive") is the dispatcher's. Resolved at
// dispatch, never cached.
//
// NEVER THE EMPLOYEE (ruling 4, Gary: "excluded by linked account and by
// matching email") — `exclude`, read fresh at dispatch. That also covers a
// manager or admin about their own milestone.
//
// F7 — NO PAY, RATES, RAISE DATES OR AMOUNTS. The payload is built by the
// producer from the milestone row and the member's name and store, and no
// field here can carry anything else. scripts/verify-ms4b.ts asserts the
// rendered HTML and text.

import { prisma } from "@/lib/prisma"
import { renderEmail, type EmailRow } from "@/lib/email-template"
import { milestonesActive } from "@/lib/milestones-access"
import { defineNotification, type NotificationOrg } from "../define"

export const MILESTONE_KIND = "milestone.reached"

/**
 * N2 (Gary, 2026-10-19): "freshness backstop is 8 days (11,520 minutes), so my
 * ruling "more than 7 days ago is recorded as known and never sent" stays
 * exactly as worded." eventAt is the store-local MIDNIGHT of the reach date,
 * and the cron runs at 15:00 UTC, so a 7-day window would expire a milestone
 * reached exactly 7 days ago in the very run that should send it. The PRODUCER
 * is the 7-day judge, on store-local days; this is the backstop.
 */
export const MILESTONE_FRESHNESS_MINUTES = 8 * 24 * 60

export type MilestonePayload = {
  staffMemberId: string
  staffName: string
  /** The member's primary store's name, else their first store; null for none. */
  storeName: string | null
  milestoneKind: "tenure" | "checklist"
  milestoneId: string
  title: string
  /** "1 year", "90 days", "250 tasks". */
  thresholdLabel: string
  recognition: string
  employeeMessage: string
  /** Store-local "YYYY-MM-DD" — the day it was reached, never "today" (ruling 2). */
  reachedOn: string
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://www.usefroot.com"
}

/** The rows for one milestone. The suggested message is copied as written (MS-4a F8). */
function milestoneRows(p: MilestonePayload, base: string): EmailRow[] {
  const rows: EmailRow[] = [
    {
      label: `${p.staffName} — ${p.storeName ?? "No store"}`,
      value: `${p.title} (${p.thresholdLabel}), reached ${p.reachedOn}`,
      url: `${base}/staff/${encodeURIComponent(p.staffMemberId)}?tab=milestones`,
    },
  ]
  if (p.recognition.trim()) rows.push({ label: "Recognition", value: p.recognition })
  if (p.employeeMessage.trim()) rows.push({ label: "Suggested message", value: p.employeeMessage })
  return rows
}

export function renderMilestoneSummary(payloads: MilestonePayload[], org: Pick<NotificationOrg, "name">) {
  const base = appUrl()
  const one = payloads.length === 1 ? payloads[0] : null
  const subject = one ? `${one.staffName} reached ${one.title}` : `${payloads.length} new staff milestones`
  const heading = one
    ? `${one.staffName} reached a milestone: ${one.title}.`
    : `${payloads.length} people in your stores reached a milestone.`
  const { html, text } = renderEmail({
    orgName: org.name,
    heading,
    intro: "Open a person's Milestones tab to see the full message and copy it.",
    rows: payloads.flatMap((p) => milestoneRows(p, base)),
    cta: { label: "Open staff milestones", url: `${base}/staff/milestones` },
    footer: `You get at most one milestone email a day. Sent by USE Froot on behalf of ${org.name}. This address does not accept replies.`,
    appUrl: base,
  })
  return { subject, text, html }
}

export const milestoneKind = defineNotification<MilestonePayload>({
  kind: MILESTONE_KIND,
  label: "Milestone reached",
  roleDefault: { summary: "Every admin, and the managers of the employee's stores.", usersLink: true },
  // NOTIFY-12 F11 (Gary, 2026-10-23: "no extras on milestone emails"). The
  // store-scoped boundary above stays the whole recipient list; picks for this
  // kind are never read.
  extras: false,
  capability: "notify.milestone.receive",
  // F10 org switch AND Milestones itself on; a checklist milestone also needs
  // F13's switch, so turning it off expires queued checklist intents only.
  enabled: (org, intent) =>
    org.milestoneAlertsEnabled &&
    milestonesActive(org) &&
    (intent.payload.milestoneKind !== "checklist" || org.checklistMilestonesEnabled),
  freshnessMinutes: MILESTONE_FRESHNESS_MINUTES,
  batch: "per-recipient-daily",

  async resolveRecipients(intent) {
    const p = intent.payload
    const member = await prisma.staffMember.findFirst({
      where: { id: p.staffMemberId, organizationId: intent.organizationId },
      select: { status: true, isCorporate: true, milestoneEligible: true, storeAssignments: { select: { storeId: true } } },
    })
    // F9 at dispatch: a member terminated, or a milestone archived, since the
    // intent was queued gets no email. The intent waits and expires.
    // MS-6 R2: likewise a member switched out of Milestones after queueing.
    if (!member || member.status !== "ACTIVE" || !member.milestoneEligible) return []
    const milestone =
      p.milestoneKind === "tenure"
        ? await prisma.tenureMilestone.findFirst({
            where: { id: p.milestoneId, organizationId: intent.organizationId },
            select: { isArchived: true },
          })
        : await prisma.checklistMilestone.findFirst({
            where: { id: p.milestoneId, organizationId: intent.organizationId },
            select: { isArchived: true },
          })
    if (!milestone || milestone.isArchived) return []

    const storeIds = member.storeAssignments.map((a) => a.storeId)
    // Corporate → ADMINs only, decided here, before any manager arm exists.
    const managerArm =
      !member.isCorporate && storeIds.length > 0
        ? [{ role: "MANAGER" as const, storeAssignments: { some: { storeId: { in: storeIds } } } }]
        : []
    const users = await prisma.user.findMany({
      where: { organizationId: intent.organizationId, OR: [{ role: "ADMIN" }, ...managerArm] },
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

  // Ruling 4: by linked account AND by matching email, read now. One small
  // query per (intent, recipient) — fine at current size.
  async exclude(intent, recipient) {
    const member = await prisma.staffMember.findFirst({
      where: { id: intent.payload.staffMemberId, organizationId: intent.organizationId },
      select: { userId: true, email: true },
    })
    if (!member) return true
    if (member.userId && recipient.user?.id === member.userId) return true
    const own = member.email?.trim().toLowerCase()
    return !!own && own === recipient.email.trim().toLowerCase()
  },

  renderGroup(payloads, org) {
    return renderMilestoneSummary(payloads, org)
  },

  // Fictional people only — a sample must never name a real employee.
  sample: () => [
    {
      staffMemberId: "sample-1",
      staffName: "Sample Person",
      storeName: "Sample Store",
      milestoneKind: "tenure",
      milestoneId: "sample-tenure",
      title: "One year with us",
      thresholdLabel: "1 year",
      recognition: "A card from the team and a shout-out at the next meeting.",
      employeeMessage: "Happy one year! Thank you for everything you do.",
      reachedOn: "2026-01-15",
    },
    {
      staffMemberId: "sample-2",
      staffName: "Another Sample",
      storeName: "Sample Store",
      milestoneKind: "checklist",
      milestoneId: "sample-checklist",
      title: "250 tasks",
      thresholdLabel: "250 tasks",
      recognition: "Pick the playlist for a shift.",
      employeeMessage: "250 tasks done — that is a lot of opening and closing. Thank you!",
      reachedOn: "2026-01-15",
    },
  ],
})
