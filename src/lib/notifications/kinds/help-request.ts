// ─── TAB-16: kind "help.request" — the Ask-a-manager email (design C2) ───────
// Rulings: docs/DECISIONS.md 2026-11-12 TAB-16 (Gary). The producer is
// POST /api/stores/[id]/help-requests, which posts the TeamMessage FIRST (R1),
// then enqueues one intent (dedupeKey = the message id) and dispatches it
// INLINE so the sheet can say what happened (R9, R10).
//
// RECIPIENTS (R2, R3). The role default is the store's managers — every MANAGER
// login assigned to the store (src/lib/help-requests.ts storeManagers), always.
// Then the contacts THIS REQUEST ticked, re-read at send time and kept only if
// still active. `extras: true` is what lets an admin pick the kind's default
// contacts on /settings/notifications (NOTIFY-12's picker), but the dispatcher
// appends EVERY active pick to a kind with extras — so `exclude` drops any
// picked contact the team member unticked (R3: "anyone unticked doesn't get
// the email"). The dispatcher is unchanged by that.
//
// NO RETRY (R9). `noRetry` settles a live send that missed anyone as `failed`
// at once. Freshness is an hour: a sandbox or dry-run intent stays queued by
// design (NOTIFY-5) and expires then; the sweep never sends sandbox (R2 of
// NOTIFY-11) and logs a dry run only once.
//
// IDS IN THE PAYLOAD, TEXT AT SEND TIME (the NOTIFY-4 rider): `hydrate` reads
// the message, store, task, checklist and asker. The test kind renders a fixed
// fictional view through renderHelpRequest() for "Send a test help request".

import { prisma } from "@/lib/prisma"
import { renderEmail, type EmailRow } from "@/lib/email-template"
import { HELP_REQUEST_KIND, NOT_LISTED_NAME, helpReasonLabel } from "@/lib/help-request-shared"
import { storeManagers } from "@/lib/help-requests"
import { safeVideoUrl } from "@/lib/task-video-url"
import { defineNotification, type ResolvedRecipient } from "../define"

/** Everything the email shows, all text. Built by hydrate, or by the test sample. */
export type HelpRequestView = {
  storeName: string
  timeZone: string
  checklistName: string
  checklistId: string | null
  taskLabel: string
  askerName: string
  reason: string | null
  note: string | null
  /** ISO instant the request posted. */
  askedAt: string
  training: { label: string; kind: string }[]
}

export type HelpRequestPayload = {
  messageId: string
  storeId: string
  /** The contacts this request ticked (R3). Re-checked active at send time. */
  contactIds: string[]
  /** Filled by hydrate at send time; never stored. */
  view?: HelpRequestView
}

/** R8 subject. A long task description is cut at 80 characters so the line stays a subject. */
export function helpRequestSubject(v: Pick<HelpRequestView, "storeName" | "taskLabel">): string {
  const task = v.taskLabel.trim().replace(/\s+/g, " ")
  const short = task.length > 80 ? `${task.slice(0, 79).trimEnd()}…` : task
  return `Help needed at ${v.storeName}: ${short}`
}

/** "Thursday, November 12 · 9:44 AM" in the store's zone (R8: "the time in the store's time zone"). */
export function askedAtText(iso: string, timeZone: string): string {
  const d = new Date(iso)
  const day = d.toLocaleDateString("en-US", { timeZone, weekday: "long", month: "long", day: "numeric" })
  const time = d.toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" })
  return `${day} · ${time}`
}

function article(word: string): string {
  return /^[aeiou]/i.test(word.trim()) ? "an" : "a"
}

/** Pure: the view in, one email out. Shared by the real send and the test sample. */
export function renderHelpRequest(v: HelpRequestView, orgName: string) {
  const subject = helpRequestSubject(v)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
  const checklistWord = v.checklistName.trim().toLowerCase()
  const heading = `${v.askerName} needs a hand with ${article(checklistWord)} ${checklistWord} task`

  const rows: EmailRow[] = [
    { label: "Store", value: v.storeName },
    { label: "Checklist", value: v.checklistName },
    { label: "Task", value: v.taskLabel },
    { label: "Asked by", value: v.askerName },
    { label: "Asked", value: askedAtText(v.askedAt, v.timeZone) },
  ]
  const sections: { heading: string; rows: EmailRow[] }[] = []
  const going: EmailRow[] = []
  if (v.reason) going.push({ label: "Reason", value: v.reason })
  if (v.note) going.push({ label: "Note", value: v.note })
  if (going.length) sections.push({ heading: "What's going on", rows: going })
  if (v.training.length) {
    sections.push({ heading: "Training they had", rows: v.training.map((t) => ({ label: t.kind, value: t.label })) })
  }

  const link = (path: string) => (appUrl ? new URL(path, appUrl).toString() : undefined)
  const messagesUrl = link("/messages")
  const checklistUrl = v.checklistId ? link(`/store-view/checklist/${v.checklistId}`) : undefined
  const settingsUrl = link("/settings/notifications")
  // The prompt's step 5 wording, then the link.
  const footer = "You're getting this because you're on the Help request emails list. Change who gets these in"

  const { html, text } = renderEmail({
    orgName,
    heading,
    intro: "",
    rows,
    sections,
    cta: messagesUrl ? { label: "Reply in Messages", url: messagesUrl } : undefined,
    secondaryCta: checklistUrl ? { label: "Open the checklist", url: checklistUrl } : undefined,
    footer: settingsUrl ? footer : `${footer} Settings › Email Notification Settings.`,
    footerLink: settingsUrl ? { label: "Settings › Email Notification Settings", url: settingsUrl } : undefined,
    appUrl,
  })
  return { subject, text, html }
}

/** The contacts this request ticked that are still active, lower-cased. */
async function chosenContactEmails(organizationId: string, contactIds: string[]): Promise<string[]> {
  if (contactIds.length === 0) return []
  const rows = await prisma.notificationContact.findMany({
    where: { id: { in: contactIds }, organizationId, archivedAt: null },
    select: { email: true },
  })
  return rows.map((r) => r.email.trim().toLowerCase()).filter(Boolean)
}

export const helpRequestKind = defineNotification<HelpRequestPayload>({
  kind: HELP_REQUEST_KIND,
  label: "Help request",
  roleDefault: {
    summary: "The managers of the store that asked (everyone with the Manager role there), always.",
    usersLink: false,
  },
  extras: true,
  noRetry: true,
  enabled: (org) => org.kindSettings?.[HELP_REQUEST_KIND]?.enabled === true,
  freshnessMinutes: 60,
  batch: "per-intent",

  async resolveRecipients(intent) {
    const { organizationId, payload } = intent
    const managers = await storeManagers(organizationId, payload.storeId)
    const out: ResolvedRecipient[] = managers.map((u) => ({
      email: u.email,
      user: {
        id: u.id,
        role: u.role,
        deniedCapabilities: u.deniedCapabilities,
        grantedCapabilities: u.grantedCapabilities,
      },
    }))
    for (const email of await chosenContactEmails(organizationId, payload.contactIds)) {
      out.push({ email, reasons: ["extra-contact"] })
    }
    return out
  },

  // R3: a default contact the team member unticked arrives here through the
  // dispatcher's extras merge, and is dropped. Managers (reason "role") and the
  // contacts this request ticked are kept.
  async exclude(intent, r) {
    if (!(r.reasons ?? []).includes("extra-contact")) return false
    const chosen = await chosenContactEmails(intent.organizationId, intent.payload.contactIds)
    return !chosen.includes(r.email.trim().toLowerCase())
  },

  async hydrate(p, org) {
    const m = await prisma.teamMessage.findFirst({
      where: { id: p.messageId, organizationId: org.id },
      select: {
        body: true,
        helpReason: true,
        createdAt: true,
        sourceChecklistId: true,
        store: { select: { name: true, timezone: true } },
        authorStaff: { select: { displayName: true } },
        sourceChecklist: { select: { template: { select: { name: true } } } },
        task: {
          select: {
            description: true,
            videoUrl: true,
            attachment: { select: { label: true, contentType: true } },
          },
        },
      },
    })
    if (!m) throw new Error(`help request message ${p.messageId} not found`)
    const training: HelpRequestView["training"] = []
    // CHK-20: listed only when the task screen would actually show the video.
    if (safeVideoUrl(m.task?.videoUrl)) training.push({ label: "Training video", kind: "Video" })
    if (m.task?.attachment) {
      const ct = m.task.attachment.contentType
      training.push({ label: m.task.attachment.label, kind: ct === "application/pdf" ? "PDF" : ct.startsWith("image/") ? "Image" : "Document" })
    }
    const view: HelpRequestView = {
      storeName: m.store.name,
      timeZone: m.store.timezone,
      checklistName: m.sourceChecklist?.template.name ?? "Checklist",
      checklistId: m.sourceChecklistId,
      taskLabel: m.task?.description ?? "A checklist task",
      askerName: m.authorStaff?.displayName ?? NOT_LISTED_NAME,
      reason: helpReasonLabel(m.helpReason),
      note: m.body.trim() || null,
      askedAt: m.createdAt.toISOString(),
      training,
    }
    return { ...p, view }
  },

  render(p, org) {
    if (!p.view) return { subject: "Help needed", error: "help request was not hydrated" }
    return renderHelpRequest(p.view, org.name)
  },
})

/** Fixed and fictional (never a real person) — "Send a test help request" (C1). */
export function helpRequestSample(timeZone: string): HelpRequestView {
  return {
    storeName: "Sample Store",
    timeZone,
    checklistName: "Opener",
    checklistId: null,
    taskLabel: "Turn on Menu displays. See video for instructions.",
    askerName: "Sample Team Member",
    reason: "Watched it, still stuck",
    note: "This is a test help request. Nobody at a store sent it.",
    askedAt: new Date().toISOString(),
    training: [
      { label: "Training video", kind: "Video" },
      { label: "Menu display quick guide", kind: "PDF" },
    ],
  }
}
