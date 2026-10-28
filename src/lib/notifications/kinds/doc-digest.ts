// ─── NOTIFY-14: kind "hr.doc.digest" — overdue & due-soon document digest ────
// docs/prompts/NOTIFY-DOC-DIGEST_AUDIT.md; rulings F1–F17 in docs/DECISIONS.md
// 2026-10-27 (Gary). The producer is src/lib/doc-digest-alerts.ts, called by
// the hourly scheduled-emails runner on the org's slot.
//
// ONE INTENT PER ORG PER PERIOD (F1, F11). dedupeKey "{orgId}:{periodKey}" —
// "2026-W45" weekly, "2026-11-02" daily — so a second run in the period finds
// the intent already sent and mails nobody. The payload is a SNAPSHOT built by
// the producer:
//   views   one DocDigestView per distinct scope ("all", or one manager's
//           stores) — each from the same rollup call /hr/compliance makes
//   scopes  lower-cased address → view key, for every role recipient and every
//           active "Also send to" contact (contacts → "all", F8)
//
// EACH PERSON SEES ONLY THEIR OWN SCOPE, AND THE MAP FAILS CLOSED. `exclude`
// drops any address with no entry — a manager added after the snapshot gets
// nothing rather than a default — and any whose view is empty (draft ruling
// 4), with a named skip line. `render` reads the view by address. Everything
// else — mode, sandbox, can(), the "sent" lock, the log rows (draft 9) — is the
// dispatcher's, unchanged.
//
// STORE-LOGIN CONTACTS DROP OUT WITH NO CODE HERE (F8): a contact whose
// address is a STORE login is resolved as that login (NOTIFY-12 F9), and
// can("notify.docdue.receive") is false for STORE.

import { prisma } from "@/lib/prisma"
import { hrModuleAvailable } from "@/lib/auth"
import { renderEmail } from "@/lib/email-template"
import { formatCivilDate } from "@/lib/display-time"
import { DEFAULT_TIME_ZONE } from "@/lib/hr"
import type { DocDigestView } from "@/lib/hr-doc-digest"
import { digestIsEmpty } from "@/lib/hr-doc-digest"
import { defineNotification, type NotificationOrg, type Rendered, type ScheduleFrequency } from "../define"

export const DOC_DIGEST_KIND = "hr.doc.digest"

/** The view key every admin and contact reads. */
export const ALL_VIEW = "all"

export type DocDigestPayload = {
  /** The schedule-zone local date the snapshot was taken, "YYYY-MM-DD". */
  asOf: string
  frequency: ScheduleFrequency
  views: Record<string, DocDigestView>
  scopes: Record<string, string>
}

/** F10 (Gary, 2026-10-27: "agreed"): HR available here AND active for the org. */
export function docDigestHrActive(org: Pick<NotificationOrg, "clerkOrgId" | "activeModules">): boolean {
  return hrModuleAvailable(org.clerkOrgId) && org.activeModules.includes("hr")
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** F14: "{Org}: {X} overdue, {Y} due soon — documents to sign"; a zero part is left out. */
export function docDigestSubject(orgName: string, view: DocDigestView): string {
  const parts = [
    ...(view.overdue > 0 ? [`${view.overdue} overdue`] : []),
    ...(view.dueSoon > 0 ? [`${view.dueSoon} due soon`] : []),
  ]
  return `${orgName}: ${parts.join(", ")} — documents to sign`
}

/** F16 footer; the cadence word follows the schedule (NOTIFY-13 F13). */
export function docDigestFooter(orgName: string, frequency: ScheduleFrequency): string {
  return (
    `You get this digest at most once a ${frequency === "daily" ? "day" : "week"}. ` +
    `An admin can turn it off for you in Users. ` +
    `Sent by USE Froot on behalf of ${orgName}. This address does not accept replies.`
  )
}

/**
 * The card's description on /settings/notifications, ONE string (NOTIFY-13a:
 * an `{expression} text` JSX join dropped its space). Follows the saved
 * frequency; no row reads as the weekly default (F2).
 */
export function docDigestCardText(frequency: ScheduleFrequency | undefined): string {
  const cadence = frequency === "daily" ? "At most one email a day" : "One email a week"
  return `${cadence} to admins and managers listing documents overdue or due within 3 days. Managers see only their assigned stores; admins see every store.`
}

/**
 * Pure: one viewer's digest in, one email out. Shared by the real kind and the
 * "Send a preview to me" path (F9, kinds/test.ts), so a preview is the real
 * email with "Test — " in front of its subject.
 */
export function renderDocDigest(view: DocDigestView, orgName: string, asOf: string, frequency: ScheduleFrequency): Rendered {
  const total = view.overdue + view.dueSoon
  const subject = docDigestSubject(orgName, view)
  if (total === 0) return { subject, error: "empty digest" }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.usefroot.com"
  const heading = `${total} ${plural(total, "document is", "documents are")} overdue or due within 3 days.`
  const intro = `As of ${formatCivilDate(`${asOf}T00:00:00.000Z`, "weekdayMonthDay")}. Each line is a document someone still needs to sign.`
  const footer = docDigestFooter(orgName, frequency)
  const sections = view.groups.map((g) => ({
    heading: g.name,
    rows: g.lines.map((l) => ({ label: l.staffName, value: `${l.title} — ${l.label}` })),
  }))

  const text = [
    heading,
    ``,
    intro,
    ...sections.flatMap((s) => [``, s.heading.toUpperCase(), ...s.rows.map((r) => `${r.label}: ${r.value}`)]),
    ``,
    `Open compliance: ${appUrl}/hr/compliance`,
    ``,
    footer,
  ].join("\n")

  const { html } = renderEmail({
    orgName,
    heading,
    intro,
    rows: [],
    sections,
    cta: { label: "Open compliance", url: `${appUrl}/hr/compliance` },
    footer,
    appUrl,
    text,
  })
  return { subject, text, html }
}

export const docDigestKind = defineNotification<DocDigestPayload>({
  kind: DOC_DIGEST_KIND,
  label: "Document due-date digest",
  roleDefault: { summary: "Every admin, for every store; each manager, for their assigned stores.", usersLink: true },
  // F8: contacts allowed; the producer maps each to the org-wide view.
  extras: true,
  capability: "notify.docdue.receive",
  enabled: (org) => org.docDigestEnabled && docDigestHrActive(org),
  // F2, F3 (Gary, 2026-10-27: "Agreed."). One slot per org in the row's own
  // zone. With no saved row: weekly, Monday, 8 AM Pacific — legacyUtcHour is
  // never read for this kind.
  schedule: {
    scope: "org",
    frequencies: ["daily", "weekly"],
    monthly: "day-of-month",
    hours: { min: 5, max: 20 },
    legacyUtcHour: 15,
    defaultRow: { frequency: "weekly", sendHour: 8, daysOfWeek: [1], dayOfMonth: null, timeZone: DEFAULT_TIME_ZONE },
    defaultText: "Default: every Monday at 8 AM Pacific time.",
  },
  // F11: a retry may finish a send for 12 hours; after that the snapshot is
  // stale and the next period will carry anyone still unsigned.
  freshnessMinutes: 12 * 60,
  batch: "per-intent",

  // Every ADMIN and every MANAGER in the org. What each one SEES is the
  // payload's scope map; can() is the dispatcher's.
  async resolveRecipients(intent) {
    const users = await prisma.user.findMany({
      where: { organizationId: intent.organizationId, role: { in: ["ADMIN", "MANAGER"] } },
      select: { id: true, email: true, role: true, deniedCapabilities: true, grantedCapabilities: true },
    })
    return users
      .filter((u) => !!u.email)
      .map((u) => ({
        email: u.email,
        user: { id: u.id, role: u.role, deniedCapabilities: u.deniedCapabilities, grantedCapabilities: u.grantedCapabilities },
      }))
  },

  exclude(intent, r) {
    const key = r.email.trim().toLowerCase()
    const viewKey = intent.payload.scopes[key]
    const who = r.user ? `user=${r.user.id}` : "contact"
    if (!viewKey) {
      console.log(`[doc-digest] skip org=${intent.organizationId} intent=${intent.id} ${who} reason=not-in-snapshot`)
      return true
    }
    if (digestIsEmpty(intent.payload.views[viewKey])) {
      console.log(`[doc-digest] skip org=${intent.organizationId} intent=${intent.id} ${who} reason=empty`)
      return true
    }
    return false
  },

  render(p, org, to) {
    const view = p.views[p.scopes[to.trim().toLowerCase()] ?? ""]
    if (!view) return { subject: `${org.name}: documents to sign`, error: "no view for this recipient" }
    return renderDocDigest(view, org.name, p.asOf, p.frequency)
  },
})
