// ─── NOTIFY-6: enqueue and dispatch — the one path every email takes ─────────
// docs/prompts/2026-10-18_NOTIFY-6_AUDIT.md.
//
//   producer ──► enqueueNotification ──► NotificationIntent (the ledger)
//                                             │
//   inline / daily cron / hourly sweep ──► dispatchNotifications
//        freshness → org switch → recipients (resolver → can() → exclude →
//        lower-case de-dup → drop anyone with a `sent` delivery, P6) → mode per
//        recipient → render → ONE MESSAGE PER RECIPIENT → record
//
// A PRODUCER NEVER SENDS. It records that something happened and calls
// dispatch; this file alone decides who hears about it and whether mail leaves.
//
// THE MODE RULES (NOTIFY-5's table, unchanged — deliveryMode() still decides):
//   live     every resolved recipient is sent to, and a NotificationDelivery
//            row records each result. Only live moves an intent's state.
//   sandbox  real mail ONLY to sandboxAllows() addresses (and a test send's
//            caller); everyone else is dry-run. NO delivery row, NO state change
//            — staging can never consume anything (P2).
//   dry-run  rendered, logged, recorded "Dry run — not sent". NO delivery row,
//            NO state change. Written at most once per (intent, recipient), so a
//            store behind all month logs its dry run once, not daily.
//
// THE SWEEP NEVER MAKES A SANDBOX SEND (R2, approved 2026-10-18). A sandbox send
// leaves the intent queued by design, so without this rule the hourly sweep
// would re-mail the allowlist every hour until the intent expired. Dispatches a
// producer starts (a hand-fired cron, a signing, the test button) still re-send
// — NOTIFY-5 choice 4, ratified: "Every hand-fire on staging re-sends to the
// allow-listed addresses."
//
// CONCURRENCY (audit C8): the NotificationDelivery @@unique([intentId,
// recipient]) row is the per-recipient lock. It is claimed as `pending` BEFORE
// the provider call, by an insert (P2002 = someone else has it) or by a
// state-guarded update of a `failed` row (count 0 = someone else has it), and
// settled to `sent`/`failed` after. Two dispatches of one intent cannot mail one
// person twice. A `pending` row older than STALE_PENDING_MS belonged to a
// dispatcher that died mid-send and is reclaimed (audit choice 2).
//
// NOTHING HERE THROWS TO A CALLER. enqueue logs and returns null; dispatch
// records a per-intent error and moves on. The signing path calls both.

import { Prisma, type NotificationIntent } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
  consoleEmailSender,
  deliveryMode,
  emailProviderName,
  getEmailSender,
  sandboxAllows,
  type DeliveryMode,
  type EmailSender,
} from "@/lib/notify"
import {
  ACTION_DRY_RUN,
  ACTION_FAILED,
  ACTION_SENT,
  recordEmailAttempt,
  type NotificationKind,
} from "@/lib/notification-log"
import { can, grantsFrom, overridesFrom } from "@/lib/permissions"
import {
  getKind,
  type IntentState,
  type KindIntent,
  type NotificationKindDef,
  type NotificationOrg,
  type Rendered,
  type ResolvedRecipient,
} from "./registry"

// Audit C5: five attempts, then `failed`. Backoff after attempt n is
// BACKOFF_HOURS[n-1]; the whole schedule spans ~15 h, inside pace's day.
export const MAX_ATTEMPTS = 5
export const BACKOFF_HOURS = [1, 2, 4, 8] as const
/** A `pending` delivery older than this belonged to a dispatcher that died. */
export const STALE_PENDING_MS = 15 * 60 * 1000

const DISPATCHABLE: IntentState[] = ["queued", "partial"]

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"
}

function errorText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 1000)
}

// ── Transport ────────────────────────────────────────────────────────────────

/**
 * How a dispatch may send: the mode, and a sender built only when a real send
 * happens. REQUIRED by dispatchNotifications rather than read inside it, for
 * NOTIFY-5 choice 1's reason — no fixture can become a dry-run test by
 * accident, and a cron resolves it once so one run cannot mix modes.
 */
export type Transport = { mode: DeliveryMode; sender: () => EmailSender }

/**
 * From the environment. THROWS on an unknown NOTIFY_EMAIL_PROVIDER (as
 * deliveryMode() does). The sender is lazy, so dry-run never needs Resend config
 * — and getEmailSender() still fails closed the moment a real send needs it.
 */
export function resolveTransport(): Transport {
  const mode = deliveryMode()
  let built: EmailSender | null = null
  return { mode, sender: () => (built ??= getEmailSender()) }
}

export type DispatchTrigger = "producer" | "sweep"

// ── Enqueue ──────────────────────────────────────────────────────────────────

export type EnqueueArgs = {
  organizationId: string
  kind: string
  dedupeKey: string
  entityId?: string | null
  eventAt: Date
  payload: Prisma.InputJsonValue
}

export type EnqueueResult = { intentId: string; state: IntentState; created: boolean; refreshed: boolean }

/**
 * Upsert on (organizationId, kind, dedupeKey):
 *   no row                    → create `queued`
 *   sent / partial / known    → NO-OP. Sent stays sent (Gary's MS-4a ruling,
 *                               now true for every kind); a partial intent is
 *                               the retry's to finish, not the producer's.
 *   queued / expired          → refreshed: payload and eventAt replaced,
 *                               state queued, nextAttemptAt cleared (a producer
 *                               re-raising the event is a fresh chance).
 *   failed                    → NO-OP. It gave up at the retry cap.
 *
 * NEVER THROWS. Returns null when the write itself failed, after logging it.
 */
export async function enqueueNotification(args: EnqueueArgs): Promise<EnqueueResult | null> {
  try {
    return await enqueueOnce(args, true)
  } catch (err) {
    console.error(`[notify] enqueue ${args.kind} ${args.dedupeKey} org=${args.organizationId} failed:`, err)
    return null
  }
}

async function enqueueOnce(args: EnqueueArgs, retryOnRace: boolean): Promise<EnqueueResult> {
  const { organizationId, kind, dedupeKey, entityId, eventAt, payload } = args
  const existing = await prisma.notificationIntent.findUnique({
    where: { organizationId_kind_dedupeKey: { organizationId, kind, dedupeKey } },
    select: { id: true, state: true },
  })
  if (!existing) {
    try {
      const row = await prisma.notificationIntent.create({
        data: { organizationId, kind, dedupeKey, entityId: entityId ?? null, eventAt, payload, state: "queued" },
        select: { id: true },
      })
      return { intentId: row.id, state: "queued", created: true, refreshed: false }
    } catch (e) {
      // A concurrent enqueue of the same key won the insert; take its row.
      if (isUniqueViolation(e) && retryOnRace) return enqueueOnce(args, false)
      throw e
    }
  }
  if (existing.state === "queued" || existing.state === "expired") {
    const n = await prisma.notificationIntent.updateMany({
      where: { id: existing.id, state: { in: ["queued", "expired"] } },
      data: { payload, eventAt, entityId: entityId ?? null, state: "queued", nextAttemptAt: null },
    })
    if (n.count === 1) return { intentId: existing.id, state: "queued", created: false, refreshed: true }
    // A dispatch moved it between the read and the write; report what it is now.
    const now = await prisma.notificationIntent.findUnique({ where: { id: existing.id }, select: { state: true } })
    return { intentId: existing.id, state: (now?.state ?? existing.state) as IntentState, created: false, refreshed: false }
  }
  return { intentId: existing.id, state: existing.state as IntentState, created: false, refreshed: false }
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

export type RecipientResult = {
  to: string
  mode: DeliveryMode
  status: "sent" | "failed" | "dry-run" | "skipped"
  providerMessageId?: string
  error?: string
  /** Why a recipient was skipped (already logged, in flight elsewhere, …). */
  reason?: string
}

export type IntentDispatchResult = {
  intentId: string
  organizationId: string
  kind: string
  /** The intent's state after this dispatch, or "skipped" when nothing ran. */
  outcome: IntentState | "skipped"
  reason: string
  /** How many recipients the kind's resolver returned, before any filter. */
  candidates: number
  /** After can(), exclude and de-dup — who the email is for. */
  eligible: number
  recipients: RecipientResult[]
  /** Sandbox only: eligible recipients the allowlist held back. */
  withheld: number
}

/**
 * Dispatch every dispatchable intent matching the filters: state queued or
 * partial, and nextAttemptAt unset or passed. Sequential, never throws.
 */
export async function dispatchNotifications(opts: {
  transport: Transport
  trigger: DispatchTrigger
  organizationId?: string
  kinds?: string[]
  intentIds?: string[]
  now?: Date
  limit?: number
}): Promise<IntentDispatchResult[]> {
  const now = opts.now ?? new Date()
  const intents = await prisma.notificationIntent.findMany({
    where: {
      state: { in: DISPATCHABLE },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
      ...(opts.kinds ? { kind: { in: opts.kinds } } : {}),
      ...(opts.intentIds ? { id: { in: opts.intentIds } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: opts.limit ?? 500,
  })

  const results: IntentDispatchResult[] = []
  for (const intent of intents) {
    try {
      results.push(await dispatchOne(intent, opts.transport, opts.trigger, now))
    } catch (err) {
      const msg = errorText(err)
      console.error(`[notify] intent=${intent.id} kind=${intent.kind} dispatch threw: ${msg}`)
      await prisma.notificationIntent
        .update({ where: { id: intent.id }, data: { lastError: msg } })
        .catch(() => {})
      results.push({
        intentId: intent.id,
        organizationId: intent.organizationId,
        kind: intent.kind,
        outcome: "skipped",
        reason: `error: ${msg.slice(0, 200)}`,
        candidates: 0,
        eligible: 0,
        recipients: [],
        withheld: 0,
      })
    }
  }
  return results
}

type IntentRow = NotificationIntent

const ORG_SELECT = { id: true, name: true, timezone: true, paceAlertsEnabled: true, hrAckRecipients: true } as const

function toKindIntent(intent: IntentRow): KindIntent<unknown> {
  return {
    id: intent.id,
    organizationId: intent.organizationId,
    kind: intent.kind,
    dedupeKey: intent.dedupeKey,
    entityId: intent.entityId,
    eventAt: intent.eventAt,
    payload: intent.payload,
  }
}

/** Resolver → can() → exclude → lower-cased de-dup. */
async function eligibleRecipients(
  def: NotificationKindDef<unknown>,
  ki: KindIntent<unknown>,
  org: NotificationOrg
): Promise<{ candidates: number; eligible: ResolvedRecipient[] }> {
  const resolved = await def.resolveRecipients(ki, org)
  const seen = new Set<string>()
  const eligible: ResolvedRecipient[] = []
  for (const r of resolved) {
    const key = r.email.trim().toLowerCase()
    if (!key) continue
    if (
      def.capability &&
      r.user &&
      !can(
        {
          role: r.user.role,
          overrides: overridesFrom(r.user.deniedCapabilities),
          grants: grantsFrom(r.user.grantedCapabilities),
        },
        def.capability
      )
    ) {
      continue
    }
    if (def.exclude?.(ki, r)) continue
    if (seen.has(key)) continue
    seen.add(key)
    eligible.push({ ...r, email: key })
  }
  return { candidates: resolved.length, eligible }
}

function safeRender(def: NotificationKindDef<unknown>, payload: unknown, org: NotificationOrg, to: string): Rendered {
  try {
    return def.render(payload, org, to)
  } catch (err) {
    return { subject: def.label, error: `render failed: ${errorText(err)}` }
  }
}

async function expire(intentId: string, from: IntentState[], reason: string): Promise<void> {
  await prisma.notificationIntent.updateMany({
    where: { id: intentId, state: { in: from } },
    data: { state: "expired", lastError: reason, nextAttemptAt: null },
  })
}

async function dispatchOne(
  intent: IntentRow,
  transport: Transport,
  trigger: DispatchTrigger,
  now: Date
): Promise<IntentDispatchResult> {
  const result: IntentDispatchResult = {
    intentId: intent.id,
    organizationId: intent.organizationId,
    kind: intent.kind,
    outcome: intent.state as IntentState,
    reason: "",
    candidates: 0,
    eligible: 0,
    recipients: [],
    withheld: 0,
  }
  const def = getKind(intent.kind)
  if (!def) return { ...result, outcome: "skipped", reason: `unknown kind "${intent.kind}"` }
  const ki = toKindIntent(intent)

  // 1. Freshness — queued only. A partial intent already reached someone and
  //    retries until the cap whatever its age (audit choice 4).
  if (intent.state === "queued" && now.getTime() - intent.eventAt.getTime() > def.freshnessMinutes * 60_000) {
    await expire(intent.id, ["queued"], "past the freshness window")
    return { ...result, outcome: "expired", reason: "past the freshness window" }
  }

  // 2. The org switch — queued and partial alike.
  const org = await prisma.organization.findUnique({ where: { id: intent.organizationId }, select: ORG_SELECT })
  if (!org) return { ...result, outcome: "skipped", reason: "organization not found" }
  if (!def.enabled(org)) {
    await expire(intent.id, DISPATCHABLE, "switched off for this organization")
    return { ...result, outcome: "expired", reason: "switched off for this organization" }
  }

  // 3. Recipients, resolved now, never cached.
  const { candidates, eligible } = await eligibleRecipients(def, ki, org)
  result.candidates = candidates
  result.eligible = eligible.length
  if (eligible.length === 0) return { ...result, reason: "no eligible recipients" }

  const deliveries = await prisma.notificationDelivery.findMany({
    where: { intentId: intent.id },
    select: { id: true, recipient: true, state: true, updatedAt: true },
  })
  const deliveryOf = new Map(deliveries.map((d) => [d.recipient, d]))
  // P6 (Gary, 2026-10-18): "retry only the recipients who didn't get it."
  // ENFORCED TWICE, deliberately: this filter, and claim() below, which never
  // re-claims a `sent` row. The fixture tests each on its own.
  const remaining = eligible.filter((r) => deliveryOf.get(r.email)?.state !== "sent")

  // 4. Mode, per recipient.
  const modeFor = (email: string): DeliveryMode =>
    transport.mode === "live"
      ? "live"
      : transport.mode === "sandbox" && (def.sandboxBypass || sandboxAllows(email))
        ? "sandbox"
        : "dry-run"
  if (transport.mode === "sandbox") result.withheld = eligible.filter((r) => modeFor(r.email) === "dry-run").length

  // What dry-run and sandbox have already written for this intent, so dry-run
  // logs once per (intent, recipient) and the sweep never re-sends in sandbox.
  const prior = transport.mode === "live"
    ? []
    : await prisma.notificationMessage.findMany({
        where: { intentId: intent.id, mode: { in: ["dry-run", "sandbox"] } },
        select: { to: true, mode: true },
      })
  const priorKey = new Set(prior.map((m) => `${m.mode}:${m.to}`))

  const provider = emailProviderName()
  const record = (args: {
    to: string
    mode: DeliveryMode
    status: "sent" | "failed" | "dry-run"
    subject: string
    providerMessageId?: string | null
    error?: string
  }) => writeMessage({ intent, provider, withheld: transport.mode === "sandbox" ? result.withheld : undefined, ...args })

  // 5–7. Render, one message per recipient, record.
  for (const r of remaining) {
    const mode = modeFor(r.email)
    const rendered = safeRender(def, intent.payload, org, r.email)

    if (mode === "dry-run") {
      if (priorKey.has(`dry-run:${r.email}`)) {
        result.recipients.push({ to: r.email, mode, status: "skipped", reason: "dry run already logged" })
        continue
      }
      if ("error" in rendered) {
        await record({ to: r.email, mode, status: "failed", subject: rendered.subject, error: rendered.error })
        result.recipients.push({ to: r.email, mode, status: "failed", error: rendered.error })
        continue
      }
      // Printed through the console sender whatever the provider: nothing here
      // may reach Resend (NOTIFY-5 choice 6 keeps the [notify:console] line).
      await consoleEmailSender.send({ to: r.email, subject: rendered.subject, text: rendered.text, html: rendered.html })
      await record({ to: r.email, mode, status: "dry-run", subject: rendered.subject })
      result.recipients.push({ to: r.email, mode, status: "dry-run" })
      continue
    }

    if (mode === "sandbox") {
      if (trigger === "sweep" && priorKey.has(`sandbox:${r.email}`)) {
        result.recipients.push({ to: r.email, mode, status: "skipped", reason: "the sweep never re-sends in sandbox" })
        continue
      }
      const sent = await sendOne(transport, r.email, rendered)
      await record({ to: r.email, mode, subject: rendered.subject, ...sent })
      result.recipients.push({ to: r.email, mode, ...sent })
      continue
    }

    // live: claim the delivery row, send, settle.
    const deliveryId = await claim(intent.id, r, deliveryOf.get(r.email), now)
    if (!deliveryId) {
      result.recipients.push({ to: r.email, mode, status: "skipped", reason: "being sent by another dispatch" })
      continue
    }
    const sent = await sendOne(transport, r.email, rendered)
    const messageId = await record({ to: r.email, mode, subject: rendered.subject, ...sent })
    await prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: { state: sent.status, messageId, error: sent.error ?? null },
    })
    result.recipients.push({ to: r.email, mode, ...sent })
  }

  // Dry-run and sandbox NEVER change an intent's state (NOTIFY-5, structural).
  if (transport.mode !== "live") {
    result.reason = transport.mode
    return result
  }
  return finalize(intent, def, ki, eligible, result, now)
}

async function sendOne(
  transport: Transport,
  to: string,
  rendered: Rendered
): Promise<{ status: "sent" | "failed"; providerMessageId?: string; error?: string }> {
  if ("error" in rendered) return { status: "failed", error: rendered.error }
  try {
    // ONE RECIPIENT PER MESSAGE, never a shared `to:` (NOTIFY-3 audit finding 1).
    const { id } = await transport.sender().send({ to, subject: rendered.subject, text: rendered.text, html: rendered.html })
    return { status: "sent", ...(id ? { providerMessageId: id } : {}) }
  } catch (err) {
    return { status: "failed", error: errorText(err) }
  }
}

/** Claim one recipient's delivery row as `pending`. Null = someone else has it. */
async function claim(
  intentId: string,
  r: ResolvedRecipient,
  existing: { id: string; state: string; updatedAt: Date } | undefined,
  now: Date
): Promise<string | null> {
  if (!existing) {
    try {
      const row = await prisma.notificationDelivery.create({
        data: { intentId, recipient: r.email, userId: r.user?.id ?? null, state: "pending" },
        select: { id: true },
      })
      return row.id
    } catch (e) {
      if (isUniqueViolation(e)) return null
      throw e
    }
  }
  if (existing.state === "failed") {
    const n = await prisma.notificationDelivery.updateMany({
      where: { id: existing.id, state: "failed" },
      data: { state: "pending", error: null },
    })
    return n.count === 1 ? existing.id : null
  }
  if (existing.state === "pending" && now.getTime() - existing.updatedAt.getTime() > STALE_PENDING_MS) {
    // Guarded on the timestamp read, so two dispatchers cannot both reclaim it.
    const n = await prisma.notificationDelivery.updateMany({
      where: { id: existing.id, state: "pending", updatedAt: existing.updatedAt },
      data: { state: "pending", error: null },
    })
    return n.count === 1 ? existing.id : null
  }
  return null
}

/** Decide the intent's state from its delivery rows — not from what this call did. */
async function finalize(
  intent: IntentRow,
  def: NotificationKindDef<unknown>,
  ki: KindIntent<unknown>,
  eligible: ResolvedRecipient[],
  result: IntentDispatchResult,
  now: Date
): Promise<IntentDispatchResult> {
  const rows = await prisma.notificationDelivery.findMany({
    where: { intentId: intent.id },
    select: { recipient: true, state: true, updatedAt: true, error: true },
  })
  const rowOf = new Map(rows.map((d) => [d.recipient, d]))
  const keys = eligible.map((r) => r.email)
  const sentTo = keys.filter((k) => rowOf.get(k)?.state === "sent")
  const attempted = result.recipients.some((r) => r.status === "sent" || r.status === "failed")
  const inFlight = keys.some((k) => {
    const d = rowOf.get(k)
    return d?.state === "pending" && now.getTime() - d.updatedAt.getTime() <= STALE_PENDING_MS
  })

  if (sentTo.length === keys.length) {
    const n = await prisma.notificationIntent.updateMany({
      where: { id: intent.id, state: { in: DISPATCHABLE } },
      data: {
        state: "sent",
        sentAt: now,
        lastError: null,
        nextAttemptAt: null,
        ...(attempted ? { attempts: { increment: 1 } } : {}),
      },
    })
    // onSent runs once: only the dispatcher whose guarded update moved the row.
    if (n.count === 1 && def.onSent) {
      await def.onSent(ki, sentTo).catch((err) => console.error(`[notify] intent=${intent.id} onSent failed:`, err))
    }
    return { ...result, outcome: "sent", reason: "sent" }
  }

  if (inFlight || !attempted) {
    return { ...result, reason: inFlight ? "another dispatch is still sending" : "nothing attempted" }
  }

  const bumped = await prisma.notificationIntent.update({
    where: { id: intent.id },
    data: { attempts: { increment: 1 } },
    select: { attempts: true },
  })
  const lastError =
    result.recipients.find((r) => r.status === "failed")?.error ??
    rows.find((d) => d.state === "failed")?.error ??
    "send failed"
  const state: IntentState =
    bumped.attempts >= MAX_ATTEMPTS ? "failed" : sentTo.length > 0 ? "partial" : "queued"
  const backoffH = BACKOFF_HOURS[Math.min(bumped.attempts, BACKOFF_HOURS.length) - 1]
  await prisma.notificationIntent.updateMany({
    where: { id: intent.id, state: { in: DISPATCHABLE } },
    data: {
      state,
      lastError,
      nextAttemptAt: state === "failed" ? null : new Date(now.getTime() + backoffH * 3_600_000),
    },
  })
  return {
    ...result,
    outcome: state,
    reason:
      state === "failed"
        ? `gave up after ${bumped.attempts} attempts`
        : `${keys.length - sentTo.length} of ${keys.length} not sent; retry in ${backoffH}h`,
  }
}

// ── Recording ────────────────────────────────────────────────────────────────

const ACTION_FOR = { sent: ACTION_SENT, failed: ACTION_FAILED, "dry-run": ACTION_DRY_RUN } as const

/**
 * One NotificationMessage, plus its parallel AuditLog row (one release; audit
 * choice 6). Returns the message id, or null if the write failed — logged,
 * never thrown: the email it describes has already been sent or not.
 */
async function writeMessage(args: {
  intent: IntentRow
  provider: string
  to: string
  mode: DeliveryMode | "unknown"
  status: "sent" | "failed" | "dry-run"
  subject: string
  providerMessageId?: string | null
  error?: string
  withheld?: number
}): Promise<string | null> {
  const { intent, to, mode, status, subject, providerMessageId, error, withheld } = args
  let messageId: string | null = null
  try {
    const row = await prisma.notificationMessage.create({
      data: {
        organizationId: intent.organizationId,
        kind: intent.kind,
        mode,
        // A dry run was handed to no provider, whatever is configured.
        provider: mode === "dry-run" ? "console" : args.provider,
        providerMessageId: providerMessageId ?? null,
        to,
        subject,
        status,
        error: error ?? null,
        intentId: intent.id,
      },
      select: { id: true },
    })
    messageId = row.id
  } catch (err) {
    console.error(`[notify] intent=${intent.id} message write failed (${status} → ${to}):`, err)
  }
  // Rollback-faithful: the NOTIFY-5 shape, one recipient, this message's own
  // resendId, so a reverted reader and webhook still work on these rows.
  await recordEmailAttempt({
    organizationId: intent.organizationId,
    entityId: intent.entityId,
    kind: intent.kind as NotificationKind,
    action: ACTION_FOR[status],
    recipients: [to],
    subject,
    ...(status === "sent" ? { resendId: providerMessageId ?? null } : {}),
    ...(error ? { error } : {}),
    ...(withheld !== undefined && mode === "sandbox" ? { withheld } : {}),
    ...(messageId ? { notificationMessageId: messageId } : {}),
  })
  return messageId
}

/**
 * The transport itself could not be resolved — NOTIFY_EMAIL_PROVIDER holds an
 * unknown value, so there is no mode. Records a failed message per eligible
 * recipient (mode "unknown") so the send log shows it, and the error on the
 * intent. Not an attempt, and the state does not move: fixing the variable and
 * the next sweep will deliver it. Never throws.
 */
export async function recordUndispatchable(intentId: string, error: string): Promise<string[]> {
  try {
    const intent = await prisma.notificationIntent.findUnique({ where: { id: intentId } })
    const def = intent ? getKind(intent.kind) : undefined
    if (!intent || !def) return []
    const org = await prisma.organization.findUnique({ where: { id: intent.organizationId }, select: ORG_SELECT })
    if (!org) return []
    const { eligible } = await eligibleRecipients(def, toKindIntent(intent), org)
    const provider = emailProviderName()
    for (const r of eligible) {
      const subject = safeRender(def, intent.payload, org, r.email).subject
      await writeMessage({ intent, provider, to: r.email, mode: "unknown", status: "failed", subject, error })
    }
    await prisma.notificationIntent.update({ where: { id: intentId }, data: { lastError: error } })
    return eligible.map((r) => r.email)
  } catch (err) {
    console.error(`[notify] intent=${intentId} could not record the undispatchable failure:`, err)
    return []
  }
}

