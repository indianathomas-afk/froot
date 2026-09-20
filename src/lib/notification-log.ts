// ─── NOTIFY-2b: the notification log ─────────────────────────────────────────
// One place that knows the shape of a `Notification` AuditLog row: who writes
// them, what the action strings are, and how a row plus its delivery events
// resolve to the one word the settings page prints.
//
// THE ROWS ARE APPEND-ONLY AND THAT IS THE WHOLE DESIGN (Gary, 2026-09-20).
// An `email.sent` row is a claim about what was ATTEMPTED, written at send
// time and true forever. A delivery verdict that arrives minutes later is a
// SECOND row correlated by `resendId`, never an update of the first — because
// AuditLog is append-only for every other writer in the app and one mutating
// consumer ends that property for all of them. The cost is a join; the benefit
// is that "we tried to send this" and "the mailbox took it" stay separately
// falsifiable.
//
// WHY THE PACE PATH AND THE TEST ROUTE WRITE ROWS AS OF THIS PHASE. Until now
// only HR-16 did (src/lib/hr-ack-notification.ts). PaceAlertLog records that an
// alert went out, but it is a per-store-month idempotency lock — no provider,
// no subject, no failure rows — and the test route recorded nothing at all. So
// the log would have shown one kind of email out of three, and a Resend
// delivery event for either of the other two could never find its org, since
// the lookup is by the sent row's `resendId`. The NOTIFY-2b roadmap row names
// this as in scope; it is not scope creep on the page.

import { prisma } from "@/lib/prisma"
import { writeAuditLog } from "@/lib/audit"
import { emailProviderName } from "@/lib/notify"

export const NOTIFICATION_ENTITY_TYPE = "Notification"

export const ACTION_SENT = "email.sent"
export const ACTION_FAILED = "email.failed"
export const ACTION_DELIVERED = "email.delivered"
export const ACTION_BOUNCED = "email.bounced"
export const ACTION_COMPLAINED = "email.complained"
export const ACTION_DELAYED = "email.delayed"

/** The rows an admin's "Recent emails" list is built from — one per attempt. */
export const ATTEMPT_ACTIONS = [ACTION_SENT, ACTION_FAILED] as const
/** Rows written by the Resend webhook, correlated to an attempt by resendId. */
export const DELIVERY_ACTIONS = [
  ACTION_DELIVERED,
  ACTION_BOUNCED,
  ACTION_COMPLAINED,
  ACTION_DELAYED,
] as const

export type NotificationKind = "hr.ack" | "pace.alert" | "test"

export const KIND_LABELS: Record<string, string> = {
  "hr.ack": "Signed acknowledgment",
  "pace.alert": "Behind-pace alert",
  test: "Test",
}

/**
 * Write one attempt row.
 *
 * NEVER THROWS — writeAuditLog already swallows its own failures, and this adds
 * a second catch because two of the three callers sit downstream of something
 * that must not fail: a signature being minted, and a cron's per-store loop.
 *
 * `provider` is stamped here rather than by the caller. It is the field that
 * stops a console-mode "sent" from reading as delivery (NOTIFY-2a), and it is
 * exactly the kind of field a third caller would forget.
 */
export async function recordEmailAttempt(args: {
  organizationId: string
  /** The thing the email is ABOUT, where there is one. Nullable by design. */
  entityId?: string | null
  kind: NotificationKind
  action: typeof ACTION_SENT | typeof ACTION_FAILED
  recipients: string[]
  subject: string
  resendId?: string | null
  error?: string
}): Promise<void> {
  const { organizationId, entityId, kind, action, recipients, subject, resendId, error } = args
  try {
    await writeAuditLog({
      organizationId,
      // No acting user on any of the three paths: two run detached from a
      // request (after(), cron) and the third is an admin whose identity the
      // recipient already is. Nullable column, honest value.
      userId: null,
      action,
      entityType: NOTIFICATION_ENTITY_TYPE,
      entityId: entityId ?? null,
      metadata: {
        kind,
        provider: emailProviderName(),
        recipients,
        subject,
        ...(resendId !== undefined ? { resendId: resendId ?? null } : {}),
        ...(error ? { error } : {}),
      },
    })
  } catch (err) {
    console.error(`[notify-log] ${action} (${kind}) audit write failed:`, err)
  }
}

// ── Reading ─────────────────────────────────────────────────────────────────

export type EmailLogStatus =
  | "delivered"
  | "bounced"
  | "complained"
  | "delayed"
  | "sent"
  | "logged only"
  | "unknown"
  | "failed"

export type EmailLogEntry = {
  id: string
  at: Date
  kind: string
  kindLabel: string
  recipients: string[]
  subject: string | null
  provider: string | null
  status: EmailLogStatus
  /** The send error, or the bounce/complaint reason where the event carried one. */
  detail: string | null
}

const DELIVERY_STATUS: Record<string, EmailLogStatus> = {
  [ACTION_DELIVERED]: "delivered",
  [ACTION_BOUNCED]: "bounced",
  [ACTION_COMPLAINED]: "complained",
  [ACTION_DELAYED]: "delayed",
}

function meta(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []
}

/**
 * The newest `limit` attempts for an org, each resolved against its delivery
 * events. F2 (Gary, 2026-09-20): a count, not a window — it is a glance
 * surface, so "the last 50" always fills the card, where "the last 30 days"
 * shows an empty list to any org that had a quiet month.
 */
export async function listRecentEmails(organizationId: string, limit = 50): Promise<EmailLogEntry[]> {
  const attempts = await prisma.auditLog.findMany({
    where: {
      organizationId,
      entityType: NOTIFICATION_ENTITY_TYPE,
      action: { in: [...ATTEMPT_ACTIONS] },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, action: true, metadata: true, createdAt: true },
  })
  if (attempts.length === 0) return []

  // Correlate by resendId (F3). A JSON-path filter rather than a column,
  // because this phase adds no schema — and the same `metadata: { path: [...] }`
  // filter is already in production at api/forecasting/audit/route.ts:53 on
  // this Prisma and this Postgres, so it is a proven shape rather than a bet.
  const ids = [
    ...new Set(
      attempts.map((a) => str(meta(a.metadata).resendId)).filter((x): x is string => x !== null)
    ),
  ]

  // Latest event WINS, and "latest" is by the row's own createdAt rather than
  // the provider's event timestamp: a delayed-then-delivered pair must resolve
  // to delivered, and the order rows arrived in is the order Resend decided
  // them in. Rows are read newest-first so the first hit per id is the winner.
  const latestByResendId = new Map<string, { action: string; reason: string | null }>()
  if (ids.length > 0) {
    const events = await prisma.auditLog.findMany({
      where: {
        organizationId,
        entityType: NOTIFICATION_ENTITY_TYPE,
        action: { in: [...DELIVERY_ACTIONS] },
        OR: ids.map((id) => ({ metadata: { path: ["resendId"], equals: id } })),
      },
      orderBy: { createdAt: "desc" },
      select: { action: true, metadata: true },
    })
    for (const e of events) {
      const id = str(meta(e.metadata).resendId)
      if (id && !latestByResendId.has(id)) {
        latestByResendId.set(id, { action: e.action, reason: str(meta(e.metadata).reason) })
      }
    }
  }

  return attempts.map((a) => {
    const m = meta(a.metadata)
    const kind = str(m.kind) ?? "unknown"
    const provider = str(m.provider)
    const resendId = str(m.resendId)
    const event = resendId ? latestByResendId.get(resendId) : undefined

    let status: EmailLogStatus
    let detail: string | null = null
    if (a.action === ACTION_FAILED) {
      status = "failed"
      detail = str(m.error)
    } else if (event) {
      status = DELIVERY_STATUS[event.action] ?? "sent"
      detail = event.reason
    } else if (provider === "resend") {
      status = "sent"
    } else if (provider === null) {
      // PRE-NOTIFY-2a ROWS CANNOT BE BACKFILLED and must not be guessed at.
      // A MISSING `provider` IS UNKNOWN, NOT CONSOLE — ruled in
      // docs/DEPLOY_LOG.md at the NOTIFY-2a entry, and it is a real
      // distinction: reading these as console would claim mail that did reach
      // an inbox never left the building, and reading them as sent would claim
      // the opposite. The row genuinely does not say. So the page does not
      // either.
      status = "unknown"
      detail = "sent before the channel was recorded"
    } else {
      status = "logged only"
    }

    return {
      id: a.id,
      at: a.createdAt,
      kind,
      kindLabel: KIND_LABELS[kind] ?? kind,
      recipients: strings(m.recipients),
      subject: str(m.subject),
      provider,
      status,
      detail,
    }
  })
}

/**
 * The attempt row a Resend delivery event belongs to, found by the provider's
 * message id. Returns null when Froot has no record of that send.
 */
export async function findAttemptByResendId(
  resendId: string
): Promise<{ organizationId: string; entityId: string | null; kind: string | null } | null> {
  const row = await prisma.auditLog.findFirst({
    where: {
      entityType: NOTIFICATION_ENTITY_TYPE,
      action: { in: [...ATTEMPT_ACTIONS] },
      metadata: { path: ["resendId"], equals: resendId },
    },
    orderBy: { createdAt: "desc" },
    select: { organizationId: true, entityId: true, metadata: true },
  })
  if (!row) return null
  return { organizationId: row.organizationId, entityId: row.entityId, kind: str(meta(row.metadata).kind) }
}

/** True when this exact (resendId, action) pair has already been recorded. */
export async function deliveryEventExists(resendId: string, action: string): Promise<boolean> {
  const existing = await prisma.auditLog.findFirst({
    where: {
      entityType: NOTIFICATION_ENTITY_TYPE,
      action,
      metadata: { path: ["resendId"], equals: resendId },
    },
    select: { id: true },
  })
  return existing !== null
}

/** Append one delivery-event row. Never throws — Svix retries on a non-2xx. */
export async function recordDeliveryEvent(args: {
  organizationId: string
  entityId: string | null
  action: string
  resendId: string
  kind: string | null
  recipients: string[]
  reason?: string | null
  at?: string | null
}): Promise<void> {
  await writeAuditLog({
    organizationId: args.organizationId,
    userId: null,
    action: args.action,
    entityType: NOTIFICATION_ENTITY_TYPE,
    entityId: args.entityId,
    metadata: {
      resendId: args.resendId,
      // Copied from the attempt row so a delivery row is legible on its own —
      // the page joins, but a human reading raw AuditLog should not have to.
      ...(args.kind ? { kind: args.kind } : {}),
      recipients: args.recipients,
      ...(args.reason ? { reason: args.reason } : {}),
      ...(args.at ? { at: args.at } : {}),
    },
  })
}
