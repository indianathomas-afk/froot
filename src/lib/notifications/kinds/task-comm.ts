// ─── NOTIFY-4: kind "tasks.comm.recap" — the Tasks and Communication email ───
// docs/prompts/NOTIFY-TASKCOMM.md (prompt of record), NOTIFY-TASKCOMM_AUDIT.md;
// rulings F0–F11 and the riders in docs/DECISIONS.md (Gary, 2026-11-06). The
// producer is src/lib/task-comm-alerts.ts, called by the hourly scheduled-emails
// runner on the org's slot. The shape is the document digest's (NOTIFY-14):
// one intent per org per REPORTED period, a payload with one view per distinct
// scope, a scope map by address that FAILS CLOSED.
//
// IDS, NOT TEXT (rider, Gary: "Store message ids, not text, and look the text
// up at send time."). The stored payload holds message ids, corporate-update
// ids, counts and store names — never a message body or an update's text.
// `hydrate` reads the text once per dispatch, at send time: a message deleted
// since the snapshot drops out, an edited one shows its current text, and a
// ticket's Open/Resolved is its state when the email leaves.
//
// WHO SEES WHAT (F3, Gary: "Admins see all stores, managers see their assigned
// stores." Rider: "A contact matching a user gets that user's own view, never
// wider."). The producer builds the map; this file only reads it. Sections:
//   (a) team messages     — the view's stores, if the viewer holds messages.use
//   (b) corporate updates — the ids the view could see in the app
//   (c) did not attempt   — the view's stores
//   (d) store performance — the view's stores, if the viewer holds reports.view

import type { Role } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { renderEmail, type EmailRow } from "@/lib/email-template"
import { formatCivilDate, formatInstant } from "@/lib/display-time"
import { DEFAULT_TIME_ZONE } from "@/lib/hr"
import { defineNotification, type KindSettings, type NotificationOrg, type Rendered, type ScheduleFrequency } from "../define"

export const TASK_COMM_KIND = "tasks.comm.recap"
export const TASK_COMM_LABEL = "Tasks and Communication"

/** F5 (Gary's text). Used whenever the saved subject is null or blank. */
export const TASK_COMM_DEFAULT_SUBJECT = "Store communication and operational tasks update!"
/** F5 (Gary's text, typos fixed). Used whenever the saved body is null or blank. */
export const TASK_COMM_DEFAULT_BODY =
  "Team communication and task completion are vital to strong employee morale, teamwork, and the overall customer experience. " +
  "This email is designed to encourage, promote, and recap how effectively your team is working together. " +
  "If you have questions, please don't hesitate to reach out."
export const TASK_COMM_SUBJECT_MAX = 120
export const TASK_COMM_BODY_MAX = 1000
/** F9 (Gary): "Flag stores below 90% completion; … integer 50–100, default 90." */
export const TASK_COMM_DEFAULT_THRESHOLD = 90
export const TASK_COMM_THRESHOLD_MIN = 50
export const TASK_COMM_THRESHOLD_MAX = 100
/** F6: itemised lines per email before "and N more". */
export const TASK_COMM_LINE_CAP = 300
/** F6: an itemised message body is cut at this many characters. */
export const TASK_COMM_BODY_TRUNCATE = 200

// ── F6 categories, in the ruled order ───────────────────────────────────────
export const TASK_COMM_CATEGORIES = [
  "openers",
  "mid",
  "closers",
  "shift",
  "equipment",
  "shortage",
  "staffing",
  "feedback",
  "shoutouts",
  "general",
] as const
export type TaskCommCategory = (typeof TASK_COMM_CATEGORIES)[number]

export const TASK_COMM_CATEGORY_LABEL: Record<TaskCommCategory, string> = {
  openers: "Openers",
  mid: "Mid",
  closers: "Closers",
  shift: "Shift notes",
  equipment: "Equipment",
  shortage: "Shortage",
  staffing: "Staffing",
  feedback: "Customer feedback",
  shoutouts: "Shoutouts",
  general: "General",
}

/** TeamMessage (type, shiftPhase) → F6 category. Unknown types fall to General. */
export function messageCategory(type: string, shiftPhase: string | null): TaskCommCategory {
  if (type === "shift_note") {
    if (shiftPhase === "opening") return "openers"
    if (shiftPhase === "mid") return "mid"
    if (shiftPhase === "closing") return "closers"
    return "shift"
  }
  if (type === "equipment") return "equipment"
  if (type === "shortage") return "shortage"
  if (type === "staffing") return "staffing"
  if (type === "customer_feedback") return "feedback"
  if (type === "shoutout") return "shoutouts"
  return "general"
}

/**
 * Author label (Gary, 2026-11-06, superseding the first rider's wording):
 * "the staff first name; if there is no staff record, the user’s first name;
 * only if neither exists, “Team member”. Never part of an email address."
 *
 * First word of the staff member's displayName; else first word of the
 * User's NAME. A word containing "@" is treated as absent (a name field that
 * holds an email address must not leak one). The User's email column is never
 * read here.
 */
export function authorFirstName(staffDisplayName: string | null | undefined, userName?: string | null): string {
  const firstWord = (v: string | null | undefined) => {
    const w = (v ?? "").trim().split(/\s+/)[0] ?? ""
    return w && !w.includes("@") ? w : ""
  }
  return firstWord(staffDisplayName) || firstWord(userName) || "Team member"
}

// ── The payload ─────────────────────────────────────────────────────────────

export type TaskCommStore = {
  name: string
  timezone: string
  /** The store's REPORTED period, store-local dates, inclusive (F4). */
  from: string
  to: string
}

export type TaskCommPerf = {
  total: number
  completed: number
  missed: number
  completedLate: number
  /** completionPct() of the operations report; null with nothing tracked. */
  pct: number | null
  /** pct !== null && pct < thresholdPct, decided at the snapshot. */
  below: boolean
}

export type TaskCommView = {
  /** The view's stores, in name order. */
  storeIds: string[]
  /** Section (a): the viewer holds messages.use. */
  messages: boolean
  /** Section (d): the viewer holds reports.view. */
  reports: boolean
  /** Section (b): corporate updates this viewer could see in the app. */
  corporateIds: string[]
}

export type TaskCommLookup = {
  messages: Record<
    string,
    {
      storeId: string
      category: TaskCommCategory
      status: string
      body: string
      createdAt: string
      author: string
      attachments: number
    }
  >
  corporate: Record<string, { title: string; publishedAt: string; firstLine: string }>
}

export type TaskCommPayload = {
  frequency: ScheduleFrequency
  /** The REPORTED period's key (not the send date's): "2026-11-05", "2026-W45", "2026-10". */
  periodKey: string
  /** "Thu, Nov 5" / "Week of Nov 2 – Nov 8" / "October 2026". */
  periodLabel: string
  thresholdPct: number
  stores: Record<string, TaskCommStore>
  /** Every message id in each store's period, oldest first. Ids only. */
  messageIdsByStore: Record<string, string[]>
  /**
   * Weekly and monthly only (empty for daily). Every equipment and shortage
   * ticket OPEN at the snapshot in each store, WHENEVER it was created (Gary,
   * 2026-11-06: "list every equipment and shortage ticket still open at send
   * time, in the recipient’s stores, no matter when it was created. An ice
   * machine broken for three weeks must show."). Re-checked at send time:
   * one resolved or deleted since drops out.
   */
  openTicketIdsByStore: Record<string, string[]>
  /** Store-local dates each store did not attempt any Daily checklist (F8). */
  notAttempted: Record<string, string[]>
  /**
   * NOTIFY-4-POLISH fix 1: per store, how many store-local days in its period
   * had at least one Daily checklist due (the same Daily rows section (c)
   * reads). A store with none is absent. OPTIONAL: a payload enqueued before
   * this field existed has none, and renders the "with daily checklists due"
   * wording, which is true either way (Gary, 2026-11-06).
   */
  dailyDueDays?: Record<string, number>
  /** Operations-report figures per store over its period (F9). */
  performance: Record<string, TaskCommPerf>
  views: Record<string, TaskCommView>
  /** lower-cased address → view key. An address with no entry gets nothing. */
  scopes: Record<string, string>
  /** Filled by hydrate at send time; NEVER stored. */
  lookup?: TaskCommLookup
}

export function taskCommSettings(org: Pick<NotificationOrg, "kindSettings">): KindSettings | undefined {
  return org.kindSettings?.[TASK_COMM_KIND]
}

export function taskCommSubject(settings: KindSettings | undefined): string {
  return settings?.subject?.trim() || TASK_COMM_DEFAULT_SUBJECT
}

export function taskCommBody(settings: KindSettings | undefined): string {
  return settings?.body?.trim() || TASK_COMM_DEFAULT_BODY
}

/** The card's description on /settings/notifications. One string (NOTIFY-13a). */
export function taskCommCardText(frequency: ScheduleFrequency | undefined): string {
  const cadence = frequency === "weekly" ? "One email a week" : frequency === "monthly" ? "One email a month" : "One email a day"
  return `${cadence} to admins and managers recapping the last period's team messages, corporate updates, daily checklists nobody started, and each store's checklist completion. Managers see only their assigned stores; admins see every store.`
}

function footerText(orgName: string, frequency: ScheduleFrequency): string {
  const unit = frequency === "weekly" ? "week" : frequency === "monthly" ? "month" : "day"
  return (
    `You get this email at most once a ${unit}. An admin can turn it off for you in Users. ` +
    `Sent by USE Froot on behalf of ${orgName}. This address does not accept replies.`
  )
}

function truncate(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim()
  return one.length > n ? `${one.slice(0, n - 1).trimEnd()}…` : one
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/**
 * Pure: one viewer's view, the hydrated payload and the settings in, one email
 * out. Shared by the real kind and "Send a preview to me" (F11), so a preview
 * is the real email with "Test — " in front of its subject.
 */
export function renderTaskComm(
  p: TaskCommPayload,
  view: TaskCommView,
  orgName: string,
  settings: KindSettings | undefined
): Rendered {
  const subject = taskCommSubject(settings)
  if (!p.lookup) return { subject, error: "message text was not looked up" }
  const lookup = p.lookup
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.usefroot.com"
  const daily = p.frequency === "daily"
  const storeName = (id: string) => p.stores[id]?.name ?? "Unknown store"
  const sections: { heading: string; rows: EmailRow[] }[] = []
  let lines = 0
  let overflow = 0
  const push = (rows: EmailRow[], row: EmailRow) => {
    if (lines >= TASK_COMM_LINE_CAP) {
      overflow++
      return
    }
    rows.push(row)
    lines++
  }

  // (a) TEAM MESSAGES — F6.
  if (view.messages) {
    const live = view.storeIds.flatMap((sid) =>
      (p.messageIdsByStore[sid] ?? []).flatMap((id) => (lookup.messages[id] ? [{ id, ...lookup.messages[id] }] : []))
    )
    if (live.length === 0) {
      sections.push({ heading: "Team messages", rows: [{ label: "Messages", value: "No messages posted" }] })
    }
    for (const sid of view.storeIds) {
      const mine = live.filter((m) => m.storeId === sid)
      if (mine.length === 0) continue
      const tz = p.stores[sid]?.timezone ?? DEFAULT_TIME_ZONE
      if (daily) {
        for (const cat of TASK_COMM_CATEGORIES) {
          const rows: EmailRow[] = []
          for (const m of mine.filter((x) => x.category === cat)) {
            const tags = [
              ...(m.status === "archived" ? ["[Archived]"] : []),
              ...((cat === "equipment" || cat === "shortage") && m.status !== "archived"
                ? [m.status === "resolved" ? "[Resolved]" : "[Open]"]
                : []),
            ]
            const extra = m.attachments > 0 ? ` (+${m.attachments} ${plural(m.attachments, "attachment", "attachments")})` : ""
            push(rows, {
              label: `${formatInstant(m.createdAt, tz, "monthDayTime")} · ${m.author}`,
              value: `${tags.length ? tags.join(" ") + " " : ""}${truncate(m.body, TASK_COMM_BODY_TRUNCATE)}${extra}`,
            })
          }
          if (rows.length) sections.push({ heading: `${storeName(sid)} — ${TASK_COMM_CATEGORY_LABEL[cat]}`, rows })
        }
      } else {
        const counts: EmailRow[] = []
        for (const cat of TASK_COMM_CATEGORIES) {
          const n = mine.filter((x) => x.category === cat).length
          if (n > 0) push(counts, { label: TASK_COMM_CATEGORY_LABEL[cat], value: `${n} ${plural(n, "message", "messages")}` })
        }
        const archived = mine.filter((x) => x.status === "archived").length
        if (archived > 0) push(counts, { label: "Archived", value: `${archived} of these ${plural(archived, "is", "are")} archived` })
        if (counts.length) sections.push({ heading: `${storeName(sid)} — messages`, rows: counts })
      }
    }
    // WEEKLY AND MONTHLY: every equipment and shortage ticket still open at
    // send time in the viewer's stores, whatever its age — so a store with no
    // messages this period still shows its three-week-old broken ice machine.
    if (!daily) {
      for (const sid of view.storeIds) {
        const tz = p.stores[sid]?.timezone ?? DEFAULT_TIME_ZONE
        const open: EmailRow[] = []
        for (const id of p.openTicketIdsByStore?.[sid] ?? []) {
          const m = lookup.messages[id]
          if (!m || m.storeId !== sid || m.status !== "open" || (m.category !== "equipment" && m.category !== "shortage")) continue
          push(open, {
            label: `${TASK_COMM_CATEGORY_LABEL[m.category]} · opened ${formatInstant(m.createdAt, tz, "monthDay")} · ${m.author}`,
            value: `[Open] ${truncate(m.body, TASK_COMM_BODY_TRUNCATE)}`,
          })
        }
        if (open.length) sections.push({ heading: `${storeName(sid)} — still open`, rows: open })
      }
    }
    if (overflow > 0) {
      sections.push({
        heading: "More messages",
        rows: [{ label: "More", value: `and ${overflow} more — open Messages`, url: `${appUrl}/messages` }],
      })
    }
  }

  // (b) CORPORATE COMMUNICATIONS — F7.
  const corp = view.corporateIds.flatMap((id) => (lookup.corporate[id] ? [lookup.corporate[id]] : []))
  sections.push({
    heading: "Corporate communications",
    rows: corp.length
      ? corp.map((c) => ({
          label: formatInstant(c.publishedAt, DEFAULT_TIME_ZONE, "monthDay"),
          value: c.firstLine ? `${c.title} — ${truncate(c.firstLine, TASK_COMM_BODY_TRUNCATE)}` : c.title,
          url: `${appUrl}/messages`,
        }))
      : [{ label: "Updates", value: "No corporate updates posted" }],
  })

  // (c) DID NOT ATTEMPT — F8, Gary's sentence for a single day.
  const dna: EmailRow[] = []
  for (const sid of view.storeIds) {
    for (const d of p.notAttempted[sid] ?? []) {
      dna.push({
        label: formatCivilDate(`${d}T00:00:00.000Z`, "weekdayMonthDay"),
        value: daily
          ? `${storeName(sid)} did not attempt any daily checklist for this day.`
          : `${storeName(sid)} did not attempt any daily checklist on this day.`,
      })
    }
  }
  // NOTIFY-4-POLISH fix 1 (Gary, 2026-11-06): no vacuous praise. Nothing due
  // in the view's stores → say so; some due and all started → name that.
  const noneDue = p.dailyDueDays !== undefined && !view.storeIds.some((sid) => (p.dailyDueDays?.[sid] ?? 0) > 0)
  sections.push({
    heading: "Daily checklists",
    rows: [
      ...(dna.length
        ? dna
        : [
            {
              label: "Checklists",
              value: noneDue ? "No daily checklists were due" : "Every store with daily checklists due started them",
            },
          ]),
      // F8 (Gary): "State on the email that holidays can be flagged".
      {
        label: "Note",
        value: "A store closed for a holiday or other one-off closure can be listed here — Froot does not yet record store closures by date.",
      },
    ],
  })

  // (d) STORE PERFORMANCE — F9, the operations report's definition.
  if (view.reports) {
    const perf = view.storeIds
      .map((sid) => ({ sid, f: p.performance[sid] }))
      .filter((x): x is { sid: string; f: TaskCommPerf } => !!x.f && x.f.total > 0)
      .sort((a, b) => Number(b.f.below) - Number(a.f.below) || storeName(a.sid).localeCompare(storeName(b.sid)))
    sections.push({
      heading: `Store performance — stores below ${p.thresholdPct}% completion first`,
      rows: perf.length
        ? perf.map(({ sid, f }) => ({
            label: f.below ? `${storeName(sid)} (below ${p.thresholdPct}%)` : storeName(sid),
            value: `${f.pct}% complete · ${f.completed} of ${f.total} completed · ${f.missed} missed · ${f.completedLate} late`,
          }))
        : [{ label: "Checklists", value: "No tracked daily checklists in this period" }],
    })
  }

  const heading = `Tasks and Communication — ${p.periodLabel}`
  const intro = taskCommBody(settings)
  const footer = footerText(orgName, p.frequency)
  const cta = view.reports
    ? { label: "Open the Operations Report", url: `${appUrl}/reports/operations` }
    : { label: "Open Messages", url: `${appUrl}/messages` }
  const { html, text } = renderEmail({ orgName, heading, intro, rows: [], sections, cta, footer, appUrl })
  return { subject, text, html }
}

/** The send-time lookup (rider). Exported so the preview path hydrates the same way. */
export async function hydrateTaskComm(p: TaskCommPayload, organizationId: string): Promise<TaskCommPayload> {
  const messageIds = [...new Set([...Object.values(p.messageIdsByStore).flat(), ...Object.values(p.openTicketIdsByStore ?? {}).flat()])]
  const corporateIds = [...new Set(Object.values(p.views).flatMap((v) => v.corporateIds))]
  const [msgs, corps] = await Promise.all([
    messageIds.length
      ? prisma.teamMessage.findMany({
          // deletedAt null AT SEND TIME: a message deleted since the snapshot drops out.
          where: { id: { in: messageIds }, organizationId, deletedAt: null },
          select: {
            id: true,
            storeId: true,
            type: true,
            shiftPhase: true,
            status: true,
            body: true,
            createdAt: true,
            authorStaff: { select: { displayName: true } },
            // The User's NAME only — never its email (author rule above).
            authorUser: { select: { name: true } },
            _count: { select: { attachments: true } },
          },
        })
      : [],
    corporateIds.length
      ? prisma.corporateUpdate.findMany({
          where: { id: { in: corporateIds }, organizationId, deletedAt: null, publishedAt: { not: null } },
          select: { id: true, title: true, body: true, publishedAt: true },
        })
      : [],
  ])
  const lookup: TaskCommLookup = { messages: {}, corporate: {} }
  for (const m of msgs) {
    lookup.messages[m.id] = {
      storeId: m.storeId,
      category: messageCategory(m.type, m.shiftPhase),
      status: m.status,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
      author: authorFirstName(m.authorStaff?.displayName, m.authorUser?.name),
      attachments: m._count.attachments,
    }
  }
  for (const c of corps) {
    lookup.corporate[c.id] = {
      title: c.title,
      publishedAt: c.publishedAt!.toISOString(),
      firstLine: c.body.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "",
    }
  }
  // Ordered as stored (oldest first) — the lookup is keyed, so order comes
  // from messageIdsByStore at render.
  return { ...p, lookup }
}

export const taskCommKind = defineNotification<TaskCommPayload>({
  kind: TASK_COMM_KIND,
  label: TASK_COMM_LABEL,
  roleDefault: { summary: "Admins and managers, as ticked above: admins for every store, managers for their assigned stores.", usersLink: true },
  // F2 (Gary): "A store with its own mailbox is added as a contact."
  extras: true,
  capability: "notify.taskcomm.receive",
  enabled: (org) => taskCommSettings(org)?.enabled ?? false,
  // F4 (Gary: "Approved. Default daily at 7 AM, 5 AM floor."). One slot per
  // org, in the row's own zone; with no saved row, every day at 7 AM Pacific.
  schedule: {
    scope: "org",
    frequencies: ["daily", "weekly", "monthly"],
    monthly: "day-of-month",
    hours: { min: 5, max: 20 },
    legacyUtcHour: 15,
    defaultRow: { frequency: "daily", sendHour: 7, daysOfWeek: [1, 2, 3, 4, 5, 6, 7], dayOfMonth: null, timeZone: DEFAULT_TIME_ZONE },
    defaultText: "Default: every day at 7 AM Pacific time.",
  },
  // The doc digest's window: a retry may finish a send for 12 hours.
  freshnessMinutes: 12 * 60,
  batch: "per-intent",

  // F2: the role boxes, read at dispatch. What each person SEES is the
  // payload's scope map; can() is the dispatcher's.
  async resolveRecipients(intent, org) {
    const s = taskCommSettings(org)
    const roles: Role[] = [...(s?.sendToAdmins ?? true ? (["ADMIN"] as const) : []), ...(s?.sendToManagers ?? true ? (["MANAGER"] as const) : [])]
    if (roles.length === 0) return []
    const users = await prisma.user.findMany({
      where: { organizationId: intent.organizationId, role: { in: roles } },
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
    if (!viewKey || !intent.payload.views[viewKey]) {
      console.log(`[task-comm] skip org=${intent.organizationId} intent=${intent.id} ${who} reason=not-in-snapshot`)
      return true
    }
    if (intent.payload.views[viewKey].storeIds.length === 0) {
      console.log(`[task-comm] skip org=${intent.organizationId} intent=${intent.id} ${who} reason=no-stores`)
      return true
    }
    return false
  },

  hydrate: (p, org) => hydrateTaskComm(p, org.id),

  render(p, org, to) {
    const view = p.views[p.scopes[to.trim().toLowerCase()] ?? ""]
    if (!view) return { subject: taskCommSubject(taskCommSettings(org)), error: "no view for this recipient" }
    return renderTaskComm(p, view, org.name, taskCommSettings(org))
  },
})
