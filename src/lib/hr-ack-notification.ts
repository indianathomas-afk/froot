// ─── HR-16: signed-acknowledgment completion email ───────────────────────────
// One email per MINTED HrSignedRecord, to the addresses the org chose in
// Organization.hrAckRecipients. The first real consumer of NOTIFY-1.
//
// THE ONE RULE THIS FILE EXISTS TO KEEP: the employee's signing completes
// identically whether email is up, down, or unconfigured. Everything below is
// downstream of that — the scheduling through `after()`, the try/catch around
// the SENDER CONSTRUCTION rather than only the send, the swallowed audit write.
// Nothing here may throw into the signing path.
//
// Not a cron, not a queue, no retry. A failed send is recorded and lost; the
// record it describes is permanent and downloadable regardless. Delivery status
// beyond "Resend accepted it" is NOTIFY-2's job (webhooks), not this file's.

import { after } from "next/server"
import { prisma } from "@/lib/prisma"
import { getEmailSender } from "@/lib/notify"
import { renderEmail } from "@/lib/email-template"
import { ACTION_FAILED, ACTION_SENT, recordEmailAttempt } from "@/lib/notification-log"

// AuditLog shape, ruled by Gary 2026-09-20 (F2). entityType is the CHANNEL and
// action is the OUTCOME, so a future /settings/notifications page (NOTIFY-2)
// filters on one indexed value — @@index([organizationId, entityType,
// createdAt]) is already the index it needs. `kind` inside metadata is what
// distinguishes HR-16's mail from the next consumer's; the entityType stays
// "Notification" for all of them.
//
// WRITE-ONLY FOR NOW, BY RULING. Nothing reads these rows: the only AuditLog
// reader is /api/forecasting/audit, which filters to GOAL_ENTITY_TYPES
// (src/lib/audit.ts:16) and cannot see them. NOTIFY-2 is the row that builds
// the reader.
// NOTIFY-2b moved these to src/lib/notification-log.ts, which is now the one
// file that knows the row shape — three consumers write it as of this phase,
// and three copies of the strings is how a log ends up with two spellings of
// the same kind.
const AUDIT_KIND = "hr.ack"

// Same format the Certificate of Acknowledgment prints (hr-signed-pdf.ts:66).
// Copied rather than imported: that module pulls pdf-lib and unpdf, and this
// one has no other reason to.
function utc(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC"
}

export type AckNotificationOutcome =
  | { status: "sent"; recipients: string[]; id?: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; recipients: string[]; error: string }

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
 * Load what the email needs, send it, record the outcome. Exported for the
 * scheduler above and for direct use in a verification script; callers get an
 * outcome rather than an exception.
 */
export async function sendAckNotification(signedRecordId: string): Promise<AckNotificationOutcome> {
  const record = await prisma.hrSignedRecord.findUnique({
    where: { id: signedRecordId },
    include: {
      version: {
        select: {
          versionNumber: true,
          hrDocument: {
            select: { title: true, organization: { select: { id: true, name: true, hrAckRecipients: true } } },
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
  const recipients = org.hrAckRecipients

  // F3 (Gary, 2026-09-20): SILENT SKIP WITH A NAMED LOG LINE. Same shape as
  // F-5's "no admin/manager recipients" (src/lib/pace-alerts.ts:100) — the skip
  // is not an error and raises nothing, but it says WHY in the log so an org
  // that forgot to fill the field is distinguishable from one whose provider
  // broke. NO AUDIT ROW: the ruling is one row per ATTEMPT, and nothing was
  // attempted.
  if (recipients.length === 0) {
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
  // Same "-" the certificate prints for a signer with no store (corporate
  // members are homed at no location by design). Not invented copy: it is what
  // the artifact says.
  const storeName = lastAck.storeName ?? "-"

  const title = record.version.hrDocument.title
  const versionNumber = record.version.versionNumber

  // F4 (Gary, 2026-09-20): the DOWNLOAD API, which is the only URL that names
  // this record. ADMIN or in-scope MANAGER (HR-7 rule 5); it 307s to a
  // short-lived signed blob URL, so a recipient outside that tier gets a 403
  // rather than the bytes.
  //
  // NEXT_PUBLIC_APP_URL is the existing host variable (eight call sites; see
  // api/webhooks/square/route.ts:51, which likewise treats it as required). No
  // new variable is introduced. Unset is a REAL failure and is recorded as one
  // — a link with no host helps nobody, and a silent send with a broken link is
  // the kind of thing that goes unnoticed for months.
  // NOTIFY-2b: BUILT BEFORE THE HOST GATE BELOW, DELIBERATELY. The subject
  // needs no URL, and the `email.failed` row written when the host is missing
  // is far more useful naming the email it could not send than leaving the
  // send log a row that says only "failed".
  const subject = `Signed: ${title} v${versionNumber} — ${nameOnRecord}${
    lastAck.storeName ? ` (${lastAck.storeName})` : ""
  }`

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!appUrl) {
    const error = "NEXT_PUBLIC_APP_URL is not set — the record link has no host"
    console.error(`[hr-ack] record=${signedRecordId} not sent: ${error}`)
    await recordOutcome(org.id, signedRecordId, ACTION_FAILED, subject, { recipients, error })
    return { status: "failed", recipients, error }
  }
  const recordUrl = new URL(`/api/hr/signed-records/${record.id}/download`, appUrl).toString()

  const text = [
    `${nameOnRecord} completed all required acknowledgments.`,
    "",
    `Document:   ${title}, version ${versionNumber}`,
    `Signer:     ${nameOnRecord}  (executed as: ${executedName})`,
    `Store:      ${storeName}`,
    `Completed:  ${utc(record.completedAt)}`,
    `Record:     ${recordUrl}`,
    "",
    `Sent by USE Froot on behalf of ${org.name}. This address does not accept`,
    "replies.",
  ].join("\n")

  try {
    // THE CONSTRUCTION IS INSIDE THE TRY, NOT JUST THE SEND (Gary, 2026-09-20).
    // getEmailSender() THROWS on a misconfigured deployment and never degrades
    // to the console sender (src/lib/notify.ts:138-157) — so on staging, where
    // NOTIFY_EMAIL_PROVIDER=resend, a missing RESEND_API_KEY throws here and not
    // at send(). Outside this try that throw reaches the signing path.
    const sender = getEmailSender()
    // replyTo is deliberately NOT set. notify.ts:19-22 anticipates HR-16 wanting
    // it; the HR-16 ruling is the later instruction and says no per-merchant
    // reply address. Sending is `USE Froot <noreply@notify.usefroot.com>`
    // (NOTIFY_FROM_EMAIL) for every recipient.
    //
    // NOTIFY-2b: THE HTML IS NEW, THE TEXT IS NOT. `text` above is passed
    // through the template verbatim rather than regenerated from the rows —
    // this email's wording predates the template and its lines are what the
    // HR-16 ruling settled. The template's own text generator would produce a
    // different (correct, but different) body, and changing the wording was
    // never what "one template" was asked to buy.
    const { html } = renderEmail({
      orgName: org.name,
      heading: `${nameOnRecord} completed all required acknowledgments.`,
      intro: "",
      rows: [
        { label: "Document", value: `${title}, version ${versionNumber}` },
        { label: "Signer", value: `${nameOnRecord}  (executed as: ${executedName})` },
        { label: "Store", value: storeName },
        { label: "Completed", value: utc(record.completedAt) },
      ],
      cta: { label: "Download the record", url: recordUrl },
      footer: `Sent by USE Froot on behalf of ${org.name}. This address does not accept replies.`,
      appUrl,
      text,
    })
    const { id } = await sender.send({ to: recipients, subject, text, html })
    console.log(
      `[hr-ack] record=${signedRecordId} sent to ${recipients.length} recipient(s) id=${id ?? "(none)"}`
    )
    await recordOutcome(org.id, signedRecordId, ACTION_SENT, subject, { recipients, resendId: id ?? null })
    return { status: "sent", recipients, id }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error(`[hr-ack] record=${signedRecordId} send failed: ${error}`)
    await recordOutcome(org.id, signedRecordId, ACTION_FAILED, subject, { recipients, error })
    return { status: "failed", recipients, error }
  }
}

// NOTIFY-2b: the row shape moved to src/lib/notification-log.ts, which stamps
// `provider` itself and swallows its own failures. This wrapper survives only
// because the whole point of this file is that nothing downstream of a
// signature can throw, and one more catch costs nothing.
//
// WHAT NOTIFY-2a WROTE HERE IS PRESERVED IN THAT FILE AND IS WORTH RE-READING
// BEFORE ANYONE "SIMPLIFIES" IT: `provider` is what stops a console-mode
// "sent" from reading as delivery, and `resendId` is NOT a usable proxy for it
// — the console sender returns {} so console mode stores null, but so does a
// real Resend 2xx whose body failed to parse (notify.ts:112-117, which
// deliberately keeps the send successful and loses the id).
async function recordOutcome(
  organizationId: string,
  signedRecordId: string,
  action: typeof ACTION_SENT | typeof ACTION_FAILED,
  subject: string,
  extra: { recipients: string[]; resendId?: string | null; error?: string }
): Promise<void> {
  try {
    await recordEmailAttempt({
      organizationId,
      entityId: signedRecordId,
      kind: AUDIT_KIND,
      action,
      subject,
      ...extra,
    })
  } catch (err) {
    console.error(`[hr-ack] record=${signedRecordId} audit write failed:`, err)
  }
}
