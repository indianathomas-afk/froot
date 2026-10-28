// ─── NOTIFY-14: the document digest producer ─────────────────────────────────
// Called by the hourly runner (src/lib/scheduled-emails.ts) once the org's
// slot is due and claimed. Builds the snapshot the kind
// (src/lib/notifications/kinds/doc-digest.ts) renders from, enqueues ONE
// intent for the period and dispatches it inline. A PRODUCER NEVER SENDS — the
// dispatcher decides who hears and whether mail leaves (NOTIFY-6).
//
// THE SCOPE MAP (F1, F8 — Gary, 2026-10-27):
//   MANAGER          "stores:<their StoreUserAssignment ids, sorted>"
//   ADMIN            "all"   (written after managers: a shared address widens)
//   active contact   "all"   (written last: F8, both a manager and a contact →
//                             the org-wide version)
// Each distinct key is one getOrgComplianceRollup() call — the /hr/compliance
// call for that viewer — so a manager's digest is their page, not a filtered
// copy of the admin's (grouping depends on scope: rollupStoreGroupId).
//
// EMPTY → NOTHING (draft ruling 4). Every view empty → no intent at all and a
// named skip line; one recipient's view empty → the kind's `exclude` drops
// them with its own line.

import { prisma } from "@/lib/prisma"
import type { DeliveryMode, EmailSender } from "@/lib/notify"
import { dispatchNotifications, enqueueNotification } from "@/lib/notifications/dispatch"
import { resolveExtras } from "@/lib/notifications/picks"
import { periodKey } from "@/lib/notifications/schedule"
import type { ScheduleFrequency } from "@/lib/notifications/define"
import { digestIsEmpty, docDigestView, type DocDigestView } from "@/lib/hr-doc-digest"
import { ALL_VIEW, DOC_DIGEST_KIND, docDigestHrActive, type DocDigestPayload } from "@/lib/notifications/kinds/doc-digest"

export type DocDigestOrgResult = {
  organizationId: string
  /** Why nothing was enqueued, when nothing was. */
  skipped?: "disabled" | "hr-off" | "empty" | "no-recipients"
  views: number
  recipients: number
  /** The intent's state after enqueue; "sent" here means the period was already done. */
  intentState?: string
  sent: number
  failed: number
  dryRun: number
  error?: string
}

const storesKey = (ids: string[]) => `stores:${[...new Set(ids)].sort().join(",")}`

/** The snapshot, without enqueueing. Exported for the fixture. */
export async function buildDocDigestSnapshot(organizationId: string): Promise<{
  views: Record<string, DocDigestView>
  scopes: Record<string, string>
}> {
  const [users, extras] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId, role: { in: ["ADMIN", "MANAGER"] } },
      select: { email: true, role: true, storeAssignments: { select: { storeId: true } } },
    }),
    resolveExtras(organizationId, DOC_DIGEST_KIND, "notify.docdue.receive"),
  ])

  const scopes: Record<string, string> = {}
  const norm = (e: string) => e.trim().toLowerCase()
  for (const u of users) {
    if (u.role !== "MANAGER" || !norm(u.email)) continue
    if (scopes[norm(u.email)] === ALL_VIEW) continue
    scopes[norm(u.email)] = storesKey(u.storeAssignments.map((a) => a.storeId))
  }
  for (const u of users) if (u.role === "ADMIN" && norm(u.email)) scopes[norm(u.email)] = ALL_VIEW
  for (const x of extras) if (norm(x.email)) scopes[norm(x.email)] = ALL_VIEW

  const views: Record<string, DocDigestView> = {}
  for (const key of new Set(Object.values(scopes))) {
    views[key] = await docDigestView(
      organizationId,
      key === ALL_VIEW ? null : key.slice("stores:".length).split(",").filter(Boolean)
    )
  }
  return { views, scopes }
}

export async function processDocDigest(opts: {
  sender: EmailSender
  mode: DeliveryMode
  now: Date
  organizationId: string
  frequency: ScheduleFrequency
  /** The slot's local date, in the schedule's zone — the period and the "As of" date. */
  localDate: string
}): Promise<DocDigestOrgResult> {
  const result: DocDigestOrgResult = { organizationId: opts.organizationId, views: 0, recipients: 0, sent: 0, failed: 0, dryRun: 0 }
  const org = await prisma.organization.findUnique({
    where: { id: opts.organizationId },
    select: { id: true, clerkOrgId: true, activeModules: true, docDigestEnabled: true },
  })
  if (!org || !org.docDigestEnabled) return { ...result, skipped: "disabled" }
  if (!docDigestHrActive(org)) return { ...result, skipped: "hr-off" }

  const { views, scopes } = await buildDocDigestSnapshot(org.id)
  result.views = Object.keys(views).length
  result.recipients = Object.keys(scopes).length
  if (result.recipients === 0) {
    console.log(`[doc-digest] skip org=${org.id} reason=no-recipients`)
    return { ...result, skipped: "no-recipients" }
  }
  if (Object.values(views).every((v) => digestIsEmpty(v))) {
    console.log(`[doc-digest] skip org=${org.id} reason=empty (nothing overdue or due within 3 days in any view)`)
    return { ...result, skipped: "empty" }
  }

  const payload: DocDigestPayload = { asOf: opts.localDate, frequency: opts.frequency, views, scopes }
  const enq = await enqueueNotification({
    organizationId: org.id,
    kind: DOC_DIGEST_KIND,
    dedupeKey: `${org.id}:${periodKey(opts.frequency, opts.localDate)}`,
    entityId: null,
    eventAt: opts.now,
    payload,
  })
  if (!enq) return { ...result, error: "could not record the digest" }
  result.intentState = enq.state
  if (enq.state !== "queued") return result

  const dispatched = await dispatchNotifications({
    transport: { mode: opts.mode, sender: () => opts.sender },
    trigger: "producer",
    organizationId: org.id,
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
