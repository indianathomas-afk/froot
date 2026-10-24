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
import { deliveryMode, emailProviderName, type DeliveryMode } from "@/lib/notify"
import { kindLabel } from "@/lib/notifications/registry"

export const NOTIFICATION_ENTITY_TYPE = "Notification"

export const ACTION_SENT = "email.sent"
export const ACTION_FAILED = "email.failed"
export const ACTION_DELIVERED = "email.delivered"
export const ACTION_BOUNCED = "email.bounced"
export const ACTION_COMPLAINED = "email.complained"
export const ACTION_DELAYED = "email.delayed"
// NOTIFY-5. Written INSTEAD of `email.sent` when deliveryMode() is "dry-run"
// (or a sandbox send whose allowlist filtered everyone out). It is a record of
// an email that was composed and deliberately NOT handed to any provider —
// never a claim that one was sent.
export const ACTION_DRY_RUN = "email.dryrun"

/** The rows an admin's "Recent emails" list is built from — one per attempt. */
export const ATTEMPT_ACTIONS = [ACTION_SENT, ACTION_FAILED, ACTION_DRY_RUN] as const
/**
 * The attempts a PROVIDER could have produced a message id for. NOTIFY-5 keeps
 * this separate from ATTEMPT_ACTIONS on purpose: a dry-run row never carries a
 * resendId, so the JSON-path filter alone would already exclude it — but that
 * is an accident of shape, and findAttemptByResendId says it explicitly.
 */
export const PROVIDER_ATTEMPT_ACTIONS = [ACTION_SENT, ACTION_FAILED] as const
/** Rows written by the Resend webhook, correlated to an attempt by resendId. */
export const DELIVERY_ACTIONS = [
  ACTION_DELIVERED,
  ACTION_BOUNCED,
  ACTION_COMPLAINED,
  ACTION_DELAYED,
] as const

export type NotificationKind = "hr.ack" | "pace.alert" | "test"

// MS-4b: THE READER LABELS FROM THE REGISTRY (kindLabel), so a new kind is
// labelled by its own definition. This map is no longer read and is kept for
// one release; every key in it is also a registry entry with the same label.
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
  action: typeof ACTION_SENT | typeof ACTION_FAILED | typeof ACTION_DRY_RUN
  recipients: string[]
  /**
   * NOTIFY-12: why the recipient got it ("role", "extra-user",
   * "extra-contact"). Only the dispatcher sets it. Lives until NOTIFY-9 stops
   * this row; NotificationMessage.recipientReasons is the durable copy.
   */
  reasons?: string[]
  subject: string
  resendId?: string | null
  error?: string
  /** NOTIFY-5: sandbox only — how many resolved recipients the allowlist held back. */
  withheld?: number
  /**
   * NOTIFY-6: set on the PARALLEL row the dispatcher writes for each
   * NotificationMessage (one release; NOTIFY-9 stops it). It is what tells the
   * reader a row is a copy of a pipeline message rather than pre-pipeline
   * history.
   */
  notificationMessageId?: string
}): Promise<void> {
  const { organizationId, entityId, kind, action, recipients, reasons, subject, resendId, error, withheld, notificationMessageId } = args
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
        // NOTIFY-5: stamped here, like provider, so no caller can forget it.
        mode: currentModeOrNull(),
        recipients,
        ...(reasons !== undefined ? { reasons } : {}),
        subject,
        ...(resendId !== undefined ? { resendId: resendId ?? null } : {}),
        ...(error ? { error } : {}),
        ...(withheld !== undefined ? { withheld } : {}),
        ...(notificationMessageId ? { notificationMessageId } : {}),
      },
    })
  } catch (err) {
    console.error(`[notify-log] ${action} (${kind}) audit write failed:`, err)
  }
}

// deliveryMode() THROWS on an unknown provider, and recordEmailAttempt runs on
// exactly that failure path (the test route records the 502). This function
// must never throw, so an invalid provider is recorded as mode null — the row's
// `provider` field already names the bad value.
function currentModeOrNull(): DeliveryMode | null {
  try {
    return deliveryMode()
  } catch {
    return null
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
  | "dry run"
  | "unknown"
  | "failed"

export type EmailLogEntry = {
  id: string
  /**
   * NOTIFY-6. "pipeline" rows are NotificationMessage rows, one per recipient.
   * "legacy" rows are pre-pipeline AuditLog attempts, shown beneath as history
   * with their NOTIFY-2a / NOTIFY-5 derivations untouched.
   */
  section: "pipeline" | "legacy"
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
 * NOTIFY-6: what "Recent emails" shows. The newest `limit` NotificationMessage
 * rows — ONE PER RECIPIENT, so a bounce marks one person — each resolved
 * against its latest NotificationEvent; then, beneath them, up to `limit`
 * pre-pipeline AuditLog attempts as history.
 *
 * "PRE-PIPELINE" MEANS OLDER THAN THE ORG'S FIRST NotificationMessage. Every
 * AuditLog attempt written after that is the dispatcher's parallel copy of a
 * message already listed above, so it is excluded by that cutoff — and by its
 * `notificationMessageId`, belt and braces — rather than shown twice.
 *
 * F2 (Gary, 2026-09-20) still holds: a count, not a window.
 */
export async function listRecentEmails(organizationId: string, limit = 50): Promise<EmailLogEntry[]> {
  const messages = await prisma.notificationMessage.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      createdAt: true,
      kind: true,
      mode: true,
      provider: true,
      to: true,
      subject: true,
      status: true,
      error: true,
      intentId: true,
      intent: { select: { state: true, attempts: true } },
      // Latest event WINS, by the row's own createdAt — the NOTIFY-2b rule.
      events: { orderBy: { createdAt: "desc" }, take: 1, select: { type: true, reason: true } },
    },
  })

  // The "gave up" note goes on the NEWEST failed row of a failed intent only
  // (audit C5): that is the row an admin reads first.
  const gaveUpNoted = new Set<string>()
  const pipeline: EmailLogEntry[] = messages.map((m) => {
    let status: EmailLogStatus
    let detail: string | null = null
    const event = m.events[0]
    if (m.status === "failed") {
      status = "failed"
      detail = m.error
      if (m.intentId && m.intent?.state === "failed" && !gaveUpNoted.has(m.intentId)) {
        gaveUpNoted.add(m.intentId)
        detail = `${detail ?? "send failed"} — gave up after ${m.intent.attempts} attempts`
      }
    } else if (m.status === "dry-run") {
      status = "dry run"
      // NOTIFY-11. The dispatcher names a provider on a dry-run row only when
      // the transport was sandbox, so a non-console provider here means the
      // allowlist held this address back. Rows from before NOTIFY-11 say
      // "console" whatever happened, and get no detail.
      if (m.mode === "dry-run" && m.provider !== "console") {
        detail = "Held back by the staging allowlist (NOTIFY_SANDBOX_ALLOWLIST)"
      }
    } else if (event) {
      status = DELIVERY_STATUS[event.type] ?? "sent"
      detail = event.reason
    } else {
      status = "sent"
    }
    return {
      id: m.id,
      section: "pipeline",
      at: m.createdAt,
      kind: m.kind,
      kindLabel: kindLabel(m.kind),
      recipients: [m.to],
      subject: m.subject,
      provider: m.provider,
      status,
      detail,
    }
  })

  const first = await prisma.notificationMessage.findFirst({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  })
  const legacy = await listLegacyEmails(organizationId, limit, first?.createdAt ?? null)
  return [...pipeline, ...legacy]
}

/**
 * The pre-pipeline log: the newest `limit` AuditLog attempts for an org, each
 * resolved against its delivery events. THIS IS THE NOTIFY-2b/NOTIFY-5 READER,
 * MOVED UNCHANGED — the "unknown" and "Logged only" derivations below are
 * rulings and must not drift. `before` is the org's first pipeline message
 * (NOTIFY-6); rows from then on are parallel copies and are not history.
 */
async function listLegacyEmails(
  organizationId: string,
  limit: number,
  before: Date | null
): Promise<EmailLogEntry[]> {
  const fetched = await prisma.auditLog.findMany({
    where: {
      organizationId,
      entityType: NOTIFICATION_ENTITY_TYPE,
      action: { in: [...ATTEMPT_ACTIONS] },
      ...(before ? { createdAt: { lt: before } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, action: true, metadata: true, createdAt: true },
  })
  const attempts = fetched.filter((a) => !str(meta(a.metadata).notificationMessageId))
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
    } else if (a.action === ACTION_DRY_RUN) {
      // NOTIFY-5. Checked before any provider rule: a dry-run row is never a
      // send, whatever provider was configured when it was written.
      status = "dry run"
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
      section: "legacy",
      at: a.createdAt,
      kind,
      kindLabel: kindLabel(kind),
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
      action: { in: [...PROVIDER_ATTEMPT_ACTIONS] },
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

// ── NOTIFY-6: webhook correlation against NotificationMessage ───────────────

/**
 * The pipeline message a Resend event belongs to, by its INDEXED provider id
 * (NOTIFY-3 audit finding 2 — the AuditLog JSON-path lookup scanned every org).
 * Null for a pre-pipeline send; the webhook then falls back to
 * findAttemptByResendId.
 */
export async function findMessageByProviderId(providerMessageId: string): Promise<{
  id: string
  organizationId: string
  kind: string
  to: string
  entityId: string | null
} | null> {
  const row = await prisma.notificationMessage.findUnique({
    where: { providerMessageId },
    select: { id: true, organizationId: true, kind: true, to: true, intent: { select: { entityId: true } } },
  })
  if (!row) return null
  return { id: row.id, organizationId: row.organizationId, kind: row.kind, to: row.to, entityId: row.intent?.entityId ?? null }
}

/**
 * Append one NotificationEvent. Idempotent on (message, type): returns false
 * when that pair was already recorded (a Svix retry). Append, never update.
 */
export async function recordMessageEvent(args: {
  messageId: string
  type: string
  reason?: string | null
  at?: string | null
}): Promise<boolean> {
  const parsed = args.at ? new Date(args.at) : null
  try {
    await prisma.notificationEvent.create({
      data: {
        messageId: args.messageId,
        type: args.type,
        reason: args.reason ?? null,
        // The provider's timestamp, or receipt time when it sent none (choice 15).
        at: parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date(),
      },
    })
    return true
  } catch (e) {
    if (typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002") return false
    throw e
  }
}
