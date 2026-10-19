// ─── NOTIFY-6: the shape of a notification kind ──────────────────────────────
// Types and defineNotification() only. Kept apart from ./registry.ts so the
// kind files can import it without an import cycle through the registry.

import type { Organization } from "@prisma/client"
import type { Capability } from "@/lib/permissions"

export type IntentState = "queued" | "sent" | "partial" | "failed" | "expired" | "known"

/** The org fields a kind may read. Loaded once per intent at dispatch time. */
export type NotificationOrg = Pick<
  Organization,
  "id" | "name" | "timezone" | "paceAlertsEnabled" | "hrAckRecipients"
>

/** The intent as a kind sees it. `payload` is typed by the kind. */
export type KindIntent<P> = {
  id: string
  organizationId: string
  kind: string
  dedupeKey: string
  entityId: string | null
  eventAt: Date
  payload: P
}

/**
 * One resolved recipient. `user` is present when the address belongs to a Froot
 * user, and then the kind's capability is checked through can() — the three
 * columns are all required for the same reason pace-alerts.ts gave in NOTIFY-2c
 * (a forgotten column must not read as an empty one). An address with no user
 * (an hrAckRecipients entry) has no capability to check.
 */
export type ResolvedRecipient = {
  email: string
  user?: {
    id: string
    role: string
    deniedCapabilities: string[]
    grantedCapabilities: string[]
  }
}

export type Rendered =
  | { subject: string; text: string; html?: string }
  // A render that cannot produce a body still names its subject, so the failed
  // row in the send log says which email it could not send (NOTIFY-2b's rule
  // for hr.ack's missing host, kept).
  | { subject: string; error: string }

export type NotificationKindDef<P> = {
  kind: string
  /** The send-log label. */
  label: string
  /** Checked through can() for every recipient that is a user. */
  capability?: Capability
  /** The org switch. Off at dispatch time → the intent expires, no mail. */
  enabled: (org: NotificationOrg) => boolean
  /**
   * How long a QUEUED intent may wait before it expires unsent, from eventAt.
   * Minutes, not days (audit W3): the test kind's window is 15 minutes.
   * A `partial` intent is never expired by age — it already reached someone.
   */
  freshnessMinutes: number
  batch: "per-intent"
  /** Resolved at dispatch, never cached (MS-4b F6). */
  resolveRecipients: (intent: KindIntent<P>, org: NotificationOrg) => Promise<ResolvedRecipient[]>
  /** Drop a recipient the kind must never mail (MS-4b F15's shape). */
  exclude?: (intent: KindIntent<P>, recipient: ResolvedRecipient) => boolean
  /** Pure: the payload, the org and one recipient in, one email out. */
  render: (payload: P, org: NotificationOrg, recipient: string) => Rendered
  /**
   * Sandbox reaches this kind's recipients whatever the allowlist says. ONLY the
   * test kind, by Gary's NOTIFY-5 ruling: "Send a test to me" may email the
   * admin who pressed it even when the allowlist is empty, because it can only
   * ever reach the person clicking.
   */
  sandboxBypass?: boolean
  /** Runs once, when a live intent first becomes `sent`. Must not throw. */
  onSent?: (intent: KindIntent<P>, sentTo: string[]) => Promise<void>
}

/** Erases the payload type so every kind fits one map; each kind stays typed inside. */
export function defineNotification<P>(def: NotificationKindDef<P>): NotificationKindDef<unknown> {
  return def as unknown as NotificationKindDef<unknown>
}
