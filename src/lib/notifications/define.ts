// ─── NOTIFY-6: the shape of a notification kind ──────────────────────────────
// Types and defineNotification() only. Kept apart from ./registry.ts so the
// kind files can import it without an import cycle through the registry.

import type { Organization } from "@prisma/client"
import type { Capability } from "@/lib/permissions"

export type IntentState = "queued" | "sent" | "partial" | "failed" | "expired" | "known"

/** The org fields a kind may read. Loaded once per intent at dispatch time. */
export type NotificationOrg = Pick<
  Organization,
  | "id"
  | "name"
  | "timezone"
  | "paceAlertsEnabled"
  // MS-4b. The milestone kind's switch is milestoneAlertsEnabled AND
  // milestonesActive() (HR available, HR on, milestonesEnabled), so the three
  // inputs to that predicate are here too.
  | "clerkOrgId"
  | "activeModules"
  | "milestonesEnabled"
  | "milestoneAlertsEnabled"
> & {
  /** MS-4a F13: MilestoneSettings.checklistMilestonesEnabled; no row = false. */
  checklistMilestonesEnabled: boolean
  /**
   * NOTIFY-12 F12: ACTIVE "Also send to" picks per kind key (./picks.ts); a
   * kind with none is absent. hr.ack's switch reads it — Organization.
   * hrAckRecipients is preserved and no longer read (F1).
   */
  activePicks: Record<string, number>
}

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
 * (an address-book contact that is no Froot user's) has no capability to check.
 */
export type ResolvedRecipient = {
  email: string
  /**
   * NOTIFY-12: why this address gets the email. A kind's resolver leaves it
   * unset (the dispatcher stamps "role"); ./picks.ts stamps the extras. The
   * de-dup merges them, so one address can carry more than one.
   */
  reasons?: RecipientReason[]
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

/** NOTIFY-12. Stored on NotificationMessage.recipientReasons. */
export type RecipientReason = "role" | "extra-user" | "extra-contact"

type KindCommon<P> = {
  kind: string
  /** The send-log label. */
  label: string
  /**
   * NOTIFY-12: who the kind's own resolver sends to, for the Recipients line on
   * /settings/notifications. `usersLink`: the line ends by pointing at the
   * Users page, where a person is turned off one at a time.
   */
  roleDefault: { summary: string; usersLink: boolean }
  /**
   * NOTIFY-12: whether an ADMIN may add "Also send to" recipients. False means
   * the dispatcher never reads picks for this kind, whatever rows exist.
   */
  extras: boolean
  /** Checked through can() for every recipient that is a user. */
  capability?: Capability
  /**
   * The org switch. Off at dispatch time → the intent expires, no mail. The
   * intent is passed so one kind can hold two switches (MS-4b: a checklist
   * milestone also needs F13's switch); the per-intent kinds ignore it.
   */
  enabled: (org: NotificationOrg, intent: KindIntent<P>) => boolean
  /**
   * How long a QUEUED intent may wait before it expires unsent, from eventAt.
   * Minutes, not days (audit W3): the test kind's window is 15 minutes.
   * A `partial` intent is never expired by age — it already reached someone.
   */
  freshnessMinutes: number
  /** Resolved at dispatch, never cached (MS-4b F6). */
  resolveRecipients: (intent: KindIntent<P>, org: NotificationOrg) => Promise<ResolvedRecipient[]>
  /**
   * Drop a recipient the kind must never mail (MS-4b F15's shape). May be async:
   * MS-4b compares against the employee's CURRENT userId and email.
   */
  exclude?: (intent: KindIntent<P>, recipient: ResolvedRecipient) => boolean | Promise<boolean>
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

/** One intent, one render per recipient, one message per recipient. */
export type PerIntentKindDef<P> = KindCommon<P> & {
  batch: "per-intent"
  /** Pure: the payload, the org and one recipient in, one email out. */
  render: (payload: P, org: NotificationOrg, recipient: string) => Rendered
}

/**
 * MS-4b ruling 1 (Gary, 2026-10-19): "one email per person per day, via a new
 * grouping mode in the dispatcher." Every intent of the kind due for one
 * recipient in one dispatch is rendered into ONE email. Delivery rows stay
 * per (intent, recipient), so P6 holds per item.
 */
export type GroupedKindDef<P> = KindCommon<P> & {
  batch: "per-recipient-daily"
  /** Pure: every payload due for this recipient (oldest first) in, one email out. */
  renderGroup: (payloads: P[], org: NotificationOrg, recipient: string) => Rendered
  /**
   * Fixed, fictional payloads for "Send a sample to me" (the test kind renders
   * them through renderGroup). Must never name a real person.
   */
  sample?: (org: NotificationOrg) => P[]
}

export type NotificationKindDef<P> = PerIntentKindDef<P> | GroupedKindDef<P>

/** Erases the payload type so every kind fits one map; each kind stays typed inside. */
export function defineNotification<P>(def: NotificationKindDef<P>): NotificationKindDef<unknown> {
  return def as unknown as NotificationKindDef<unknown>
}
