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
import { defineNotification, type GroupedKindDef, type ScheduleFrequency } from "../define"
import { MILESTONE_KIND, milestoneKind } from "./milestone"
import { renderDocDigest } from "./doc-digest"
import type { DocDigestView } from "@/lib/hr-doc-digest"

// MS-4b — "Send a sample to me". A kind with sample() can be rendered through
// THIS kind, so the sample inherits this kind's whole security model: the
// caller is the only recipient, sandbox reaches them, 15-minute freshness. The
// sampled kind's own resolver is never called. A map rather than the registry
// so this file does not import the registry that imports it.
const SAMPLED: Record<string, GroupedKindDef<unknown>> = {
  [MILESTONE_KIND]: milestoneKind as GroupedKindDef<unknown>,
}

/** Kinds the test route may sample. */
export function sampleableKinds(): string[] {
  return Object.keys(SAMPLED).filter((k) => !!SAMPLED[k].sample)
}

export type TestPayload = {
  to: string
  /** The provider string as configured when the button was pressed. */
  provider: string
  stamp: string
  deployEnv: string
  sha: string
  /** MS-4b: render this kind's sample() instead of the delivery test. */
  sampleOf?: string
  /**
   * NOTIFY-13a: the org's saved schedule frequency for `sampleOf`, read by the
   * route at the press. Absent with no schedule row → today's wording.
   */
  sampleFrequency?: ScheduleFrequency
  /**
   * NOTIFY-14 (F9, Gary 2026-10-27: "agreed."). "Send a preview to me" on the
   * document digest card: a REAL digest — the caller's own view, or a named
   * manager's — built by the route through the cron's own builder and rendered
   * by the real kind's renderer. Still this kind, so still only `to`.
   */
  digestPreview?: { view: DocDigestView; asOf: string; frequency: ScheduleFrequency }
}

export const testKind = defineNotification<TestPayload>({
  kind: "test",
  label: "Test",
  roleDefault: { summary: "Only the admin who pressed the button.", usersLink: false },
  // Never: the whole security model is "it can only reach the person clicking".
  extras: false,
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
  render(p, org, to) {
    if (p.digestPreview) {
      const d = p.digestPreview
      const r = renderDocDigest(d.view, org.name, d.asOf, d.frequency)
      return { ...r, subject: `Test — ${r.subject}` }
    }
    const sampled = p.sampleOf ? SAMPLED[p.sampleOf] : undefined
    if (p.sampleOf) {
      if (!sampled?.sample) return { subject: `USE Froot test — ${p.stamp}`, error: `no sample for "${p.sampleOf}"` }
      const r = sampled.renderGroup(sampled.sample(org, { frequency: p.sampleFrequency }), org, to)
      return { ...r, subject: `Test — ${r.subject}` }
    }
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
