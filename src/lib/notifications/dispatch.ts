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
// THE SWEEP NEVER MAKES A SANDBOX SEND — not a re-send and not a first send
// (R2, Gary's words: "the hourly retry never sends in sandbox"). Enforced by
// trigger "sweep" alone, whatever messages already exist (NOTIFY-11: the guard
// once skipped only recipients with a prior sandbox message, so a sweep made a
// first send to an address allow-listed after the signing). A sandbox send
// leaves the intent queued by design, so without this rule the hourly sweep
// would mail the allowlist every hour until the intent expired. Dispatches a
// producer starts (a hand-fired cron, a signing, the test button) still send
// and re-send — NOTIFY-5 choice 4, ratified: "Every hand-fire on staging
// re-sends to the allow-listed addresses." The sweep still writes a dry-run
// log line for a withheld recipient, once per (intent, recipient).
//
// A DRY-RUN ROW NAMES THE PROVIDER ITS DISPATCH RAN UNDER (NOTIFY-11): the
// configured provider when the transport is sandbox (the allowlist held the
// address back), "console" otherwise. Taken from transport.mode, not from the
// environment alone, so "dry run, provider not console" means "withheld by the
// allowlist" for every caller — the reader's detail relies on it.
//
// CONCURRENCY (audit C8): the NotificationDelivery @@unique([intentId,
// recipient]) row is the per-recipient lock. It is claimed as `pending` BEFORE
// the provider call, by an insert (P2002 = someone else has it) or by a
// state-guarded update of a `failed` row (count 0 = someone else has it), and
// settled to `sent`/`failed` after. Two dispatches of one intent cannot mail one
// person twice. A `pending` row older than STALE_PENDING_MS belonged to a
// dispatcher that died mid-send and is reclaimed (audit choice 2).
//
// THE GROUPED MODE (MS-4b ruling 1, Gary 2026-10-19: "one email per person per
// day, via a new grouping mode in the dispatcher"). A kind with batch
// "per-recipient-daily" goes through dispatchGrouped: the same freshness →
// switch → recipients → P6 steps per intent, then every intent due for one
// recipient is rendered into ONE email. Delivery rows stay per (intent,
// recipient) and point at that one message, so P6 holds per item. A summary's
// NotificationMessage leaves intentId null and lists what it covered in
// intentIds (N1(a)) — the only record a dry run has, since dry-run and sandbox
// write no delivery rows. THE SWEEP NEVER MAKES A GROUPED FIRST SEND (MS-4b
// choice C3): it retries intents with attempts > 0 and expires the rest, so a
// first send happens only in the daily producer run and "one per day" holds.
// "per-intent" kinds never reach that code path and behave exactly as before.
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
  type GroupedKindDef,
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

/**
 * MS-4b ruling 2 (Gary, 2026-10-19): "Milestones reached more than 7 days
 * before the job runs are recorded as known without sending." CREATE-ONLY: a
 * `known` row is written only when no intent exists for the key. ANY existing
 * row — queued, expired, sent, partial, failed — is left exactly as it is, so
 * a dry-run intent that aged past the window expires by freshness rather than
 * being relabelled, and nothing `known` is ever dispatched (DISPATCHABLE is
 * queued/partial only). NEVER THROWS; null after logging a failed write.
 */
export async function recordKnownNotification(args: EnqueueArgs): Promise<EnqueueResult | null> {
  const { organizationId, kind, dedupeKey, entityId, eventAt, payload } = args
  try {
    const existing = await prisma.notificationIntent.findUnique({
      where: { organizationId_kind_dedupeKey: { organizationId, kind, dedupeKey } },
      select: { id: true, state: true },
    })
    if (existing) return { intentId: existing.id, state: existing.state as IntentState, created: false, refreshed: false }
    try {
      const row = await prisma.notificationIntent.create({
        data: { organizationId, kind, dedupeKey, entityId: entityId ?? null, eventAt, payload, state: "known" },
        select: { id: true },
      })
      return { intentId: row.id, state: "known", created: true, refreshed: false }
    } catch (e) {
      if (!isUniqueViolation(e)) throw e
      const now = await prisma.notificationIntent.findUnique({
        where: { organizationId_kind_dedupeKey: { organizationId, kind, dedupeKey } },
        select: { id: true, state: true },
      })
      return now ? { intentId: now.id, state: now.state as IntentState, created: false, refreshed: false } : null
    }
  } catch (err) {
    console.error(`[notify] known ${kind} ${dedupeKey} org=${organizationId} failed:`, err)
    return null
  }
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

  // Grouped kinds: one dispatchGrouped call per (org, kind), in first-seen order.
  const groups = new Map<string, { def: GroupedKindDef<unknown>; intents: IntentRow[] }>()
  const perIntent: IntentRow[] = []
  for (const intent of intents) {
    const def = getKind(intent.kind)
    if (def?.batch === "per-recipient-daily") {
      const key = `${intent.organizationId}\u0000${intent.kind}`
      const g = groups.get(key) ?? { def, intents: [] }
      g.intents.push(intent)
      groups.set(key, g)
    } else {
      perIntent.push(intent)
    }
  }
  for (const g of groups.values()) {
    try {
      results.push(...(await dispatchGrouped(g.def, g.intents, opts.transport, opts.trigger, now)))
    } catch (err) {
      const msg = errorText(err)
      console.error(`[notify] grouped ${g.def.kind} org=${g.intents[0].organizationId} dispatch threw: ${msg}`)
      for (const intent of g.intents) {
        await prisma.notificationIntent.update({ where: { id: intent.id }, data: { lastError: msg } }).catch(() => {})
        results.push(skippedResult(intent, `error: ${msg.slice(0, 200)}`))
      }
    }
  }

  for (const intent of perIntent) {
    try {
      results.push(await dispatchOne(intent, opts.transport, opts.trigger, now))
    } catch (err) {
      const msg = errorText(err)
      console.error(`[notify] intent=${intent.id} kind=${intent.kind} dispatch threw: ${msg}`)
      await prisma.notificationIntent
        .update({ where: { id: intent.id }, data: { lastError: msg } })
        .catch(() => {})
      results.push(skippedResult(intent, `error: ${msg.slice(0, 200)}`))
    }
  }
  return results
}

type IntentRow = NotificationIntent

function skippedResult(intent: IntentRow, reason: string): IntentDispatchResult {
  return {
    intentId: intent.id,
    organizationId: intent.organizationId,
    kind: intent.kind,
    outcome: "skipped",
    reason,
    candidates: 0,
    eligible: 0,
    recipients: [],
    withheld: 0,
  }
}

const ORG_SELECT = {
  id: true,
  name: true,
  timezone: true,
  paceAlertsEnabled: true,
  hrAckRecipients: true,
  clerkOrgId: true,
  activeModules: true,
  milestonesEnabled: true,
  milestoneAlertsEnabled: true,
  milestoneSettings: { select: { checklistMilestonesEnabled: true } },
} as const

/** The org as a kind sees it. Null when the row is gone. */
async function loadOrg(organizationId: string): Promise<NotificationOrg | null> {
  const row = await prisma.organization.findUnique({ where: { id: organizationId }, select: ORG_SELECT })
  if (!row) return null
  const { milestoneSettings, ...org } = row
  return { ...org, checklistMilestonesEnabled: milestoneSettings?.checklistMilestonesEnabled ?? false }
}

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
    if (def.exclude && (await def.exclude(ki, r))) continue
    if (seen.has(key)) continue
    seen.add(key)
    eligible.push({ ...r, email: key })
  }
  return { candidates: resolved.length, eligible }
}

function safeRender(def: NotificationKindDef<unknown>, payload: unknown, org: NotificationOrg, to: string): Rendered {
  return def.batch === "per-recipient-daily" ? safeRenderGroup(def, [payload], org, to) : guard(def, () => def.render(payload, org, to))
}

function safeRenderGroup(def: GroupedKindDef<unknown>, payloads: unknown[], org: NotificationOrg, to: string): Rendered {
  return guard(def, () => def.renderGroup(payloads, org, to))
}

function guard(def: NotificationKindDef<unknown>, render: () => Rendered): Rendered {
  try {
    return render()
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
  const org = await loadOrg(intent.organizationId)
  if (!org) return { ...result, outcome: "skipped", reason: "organization not found" }
  if (!def.enabled(org, ki)) {
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

  // What dry-run has already written for this intent, so dry-run logs once per
  // (intent, recipient).
  const prior = transport.mode === "live"
    ? []
    : await prisma.notificationMessage.findMany({
        where: { intentId: intent.id, mode: "dry-run" },
        select: { to: true },
      })
  const dryRunLogged = new Set(prior.map((m) => m.to))

  const provider = emailProviderName()
  // NOTIFY-11. A dry run was handed to no provider; its row names the provider
  // only when the sandbox allowlist is what held it back.
  const dryRunProvider = transport.mode === "sandbox" ? provider : "console"
  const record = (args: {
    to: string
    mode: DeliveryMode
    status: "sent" | "failed" | "dry-run"
    subject: string
    providerMessageId?: string | null
    error?: string
  }) =>
    writeMessage({
      intent,
      provider: args.mode === "dry-run" ? dryRunProvider : provider,
      withheld: transport.mode === "sandbox" ? result.withheld : undefined,
      ...args,
    })

  // 5–7. Render, one message per recipient, record.
  for (const r of remaining) {
    const mode = modeFor(r.email)
    const rendered = safeRender(def, intent.payload, org, r.email)

    if (mode === "dry-run") {
      if (dryRunLogged.has(r.email)) {
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
      if (trigger === "sweep") {
        result.recipients.push({ to: r.email, mode, status: "skipped", reason: "R2: the sweep never sends in sandbox" })
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

// ── Grouped dispatch (MS-4b) ─────────────────────────────────────────────────

type GroupEntry = {
  intent: IntentRow
  ki: KindIntent<unknown>
  result: IntentDispatchResult
  eligible: ResolvedRecipient[]
  deliveryOf: Map<string, { id: string; recipient: string; state: string; updatedAt: Date }>
}

/**
 * Every due intent of ONE grouped kind in ONE org. Steps 1–3 are dispatchOne's,
 * per intent. Then each recipient gets ONE email covering exactly the intents
 * THEY are eligible for — the map is built from each intent's own eligible
 * list, never "every intent to everyone" (MS-4b audit B5 item 6: a Store A
 * manager must never read a Store B employee's milestone).
 */
async function dispatchGrouped(
  def: GroupedKindDef<unknown>,
  intents: IntentRow[],
  transport: Transport,
  trigger: DispatchTrigger,
  now: Date
): Promise<IntentDispatchResult[]> {
  const org = await loadOrg(intents[0].organizationId)
  if (!org) return intents.map((i) => skippedResult(i, "organization not found"))

  const out: IntentDispatchResult[] = []
  const entries: GroupEntry[] = []
  for (const intent of intents) {
    const ki = toKindIntent(intent)
    const result: IntentDispatchResult = { ...skippedResult(intent, ""), outcome: intent.state as IntentState }
    out.push(result)

    // 1. Freshness — queued only, as dispatchOne.
    if (intent.state === "queued" && now.getTime() - intent.eventAt.getTime() > def.freshnessMinutes * 60_000) {
      await expire(intent.id, ["queued"], "past the freshness window")
      Object.assign(result, { outcome: "expired", reason: "past the freshness window" })
      continue
    }
    // 2. The switch — queued and partial alike.
    if (!def.enabled(org, ki)) {
      await expire(intent.id, DISPATCHABLE, "switched off for this organization")
      Object.assign(result, { outcome: "expired", reason: "switched off for this organization" })
      continue
    }
    // C3: the sweep retries; it never makes a grouped FIRST send.
    if (trigger === "sweep" && intent.attempts === 0) {
      result.reason = "first send waits for the daily run"
      continue
    }
    // 3. Recipients, resolved now, never cached.
    const { candidates, eligible } = await eligibleRecipients(def, ki, org)
    result.candidates = candidates
    result.eligible = eligible.length
    if (eligible.length === 0) {
      result.reason = "no eligible recipients"
      continue
    }
    const deliveries = await prisma.notificationDelivery.findMany({
      where: { intentId: intent.id },
      select: { id: true, recipient: true, state: true, updatedAt: true },
    })
    entries.push({ intent, ki, result, eligible, deliveryOf: new Map(deliveries.map((d) => [d.recipient, d])) })
  }

  // Recipient → the entries they get. P6: never a pair with a `sent` delivery.
  const byRecipient = new Map<string, { r: ResolvedRecipient; items: GroupEntry[] }>()
  for (const e of entries) {
    for (const r of e.eligible) {
      if (e.deliveryOf.get(r.email)?.state === "sent") continue
      const slot = byRecipient.get(r.email) ?? { r, items: [] }
      slot.items.push(e)
      byRecipient.set(r.email, slot)
    }
  }

  const modeFor = (email: string): DeliveryMode =>
    transport.mode === "live"
      ? "live"
      : transport.mode === "sandbox" && (def.sandboxBypass || sandboxAllows(email))
        ? "sandbox"
        : "dry-run"
  if (transport.mode === "sandbox") {
    for (const e of entries) e.result.withheld = e.eligible.filter((r) => modeFor(r.email) === "dry-run").length
  }
  const withheldTotal = transport.mode === "sandbox" ? [...byRecipient.keys()].filter((k) => modeFor(k) === "dry-run").length : undefined

  // What dry-run already logged, as "recipient|intentId" — read through
  // intentIds (N1(a)), so each item is logged to each person once.
  const loggedPairs = new Set<string>()
  if (transport.mode !== "live" && entries.length > 0) {
    const prior = await prisma.notificationMessage.findMany({
      where: {
        organizationId: org.id,
        kind: def.kind,
        mode: "dry-run",
        intentIds: { hasSome: entries.map((e) => e.intent.id) },
      },
      select: { to: true, intentIds: true },
    })
    for (const m of prior) for (const id of m.intentIds) loggedPairs.add(`${m.to}|${id}`)
  }

  const provider = emailProviderName()
  const dryRunProvider = transport.mode === "sandbox" ? provider : "console"
  const push = (items: GroupEntry[], rr: RecipientResult) => {
    for (const e of items) e.result.recipients.push({ ...rr })
  }
  const record = (covers: GroupEntry[], args: {
    to: string
    mode: DeliveryMode
    status: "sent" | "failed" | "dry-run"
    subject: string
    providerMessageId?: string | null
    error?: string
  }) =>
    writeMessage({
      intent: covers[0].intent,
      covers: covers.map((c) => c.intent),
      provider: args.mode === "dry-run" ? dryRunProvider : provider,
      withheld: withheldTotal,
      ...args,
    })

  // Recipients in a stable order; each one's items oldest first.
  for (const email of [...byRecipient.keys()].sort()) {
    const { r, items } = byRecipient.get(email)!
    items.sort((a, b) => a.intent.eventAt.getTime() - b.intent.eventAt.getTime() || a.intent.id.localeCompare(b.intent.id))
    const mode = modeFor(email)

    if (mode === "dry-run") {
      const already = items.filter((e) => loggedPairs.has(`${email}|${e.intent.id}`))
      push(already, { to: email, mode, status: "skipped", reason: "dry run already logged" })
      const fresh = items.filter((e) => !loggedPairs.has(`${email}|${e.intent.id}`))
      if (fresh.length === 0) continue
      const rendered = safeRenderGroup(def, fresh.map((e) => e.intent.payload), org, email)
      if ("error" in rendered) {
        await record(fresh, { to: email, mode, status: "failed", subject: rendered.subject, error: rendered.error })
        push(fresh, { to: email, mode, status: "failed", error: rendered.error })
        continue
      }
      await consoleEmailSender.send({ to: email, subject: rendered.subject, text: rendered.text, html: rendered.html })
      await record(fresh, { to: email, mode, status: "dry-run", subject: rendered.subject })
      push(fresh, { to: email, mode, status: "dry-run" })
      continue
    }

    if (mode === "sandbox") {
      if (trigger === "sweep") {
        push(items, { to: email, mode, status: "skipped", reason: "R2: the sweep never sends in sandbox" })
        continue
      }
      const rendered = safeRenderGroup(def, items.map((e) => e.intent.payload), org, email)
      const sent = await sendOne(transport, email, rendered)
      await record(items, { to: email, mode, subject: rendered.subject, ...sent })
      push(items, { to: email, mode, ...sent })
      continue
    }

    // live: claim every pair first; only claimed pairs go in this email.
    const claimed: { e: GroupEntry; deliveryId: string }[] = []
    for (const e of items) {
      const deliveryId = await claim(e.intent.id, r, e.deliveryOf.get(email), now)
      if (deliveryId) claimed.push({ e, deliveryId })
      else e.result.recipients.push({ to: email, mode, status: "skipped", reason: "being sent by another dispatch" })
    }
    if (claimed.length === 0) continue
    const covers = claimed.map((c) => c.e)
    const rendered = safeRenderGroup(def, covers.map((e) => e.intent.payload), org, email)
    const sent = await sendOne(transport, email, rendered)
    const messageId = await record(covers, { to: email, mode, subject: rendered.subject, ...sent })
    await prisma.notificationDelivery.updateMany({
      where: { id: { in: claimed.map((c) => c.deliveryId) } },
      data: { state: sent.status, messageId, error: sent.error ?? null },
    })
    push(covers, { to: email, mode, ...sent })
  }

  // Dry-run and sandbox NEVER change an intent's state (R1, structural).
  if (transport.mode !== "live") {
    for (const e of entries) e.result.reason = transport.mode
    return out
  }
  for (const e of entries) {
    const done = await finalize(e.intent, def, e.ki, e.eligible, e.result, now)
    Object.assign(e.result, done)
  }
  return out
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
  /**
   * MS-4b: set for a GROUPED message — every intent it covered, `intent` among
   * them. The row then has intentId null and these ids in intentIds (N1(a)),
   * and its audit copy has no entityId (a summary is about several things).
   * Absent for a per-intent kind, whose row is exactly what it was.
   */
  covers?: IntentRow[]
  provider: string
  to: string
  mode: DeliveryMode | "unknown"
  status: "sent" | "failed" | "dry-run"
  subject: string
  providerMessageId?: string | null
  error?: string
  withheld?: number
}): Promise<string | null> {
  const { intent, covers, to, mode, status, subject, providerMessageId, error, withheld } = args
  let messageId: string | null = null
  try {
    const row = await prisma.notificationMessage.create({
      data: {
        organizationId: intent.organizationId,
        kind: intent.kind,
        mode,
        // The caller decides a dry run's provider (NOTIFY-11; see dispatchOne).
        provider: args.provider,
        providerMessageId: providerMessageId ?? null,
        to,
        subject,
        status,
        error: error ?? null,
        intentId: covers ? null : intent.id,
        ...(covers ? { intentIds: covers.map((c) => c.id) } : {}),
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
    entityId: covers ? null : intent.entityId,
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
    const org = await loadOrg(intent.organizationId)
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

