// ─── TAB-16: the help request email, enqueued and dispatched inline ──────────
// Called by POST /api/stores/[id]/help-requests AFTER the TeamMessage exists
// (R1). Kept out of the route so scripts/verify-tab16-help.ts can run it with a
// capture transport. Rulings: docs/DECISIONS.md 2026-11-12 TAB-16.

import { prisma } from "@/lib/prisma"
import {
  dispatchNotifications,
  enqueueNotification,
  recordUndispatchable,
  resolveTransport,
  type Transport,
} from "@/lib/notifications/dispatch"
import type { HelpRequestPayload } from "@/lib/notifications/kinds/help-request"
import { HELP_REQUEST_KIND, type HelpEmail } from "@/lib/help-request-shared"

/**
 * Enqueue + inline dispatch, then the outcome as HelpEmail. NEVER THROWS: the
 * message is already posted and must stand (R9). Every path that did not send
 * is counted as failed or not emailed — never as emailed (R10).
 */
export async function sendHelpEmail(
  args: {
  organizationId: string
  storeId: string
  storeName: string
  messageId: string
  contactIds: string[]
  managerEmails: string[]
  eventAt: Date
  },
  /** The fixture injects a capture transport; production resolves the real one. */
  transportOverride?: Transport
): Promise<HelpEmail> {
  const intended = args.managerEmails.length + args.contactIds.length
  const base = { state: "done" as const, storeName: args.storeName, managersSent: 0, contactsSent: [] as string[], intentId: null as string | null }
  const payload: HelpRequestPayload = { messageId: args.messageId, storeId: args.storeId, contactIds: args.contactIds }
  const enq = await enqueueNotification({
    organizationId: args.organizationId,
    kind: HELP_REQUEST_KIND,
    dedupeKey: args.messageId,
    entityId: args.messageId,
    eventAt: args.eventAt,
    payload,
  })
  if (!enq) return { ...base, failed: intended, notEmailed: 0 }

  try {
    const transport = transportOverride ?? resolveTransport()
    const [r] = await dispatchNotifications({ transport, trigger: "producer", intentIds: [enq.intentId] })
    const managers = new Set(args.managerEmails)
    const recipients = r?.recipients ?? []
    const sent = recipients.filter((x) => x.status === "sent").map((x) => x.to)
    // A dry run, or an address the sandbox allowlist held back (R10).
    const notEmailed = recipients.filter((x) => x.status === "dry-run" || x.status === "skipped").length
    // A send that failed — or a dispatch that reached nobody at all (the switch
    // went off in between, the send-time lookup failed): it didn't go out (R9).
    const failed = recipients.length === 0 ? Math.max(intended, 1) : recipients.filter((x) => x.status === "failed").length
    return {
      ...base,
      intentId: enq.intentId,
      managersSent: sent.filter((e) => managers.has(e)).length,
      contactsSent: sent.filter((e) => !managers.has(e)),
      failed,
      notEmailed,
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "email send failed"
    console.error(`[help-request] message=${args.messageId} dispatch failed: ${message}`)
    await recordUndispatchable(enq.intentId, message).catch(() => [])
    return { ...base, intentId: enq.intentId, failed: intended, notEmailed: 0 }
  } finally {
    // R9: never retried. A dry run or sandbox send leaves an intent `queued`
    // by design (NOTIFY-5) and a hydrate failure leaves it queued for the
    // sweep; neither may send later on its own.
    await prisma.notificationIntent
      .updateMany({
        where: { id: enq.intentId, state: { in: ["queued", "partial"] } },
        data: { state: "expired", lastError: "TAB-16 R9: help request emails are never retried", nextAttemptAt: null },
      })
      .catch(() => {})
  }
}
