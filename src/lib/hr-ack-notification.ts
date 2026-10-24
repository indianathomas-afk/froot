// ─── HR-16: signed-acknowledgment completion email ───────────────────────────
// One email per MINTED HrSignedRecord, to the org's "Also send to" picks for
// "hr.ack" (NOTIFY-12; until then Organization.hrAckRecipients, which the
// migration copied into picks and nothing reads now). The first real consumer
// of NOTIFY-1.
//
// THE ONE RULE THIS FILE EXISTS TO KEEP: the employee's signing completes
// identically whether email is up, down, or unconfigured. Everything below is
// downstream of that — the scheduling through `after()`, the try/catch around
// the SENDER CONSTRUCTION rather than only the send, the swallowed audit write.
// Nothing here may throw into the signing path.
//
// NOTIFY-6: THIS FILE IS NOW A PRODUCER, AND THE "NO RETRY" THAT STOOD HERE IS
// GONE. The mint enqueues one "hr.ack" intent (dedupeKey = signedRecordId) and
// dispatches it inline, so a signing notice still arrives in seconds; a failed
// live send is retried by the hourly sweep, only to the addresses that did not
// get it (P6, Gary 2026-10-18), and the intent's state is the sent-once lock.
// The email — subject and text byte for byte — lives in
// src/lib/notifications/kinds/hr-ack.ts. The enqueue is the only thing the
// signing path touches, and it never throws.

import { after } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  dispatchNotifications,
  enqueueNotification,
  recordUndispatchable,
  resolveTransport,
} from "@/lib/notifications/dispatch"
import type { HrAckPayload } from "@/lib/notifications/kinds/hr-ack"
import { countActivePicks, resolveExtras } from "@/lib/notifications/picks"

export type AckNotificationOutcome =
  | { status: "sent"; recipients: string[]; id?: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; recipients: string[]; error: string }
  // NOTIFY-5: composed and logged, handed to no provider. `recipients` is who
  // it WOULD have gone to.
  | { status: "dry-run"; recipients: string[] }

/**
 * Fire the completion email for a minted record, after the response is sent.
 *
 * NEVER THROWS — not from `after()` being unavailable, not from the send. Same
 * contract as scheduleLaborRefresh (src/lib/labor-dashboard.ts:197), and it is
 * the reason this wrapper exists at all rather than callers calling
 * sendAckNotification directly.
 *
 * `after()` throws outside a request scope. Both mint call sites are route
 * handlers so that cannot happen today, but ensureSignedRecord is exported and
 * a script could reach it — a notification that cannot be scheduled must not
 * take a signing down with it.
 */
export function scheduleAckNotification(signedRecordId: string): void {
  try {
    after(async () => {
      try {
        await sendAckNotification(signedRecordId)
      } catch (err) {
        // sendAckNotification already catches its own send failures; this is
        // the backstop for anything else (a dropped connection mid-query).
        console.error(`[hr-ack] record=${signedRecordId} notification threw:`, err)
      }
    })
  } catch (err) {
    console.error(`[hr-ack] record=${signedRecordId} could not be scheduled:`, err)
  }
}

/**
 * Load what the email needs, enqueue it, dispatch it inline, and report the
 * outcome. Exported for the scheduler above and for direct use in a
 * verification script; callers get an outcome rather than an exception.
 */
export async function sendAckNotification(signedRecordId: string): Promise<AckNotificationOutcome> {
  const record = await prisma.hrSignedRecord.findUnique({
    where: { id: signedRecordId },
    include: {
      version: {
        select: {
          versionNumber: true,
          hrDocument: {
            select: { title: true, organization: { select: { id: true, name: true } } },
          },
        },
      },
    },
  })
  if (!record) {
    console.error(`[hr-ack] record=${signedRecordId} not found — nothing sent`)
    return { status: "skipped", reason: "record not found" }
  }

  const org = record.version.hrDocument.organization

  // F3 (Gary, 2026-09-20): SILENT SKIP WITH A NAMED LOG LINE, AND STILL
  // ROW-LESS. NOTIFY-6 keeps it before the enqueue, so an org that does not use
  // the feature writes no intent either — nothing was attempted. NOTIFY-12 F12:
  // "configured" now means at least one ACTIVE pick — the same count the kind's
  // switch reads, so the two cannot disagree.
  if (((await countActivePicks(org.id))["hr.ack"] ?? 0) === 0) {
    console.log(`[hr-ack] record=${signedRecordId} org=${org.id} skipped: no recipients configured`)
    return { status: "skipped", reason: "no recipients configured" }
  }

  // The two names, the store and the version are all SNAPSHOTS on the
  // acknowledgment rows, not on the record (HR-11c). Re-derived here exactly as
  // the certificate derives them (hr-signed-pdf.ts:424, :598-602, :617-619), on
  // the same three keys ensureSignedRecord mints under — an email that disagrees
  // with the artifact it links to is worse than no email.
  const acks = await prisma.hrDocumentAcknowledgment.findMany({
    where: {
      hrDocumentVersionId: record.hrDocumentVersionId,
      staffMemberId: record.staffMemberId,
      signingCycle: record.signingCycle,
    },
    select: {
      staffName: true,
      storeName: true,
      typedName: true,
      signedAt: true,
      checkpoint: { select: { orderIndex: true, type: true, retiredAt: true } },
    },
  })
  // HR-11n: retired steps leave every consumer of an acknowledgment, the
  // certificate's name derivation included.
  const live = acks
    .filter((a) => a.checkpoint.retiredAt == null)
    .sort((a, b) => a.checkpoint.orderIndex - b.checkpoint.orderIndex)
  if (live.length === 0) {
    console.error(`[hr-ack] record=${signedRecordId} has no live acknowledgments — nothing to describe`)
    return { status: "skipped", reason: "no live acknowledgments" }
  }

  const lastAck = live.reduce((a, b) => (a.signedAt > b.signedAt ? a : b))
  const nameOnRecord = lastAck.staffName
  const executedName =
    live.find((a) => a.checkpoint.type === "Signature" || a.checkpoint.type === "Acknowledgment")
      ?.typedName ?? nameOnRecord
  const payload: HrAckPayload = {
    signedRecordId: record.id,
    title: record.version.hrDocument.title,
    versionNumber: record.version.versionNumber,
    nameOnRecord,
    executedName,
    storeName: lastAck.storeName ?? null,
    completedAt: record.completedAt.toISOString(),
  }

  const enq = await enqueueNotification({
    organizationId: org.id,
    kind: "hr.ack",
    dedupeKey: record.id,
    entityId: record.id,
    eventAt: record.completedAt,
    payload,
  })
  if (!enq) {
    const recipients = (await resolveExtras(org.id, "hr.ack").catch(() => [])).map((p) => p.email)
    return { status: "failed", recipients, error: "could not record the notification" }
  }
  if (enq.state !== "queued" && enq.state !== "partial") {
    return { status: "skipped", reason: `already ${enq.state}` }
  }

  // deliveryMode() THROWS on an unknown provider, so the transport is resolved
  // inside a try — that throw must never reach the signing path. It is recorded
  // as a failed send naming the bad value, as before.
  let transport: ReturnType<typeof resolveTransport>
  try {
    transport = resolveTransport()
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error(`[hr-ack] record=${signedRecordId} send failed: ${error}`)
    const recipients = await recordUndispatchable(enq.intentId, error)
    return { status: "failed", recipients, error }
  }

  const [r] = await dispatchNotifications({ transport, trigger: "producer", intentIds: [enq.intentId] })
  if (!r) return { status: "skipped", reason: "retry scheduled" }
  if (r.outcome === "expired") return { status: "skipped", reason: r.reason }

  const real = r.recipients.filter((x) => x.mode !== "dry-run")
  const sent = real.filter((x) => x.status === "sent")
  const failed = r.recipients.filter((x) => x.status === "failed")
  if (r.withheld > 0) {
    console.log(`[hr-ack] record=${signedRecordId} sandbox: withheld ${r.withheld} recipient(s) not on the allowlist`)
  }
  if (sent.length > 0 && failed.length === 0) {
    console.log(
      `[hr-ack] record=${signedRecordId} sent to ${sent.length} recipient(s) mode=${transport.mode} intent=${r.outcome}`
    )
    return { status: "sent", recipients: sent.map((x) => x.to), id: sent[0].providerMessageId }
  }
  if (failed.length > 0) {
    const error = failed[0].error ?? "send failed"
    console.error(`[hr-ack] record=${signedRecordId} send failed: ${error}`)
    return { status: "failed", recipients: failed.map((x) => x.to), error }
  }
  console.log(`[hr-ack] record=${signedRecordId} dry run (mode=${transport.mode}) — nothing sent`)
  return { status: "dry-run", recipients: r.recipients.map((x) => x.to) }
}
