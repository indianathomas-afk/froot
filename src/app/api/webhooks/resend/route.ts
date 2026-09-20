import { Webhook } from "svix"
import { NextResponse } from "next/server"
import {
  ACTION_BOUNCED,
  ACTION_COMPLAINED,
  ACTION_DELAYED,
  ACTION_DELIVERED,
  deliveryEventExists,
  findAttemptByResendId,
  recordDeliveryEvent,
} from "@/lib/notification-log"

// POST /api/webhooks/resend — NOTIFY-2b. Resend delivery events, appended to
// the AuditLog row the send already wrote. Public in src/proxy.ts via
// `/api/webhooks(.*)`; authenticated by the Svix signature and nothing else.
//
// THIS IS THE ONLY THING IN FROOT THAT KNOWS WHETHER AN EMAIL ARRIVED. Before
// it, a bounce was visible in the Resend dashboard and nowhere in the product,
// so /settings/notifications could say "sent" about mail that a mailbox had
// refused — and DEBT-109 records that first sends from the new subdomain land
// in Outlook Junk, which is exactly the class of problem an operator learns
// about from a log rather than from a dashboard nobody has.
//
// APPEND, NEVER UPDATE (Gary, 2026-09-20). The event becomes a NEW row keyed to
// the same `resendId`. The `email.sent` row keeps saying what was attempted;
// this one says what became of it. Mutating the first would buy one fewer join
// and cost AuditLog its append-only property for every other writer in the app.
//
// FAIL CLOSED ON CONFIG, OPEN ON CORRELATION. No secret is a 500 — an
// unverifiable endpoint must not accept writes. A signed event Froot has no
// record of is a 200: it is an email this deployment did not send (another
// environment on the same Resend account, or one older than the log), and a
// 4xx would have Svix retrying it for days.

// Resend's event names. `email.sent` is Resend's own "we accepted it" event and
// is deliberately NOT handled: Froot already writes that row itself at send
// time, from the API response, and taking it from the webhook too would double
// every send in the log.
const EVENT_ACTIONS: Record<string, string> = {
  "email.delivered": ACTION_DELIVERED,
  "email.bounced": ACTION_BOUNCED,
  "email.complained": ACTION_COMPLAINED,
  "email.delivery_delayed": ACTION_DELAYED,
}

type ResendWebhookEvent = {
  type?: string
  created_at?: string
  data?: {
    email_id?: string
    to?: string[] | string
    created_at?: string
    // Present on bounces; Resend nests the human-readable reason here.
    bounce?: { message?: string; type?: string; subType?: string }
    reason?: string
  }
}

function reasonOf(data: ResendWebhookEvent["data"]): string | null {
  if (!data) return null
  const bounce = data.bounce
  if (bounce) {
    const parts = [bounce.type, bounce.subType].filter((p): p is string => !!p)
    const label = parts.join("/")
    if (bounce.message) return label ? `${label}: ${bounce.message}` : bounce.message
    if (label) return label
  }
  return typeof data.reason === "string" && data.reason ? data.reason : null
}

function recipientsOf(data: ResendWebhookEvent["data"]): string[] {
  const to = data?.to
  if (Array.isArray(to)) return to.filter((t): t is string => typeof t === "string")
  return typeof to === "string" ? [to] : []
}

export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    // 500 AND A LOG LINE, NOT A SILENT 200. An endpoint that cannot verify
    // cannot be trusted, and a 200 here would leave Resend reporting healthy
    // deliveries into a deployment that is recording none of them.
    console.error("[webhooks:resend] RESEND_WEBHOOK_SECRET is not set — refusing to accept events")
    return NextResponse.json({ error: "RESEND_WEBHOOK_SECRET is not configured" }, { status: 500 })
  }

  // THE SIGNATURE COVERS THE EXACT BYTES, so the body is read as text and
  // verified before it is parsed. This deviates from the Clerk route
  // (api/webhooks/clerk/route.ts:25-26), which re-serialises with
  // JSON.stringify(await req.json()) — that only works while the payload
  // happens to round-trip through JSON unchanged, which nothing guarantees.
  // The Square route (api/webhooks/square/route.ts:56) is the pattern followed
  // here, and it is the correct one.
  const rawBody = await req.text()
  const svixId = req.headers.get("svix-id")
  const svixTimestamp = req.headers.get("svix-timestamp")
  const svixSignature = req.headers.get("svix-signature")
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "Missing svix headers" }, { status: 401 })
  }

  let event: ResendWebhookEvent
  try {
    event = new Webhook(secret).verify(rawBody, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ResendWebhookEvent
  } catch {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 })
  }

  const action = event.type ? EVENT_ACTIONS[event.type] : undefined
  if (!action) {
    return NextResponse.json({ received: true, ignored: "unhandled event type" })
  }

  const resendId = event.data?.email_id
  if (!resendId) {
    console.log(`[webhooks:resend] ${event.type} carried no email_id — nothing to correlate`)
    return NextResponse.json({ received: true, ignored: "no email_id" })
  }

  // F3: correlate by the id the send already recorded. A miss is a 200 — see
  // the header. Never a 4xx: Svix retries a non-2xx for days, and an event
  // Froot legitimately cannot place would retry forever.
  const attempt = await findAttemptByResendId(resendId)
  if (!attempt) {
    console.log(`[webhooks:resend] ${event.type} id=${resendId} matches no send — ignored`)
    return NextResponse.json({ received: true, ignored: "no matching send" })
  }

  // IDEMPOTENT ON (resendId, action). Svix retries, and a retry that appended a
  // second `delivered` row would not change the status the page derives but
  // would put the same fact in the log twice — which is the kind of thing that
  // makes a log stop being read.
  if (await deliveryEventExists(resendId, action)) {
    return NextResponse.json({ received: true, ignored: "already recorded" })
  }

  await recordDeliveryEvent({
    organizationId: attempt.organizationId,
    entityId: attempt.entityId,
    action,
    resendId,
    kind: attempt.kind,
    recipients: recipientsOf(event.data),
    reason: reasonOf(event.data),
    at: event.created_at ?? event.data?.created_at ?? null,
  })

  // ACK. Verify, find, write, return — no email, no Square call, nothing that
  // could hold the connection open long enough for Resend to time out and
  // retry a write that already landed.
  return NextResponse.json({ received: true, recorded: action })
}
