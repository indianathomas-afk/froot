// ─── NOTIFY-4: the Tasks and Communication producer ──────────────────────────
// Called by the hourly runner (src/lib/scheduled-emails.ts) once the org's
// slot is due and claimed, and by the preview route (F11). Builds the snapshot
// the kind (src/lib/notifications/kinds/task-comm.ts) renders from, enqueues ONE
// intent for the REPORTED period and dispatches it inline. A PRODUCER NEVER
// SENDS — the dispatcher decides who hears and whether mail leaves (NOTIFY-6).
//
// THE REPORTED PERIOD IS NOT THE SEND DATE'S (audit A1). The schedule fires on
// a local date L; the email reports the period BEFORE it (F4, Gary: "Approved"):
//   daily    L − 1
//   weekly   the Monday–Sunday week before L's week
//   monthly  the calendar month before L's month
// Each store's period is taken from ITS OWN local date (Store.timezone); the
// dedupeKey carries the reported period's key in the schedule's zone, so the
// subject, the window and the send lock name one thing.
//
// THE SCOPE MAP (F3, rider — Gary, 2026-11-06):
//   ADMIN (role box on)    every active store
//   MANAGER (role box on)  their assigned active stores
//   contact = a Froot user that user's OWN view, never wider ("A contact
//                          matching a user gets that user's own view, never
//                          wider.") — the doc digest's F8 widening is NOT used
//   contact, no user       the org-wide view (F3, "Extra contacts get the
//                          org-wide (admin) version")
// Two entries for one address keep the NARROWER view. A view also records
// whether its viewer may see team messages (messages.use) and the store
// performance section (reports.view, ADMIN + MANAGER baseline) — the sections
// follow what the viewer can see in the app. A contact with no user sees both.
//
// IDS ONLY (rider). Nothing below puts a message body or an update's text in
// the payload; the kind's hydrate reads them at send time.

import type { Role } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import type { DeliveryMode, EmailSender } from "@/lib/notify"
import { dispatchNotifications, enqueueNotification } from "@/lib/notifications/dispatch"
import { resolveExtras } from "@/lib/notifications/picks"
import { isoWeekdayOf, isoWeekKey } from "@/lib/notifications/schedule"
import type { KindSettings, ScheduleFrequency } from "@/lib/notifications/define"
import { can, grantsFrom, overridesFrom } from "@/lib/permissions"
import { dbDate, localDateStr } from "@/lib/reports"
import { dayCloseAppliesTo, shiftDateStr, zonedInstant } from "@/lib/checklist-lifecycle"
import { formatCivilDate } from "@/lib/display-time"
import { DEFAULT_TIME_ZONE } from "@/lib/hr"
import { completionPct, computeOperationsReport } from "@/lib/operations-report"
import {
  TASK_COMM_DEFAULT_THRESHOLD,
  TASK_COMM_KIND,
  type TaskCommPayload,
  type TaskCommPerf,
  type TaskCommStore,
  type TaskCommView,
} from "@/lib/notifications/kinds/task-comm"

export type TaskCommOrgResult = {
  organizationId: string
  skipped?: "disabled" | "no-recipients"
  periodKey?: string
  views: number
  recipients: number
  intentState?: string
  sent: number
  failed: number
  dryRun: number
  error?: string
}

// ── Periods ──────────────────────────────────────────────────────────────────

export type ReportedPeriod = { from: string; to: string; key: string; label: string }

const civil = (d: string, style: "weekdayMonthDay" | "monthDay") => formatCivilDate(`${d}T00:00:00.000Z`, style)

/** The period BEFORE local date `localDate`, for `frequency` (A1, F4). Pure. */
export function reportedPeriod(frequency: ScheduleFrequency, localDate: string): ReportedPeriod {
  if (frequency === "daily") {
    const d = shiftDateStr(localDate, -1)
    return { from: d, to: d, key: d, label: civil(d, "weekdayMonthDay") }
  }
  if (frequency === "weekly") {
    const thisMonday = shiftDateStr(localDate, -(isoWeekdayOf(localDate) - 1))
    const from = shiftDateStr(thisMonday, -7)
    const to = shiftDateStr(from, 6)
    return { from, to, key: isoWeekKey(from), label: `Week of ${civil(from, "monthDay")} – ${civil(to, "monthDay")}` }
  }
  const to = shiftDateStr(`${localDate.slice(0, 7)}-01`, -1)
  const from = `${to.slice(0, 7)}-01`
  const label = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${from}T00:00:00.000Z`))
  return { from, to, key: to.slice(0, 7), label }
}

/** [start, end) instants of store-local dates from..to inclusive. */
function localWindow(from: string, to: string, timeZone: string): { gte: Date; lt: Date } {
  return {
    gte: zonedInstant(from, "00:00", timeZone) ?? dbDate(from),
    lt: zonedInstant(shiftDateStr(to, 1), "00:00", timeZone) ?? dbDate(shiftDateStr(to, 1)),
  }
}

// ── Scope ────────────────────────────────────────────────────────────────────

type ScopeUser = {
  role: string
  deniedCapabilities: string[]
  grantedCapabilities: string[]
  storeAssignments: { storeId: string }[]
}

type Scope = { all: boolean; storeIds: string[]; messages: boolean; reports: boolean }

function scopeOfUser(u: ScopeUser, activeStoreIds: Set<string>): Scope {
  const actor = { role: u.role, overrides: overridesFrom(u.deniedCapabilities), grants: grantsFrom(u.grantedCapabilities) }
  const all = u.role === "ADMIN"
  return {
    all,
    storeIds: all ? [...activeStoreIds] : [...new Set(u.storeAssignments.map((a) => a.storeId))].filter((id) => activeStoreIds.has(id)),
    messages: can(actor as Parameters<typeof can>[0], "messages.use"),
    reports: can(actor as Parameters<typeof can>[0], "reports.view"),
  }
}

/** Narrower of two scopes for one address: fewer stores, then fewer sections. */
function narrower(a: Scope, b: Scope): Scope {
  if (a.all !== b.all) return a.all ? b : a
  const ids = a.storeIds.filter((id) => b.storeIds.includes(id))
  return { all: a.all && b.all, storeIds: ids, messages: a.messages && b.messages, reports: a.reports && b.reports }
}

const scopeKey = (s: Scope) => `${s.all ? "all" : `stores:${[...s.storeIds].sort().join(",")}`}|m${s.messages ? 1 : 0}|r${s.reports ? 1 : 0}`

// ── The snapshot ─────────────────────────────────────────────────────────────

/**
 * The payload, without enqueueing. Exported for the fixture and the preview.
 * `onlyScope` (preview) builds the one view for that scope and maps no address.
 */
export async function buildTaskCommSnapshot(opts: {
  organizationId: string
  frequency: ScheduleFrequency
  /** The schedule zone's local date the slot fired on. */
  localDate: string
  /** The schedule's zone, for the corporate-update window. */
  timeZone: string
  now: Date
  settings: KindSettings | undefined
  /** Preview: build only this user's view (null = the org-wide view). */
  previewUserId?: string | null
}): Promise<{ payload: TaskCommPayload; previewViewKey?: string }> {
  const { organizationId, frequency, now, settings } = opts
  const period = reportedPeriod(frequency, opts.localDate)
  const thresholdPct = settings?.thresholdPct ?? TASK_COMM_DEFAULT_THRESHOLD

  const activeStores = await prisma.store.findMany({
    where: { organizationId, isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, timezone: true },
  })
  const activeIds = new Set(activeStores.map((s) => s.id))
  const nameOrder = new Map(activeStores.map((s, i) => [s.id, i]))
  const allScope: Scope = { all: true, storeIds: [...activeIds], messages: true, reports: true }

  // ── scopes by address
  const scopeByAddress = new Map<string, Scope>()
  let previewScope: Scope | undefined
  const userSelect = { id: true, email: true, role: true, deniedCapabilities: true, grantedCapabilities: true, storeAssignments: { select: { storeId: true } } } as const
  if (opts.previewUserId !== undefined) {
    if (opts.previewUserId === null) previewScope = allScope
    else {
      const u = await prisma.user.findFirst({ where: { id: opts.previewUserId, organizationId }, select: userSelect })
      if (!u) throw new Error("preview user not found in this organization")
      previewScope = scopeOfUser(u, activeIds)
    }
  } else {
    const roles: Role[] = [...(settings?.sendToAdmins ?? true ? (["ADMIN"] as const) : []), ...(settings?.sendToManagers ?? true ? (["MANAGER"] as const) : [])]
    const [users, extras] = await Promise.all([
      roles.length ? prisma.user.findMany({ where: { organizationId, role: { in: roles } }, select: userSelect }) : [],
      resolveExtras(organizationId, TASK_COMM_KIND, "notify.taskcomm.receive"),
    ])
    const put = (email: string, s: Scope) => {
      const key = email.trim().toLowerCase()
      if (!key) return
      const prev = scopeByAddress.get(key)
      scopeByAddress.set(key, prev ? narrower(prev, s) : s)
    }
    for (const u of users) put(u.email, scopeOfUser(u, activeIds))
    // Rider: a contact that is a user gets THAT user's view. resolveExtras
    // attaches the matching user (the failing one, when several match).
    const extraUserIds = extras.flatMap((x) => (x.user ? [x.user.id] : []))
    const extraUsers = extraUserIds.length
      ? await prisma.user.findMany({ where: { id: { in: extraUserIds }, organizationId }, select: userSelect })
      : []
    const byId = new Map(extraUsers.map((u) => [u.id, u]))
    for (const x of extras) {
      const u = x.user ? byId.get(x.user.id) : undefined
      if (x.user && !u) continue // fail closed: a matched user we cannot read gets nothing
      put(x.email, u ? scopeOfUser(u, activeIds) : allScope)
    }
  }

  // ── stores and their own periods
  const stores: Record<string, TaskCommStore> = {}
  for (const s of activeStores) {
    const p = reportedPeriod(frequency, localDateStr(now, s.timezone))
    stores[s.id] = { name: s.name, timezone: s.timezone, from: p.from, to: p.to }
  }

  // ── (a) message ids per store, in each store's own window
  const messageIdsByStore: Record<string, string[]> = {}
  for (const s of activeStores) {
    const w = localWindow(stores[s.id].from, stores[s.id].to, s.timezone)
    const rows = await prisma.teamMessage.findMany({
      where: { organizationId, storeId: s.id, deletedAt: null, createdAt: { gte: w.gte, lt: w.lt } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    })
    if (rows.length) messageIdsByStore[s.id] = rows.map((r) => r.id)
  }

  // ── (a′) weekly/monthly: every equipment and shortage ticket open NOW, any
  // age (Gary, 2026-11-06: "no matter when it was created"). Ids only; the
  // kind re-checks each one's status at send time.
  const openTicketIdsByStore: Record<string, string[]> = {}
  if (frequency !== "daily") {
    const open = await prisma.teamMessage.findMany({
      where: {
        organizationId,
        storeId: { in: [...activeIds] },
        deletedAt: null,
        status: "open",
        type: { in: ["equipment", "shortage"] },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, storeId: true },
    })
    for (const t of open) (openTicketIdsByStore[t.storeId] ??= []).push(t.id)
  }

  // ── (b) corporate updates published in the period, in the schedule's zone
  const cw = localWindow(period.from, period.to, opts.timeZone)
  const corporate = await prisma.corporateUpdate.findMany({
    where: { organizationId, deletedAt: null, publishedAt: { gte: cw.gte, lt: cw.lt } },
    orderBy: { publishedAt: "asc" },
    select: { id: true, storeIds: true },
  })

  // ── (c) did not attempt: ≥1 Daily row that store-day, none started, no task logged (F8)
  const notAttempted: Record<string, string[]> = {}
  for (const s of activeStores) {
    const rows = await prisma.checklist.findMany({
      where: { organizationId, storeId: s.id, date: { gte: dbDate(stores[s.id].from), lte: dbDate(stores[s.id].to) } },
      select: { date: true, startedAt: true, template: { select: { frequency: true } }, _count: { select: { taskLogs: true } } },
    })
    const byDate = new Map<string, { daily: number; touched: number }>()
    for (const r of rows) {
      if (!dayCloseAppliesTo(r.template.frequency)) continue
      const d = localDateStr(r.date, "UTC")
      const e = byDate.get(d) ?? { daily: 0, touched: 0 }
      e.daily++
      if (r.startedAt || r._count.taskLogs > 0) e.touched++
      byDate.set(d, e)
    }
    const days = [...byDate.entries()].filter(([, e]) => e.daily > 0 && e.touched === 0).map(([d]) => d).sort()
    if (days.length) notAttempted[s.id] = days
  }

  // ── (d) operations-report figures per store (F9: the Operations Report's definition)
  const performance: Record<string, TaskCommPerf> = {}
  const groups = new Map<string, typeof activeStores>()
  for (const s of activeStores) {
    const k = `${stores[s.id].from}|${stores[s.id].to}`
    groups.set(k, [...(groups.get(k) ?? []), s])
  }
  for (const [k, group] of groups) {
    const [from, to] = k.split("|")
    const report = await computeOperationsReport({ organizationId, stores: group, from, to, now })
    for (const s of group) {
      const b = report.byStore.get(s.id)
      if (!b) continue
      const pct = completionPct(b)
      performance[s.id] = {
        total: b.total,
        completed: b.completed,
        missed: b.missed,
        completedLate: b.completedLate,
        pct,
        below: pct !== null && pct < thresholdPct,
      }
    }
  }

  // ── views
  const views: Record<string, TaskCommView> = {}
  const viewFor = (s: Scope): string => {
    const key = scopeKey(s)
    if (!views[key]) {
      const ids = [...s.storeIds].sort((a, b) => (nameOrder.get(a) ?? 0) - (nameOrder.get(b) ?? 0))
      views[key] = {
        storeIds: ids,
        messages: s.messages,
        reports: s.reports,
        // F3: only what the viewer could see in the app — the corporate-updates
        // GET's predicate (api/corporate-updates/route.ts): an admin sees every
        // published update; anyone else, those for all stores or one of theirs.
        corporateIds: corporate
          .filter((c) => s.all || c.storeIds.length === 0 || c.storeIds.some((id) => ids.includes(id)))
          .map((c) => c.id),
      }
    }
    return key
  }
  const scopes: Record<string, string> = {}
  for (const [addr, s] of scopeByAddress) scopes[addr] = viewFor(s)
  const previewViewKey = previewScope ? viewFor(previewScope) : undefined

  return {
    payload: {
      frequency,
      periodKey: period.key,
      periodLabel: period.label,
      thresholdPct,
      stores,
      messageIdsByStore,
      openTicketIdsByStore,
      notAttempted,
      performance,
      views,
      scopes,
    },
    previewViewKey,
  }
}

/** The org's settings row for this kind, as the kind reads it. */
export async function loadTaskCommSettings(organizationId: string): Promise<KindSettings | undefined> {
  const row = await prisma.notificationKindSettings.findUnique({
    where: { organizationId_kind: { organizationId, kind: TASK_COMM_KIND } },
    select: { enabled: true, subject: true, body: true, sendToAdmins: true, sendToManagers: true, thresholdPct: true },
  })
  return row ?? undefined
}

export async function processTaskComm(opts: {
  sender: EmailSender
  mode: DeliveryMode
  now: Date
  organizationId: string
  frequency: ScheduleFrequency
  /** The slot's local date, in the schedule's zone. */
  localDate: string
  timeZone?: string
}): Promise<TaskCommOrgResult> {
  const result: TaskCommOrgResult = { organizationId: opts.organizationId, views: 0, recipients: 0, sent: 0, failed: 0, dryRun: 0 }
  const settings = await loadTaskCommSettings(opts.organizationId)
  if (!settings?.enabled) return { ...result, skipped: "disabled" }

  const { payload } = await buildTaskCommSnapshot({
    organizationId: opts.organizationId,
    frequency: opts.frequency,
    localDate: opts.localDate,
    timeZone: opts.timeZone ?? DEFAULT_TIME_ZONE,
    now: opts.now,
    settings,
  })
  result.periodKey = payload.periodKey
  result.views = Object.keys(payload.views).length
  result.recipients = Object.keys(payload.scopes).length
  if (result.recipients === 0) {
    console.log(`[task-comm] skip org=${opts.organizationId} reason=no-recipients`)
    return { ...result, skipped: "no-recipients" }
  }

  // F10 (Gary: "Approved"): once on, always send — no empty-period skip.
  const enq = await enqueueNotification({
    organizationId: opts.organizationId,
    kind: TASK_COMM_KIND,
    dedupeKey: `${opts.organizationId}:${payload.periodKey}`,
    entityId: null,
    eventAt: opts.now,
    payload,
  })
  if (!enq) return { ...result, error: "could not record the email" }
  result.intentState = enq.state
  if (enq.state !== "queued") return result

  const dispatched = await dispatchNotifications({
    transport: { mode: opts.mode, sender: () => opts.sender },
    trigger: "producer",
    organizationId: opts.organizationId,
    intentIds: [enq.intentId],
    now: opts.now,
  })
  for (const d of dispatched) {
    for (const r of d.recipients) {
      if (r.status === "sent") result.sent++
      else if (r.status === "failed") result.failed++
      else if (r.status === "dry-run") result.dryRun++
    }
  }
  return result
}
