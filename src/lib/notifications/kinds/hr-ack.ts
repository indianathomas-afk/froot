// ─── NOTIFY-6: kind "hr.ack" — signed-acknowledgment email (HR-16) ───────────
// The producer is src/lib/hr-ack-notification.ts, which runs inside after() at
// mint and never throws into the signing path. One intent per minted record,
// dedupeKey = signedRecordId, so a second call can never mail twice.
//
// RECIPIENTS ARE ADDRESSES, NOT USERS (HR-16): Organization.hrAckRecipients,
// read at dispatch time, so an address removed after the signing is not mailed.
// No capability. The org switch is "the list is non-empty" — the producer skips
// an empty list without writing anything (F3, 2026-09-20), and a list emptied
// between signing and send expires the intent.
//
// THE SUBJECT AND TEXT ARE HR-16's, BYTE FOR BYTE, moved from
// hr-ack-notification.ts. The payload carries the snapshots that file derived
// from the acknowledgment rows, so the email still agrees with the certificate.

import { renderEmail } from "@/lib/email-template"
import { defineNotification } from "../define"

export type HrAckPayload = {
  signedRecordId: string
  title: string
  versionNumber: number
  nameOnRecord: string
  executedName: string
  /** The store snapshot, null for a signer homed at no store. */
  storeName: string | null
  /** ISO instant. */
  completedAt: string
}

// Same format the Certificate of Acknowledgment prints (hr-signed-pdf.ts:66).
function utc(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC"
}

export function hrAckSubject(p: HrAckPayload): string {
  return `Signed: ${p.title} v${p.versionNumber} — ${p.nameOnRecord}${p.storeName ? ` (${p.storeName})` : ""}`
}

export const hrAckKind = defineNotification<HrAckPayload>({
  kind: "hr.ack",
  label: "Signed acknowledgment",
  enabled: (org) => org.hrAckRecipients.length > 0,
  freshnessMinutes: 7 * 24 * 60,
  batch: "per-intent",

  async resolveRecipients(_intent, org) {
    return org.hrAckRecipients.map((email) => ({ email }))
  },

  render(p, org) {
    const subject = hrAckSubject(p)
    // F4 (Gary, 2026-09-20): the DOWNLOAD API, the only URL that names this
    // record. NEXT_PUBLIC_APP_URL unset is a REAL failure, recorded as one —
    // a link with no host helps nobody.
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
    if (!appUrl) return { subject, error: "NEXT_PUBLIC_APP_URL is not set — the record link has no host" }
    const recordUrl = new URL(`/api/hr/signed-records/${p.signedRecordId}/download`, appUrl).toString()
    // Same "-" the certificate prints for a signer with no store.
    const storeName = p.storeName ?? "-"
    const completedAt = new Date(p.completedAt)

    const text = [
      `${p.nameOnRecord} completed all required acknowledgments.`,
      "",
      `Document:   ${p.title}, version ${p.versionNumber}`,
      `Signer:     ${p.nameOnRecord}  (executed as: ${p.executedName})`,
      `Store:      ${storeName}`,
      `Completed:  ${utc(completedAt)}`,
      `Record:     ${recordUrl}`,
      "",
      `Sent by USE Froot on behalf of ${org.name}. This address does not accept`,
      "replies.",
    ].join("\n")

    // replyTo deliberately NOT set (HR-16 ruling; P4 reopens it in NOTIFY-8).
    const { html } = renderEmail({
      orgName: org.name,
      heading: `${p.nameOnRecord} completed all required acknowledgments.`,
      intro: "",
      rows: [
        { label: "Document", value: `${p.title}, version ${p.versionNumber}` },
        { label: "Signer", value: `${p.nameOnRecord}  (executed as: ${p.executedName})` },
        { label: "Store", value: storeName },
        { label: "Completed", value: utc(completedAt) },
      ],
      cta: { label: "Download the record", url: recordUrl },
      footer: `Sent by USE Froot on behalf of ${org.name}. This address does not accept replies.`,
      appUrl,
      text,
    })
    return { subject, text, html }
  },
})
