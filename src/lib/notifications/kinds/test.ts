// ─── NOTIFY-6: kind "test" — "Send a test to me" (NOTIFY-1, NOTIFY-5) ────────
// The producer is POST /api/notify/test. Every press is a fresh intent (a
// random dedupeKey), dispatched inline. THE RECIPIENT IS THE CALLER'S OWN
// CLERK PRIMARY EMAIL, resolved by the route and carried in the payload — never
// a request body field. That is the route's whole security model, unchanged.
//
// FRESHNESS 15 MINUTES, NOT "IMMEDIATE" (audit W3): a zero window would expire
// the intent before its own inline dispatch. A test still queued when the sweep
// next looks (dry-run, sandbox, or a failed send the button already reported)
// is past 15 minutes and expires — an admin never gets a surprise test an hour
// later.

import { renderEmail } from "@/lib/email-template"
import { defineNotification } from "../define"

export type TestPayload = {
  to: string
  /** The provider string as configured when the button was pressed. */
  provider: string
  stamp: string
  deployEnv: string
  sha: string
}

export const testKind = defineNotification<TestPayload>({
  kind: "test",
  label: "Test",
  enabled: () => true,
  freshnessMinutes: 15,
  batch: "per-intent",
  // Gary, NOTIFY-5: "Send a test to me" may email the admin who pressed it even
  // when the allowlist is empty, because it can only ever reach the person
  // clicking.
  sandboxBypass: true,

  async resolveRecipients(intent) {
    return [{ email: intent.payload.to }]
  },

  // The NOTIFY-1 text, unchanged and passed through the template verbatim.
  render(p, org) {
    const subject = `USE Froot test — ${p.stamp}`
    const text = [
      `This is a USE Froot email delivery test.`,
      ``,
      `Provider:   ${p.provider}`,
      `Deployment: ${p.deployEnv} @ ${p.sha}`,
      `Sent at:    ${p.stamp}`,
      ``,
      `If you are reading this in an inbox, real email delivery works in this`,
      `environment. Nothing else was sent — this route only ever writes to the`,
      `address on the requesting admin's own Clerk account.`,
    ].join("\n")

    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
    const { html } = renderEmail({
      orgName: org.name,
      heading: "This is a USE Froot email delivery test.",
      intro:
        "If you are reading this in an inbox, real email delivery works in this environment. " +
        "Nothing else was sent — this route only ever writes to the address on the requesting " +
        "admin's own Clerk account.",
      rows: [
        { label: "Provider", value: p.provider },
        { label: "Deployment", value: `${p.deployEnv} @ ${p.sha}` },
        { label: "Sent at", value: p.stamp },
      ],
      // No host, no button — see the fallback in email-template.ts.
      cta: appUrl ? { label: "Email notification settings", url: `${appUrl}/settings/notifications` } : undefined,
      footer: `Sent by USE Froot on behalf of ${org.name}. This address does not accept replies.`,
      appUrl,
      text,
    })
    return { subject, text, html }
  },
})
