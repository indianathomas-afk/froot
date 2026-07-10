import { NextResponse } from "next/server"
import { after } from "next/server"
import { prisma } from "@/lib/prisma"
import { dbDate, localDateStr } from "@/lib/reports"
import { syncSalesForStore } from "@/lib/sales-sync"
import { SQUARE_SIGNATURE_HEADER, verifySquareWebhookSignature } from "@/lib/square-webhook"

// POST /api/webhooks/square — Square order/payment events (Phase F-4) keep the
// current day's sales caches fresh in near-real-time, replacing reliance on
// the 15-minute lazy dashboard sync (which stays as the fallback when webhooks
// are missed or misconfigured; the nightly reconcile cron remains the source
// of truth). Public in src/proxy.ts; authenticates via the Square webhook
// signature. Setup: FORECASTING.md § Square order webhooks.
//
// The handler ACKs fast and does the resync after the response (Square retries
// on slow/non-2xx). Processing is idempotent: it re-pulls the affected store's
// whole local day through sales-sync, which rewrites the day wholesale — a
// duplicate or out-of-order delivery just rewrites the same day again.

export const maxDuration = 60

type SquareEventEntity = {
  location_id?: string
  created_at?: string
  order_id?: string
}

type SquareWebhookEvent = {
  merchant_id?: string
  type?: string
  event_id?: string
  created_at?: string
  data?: {
    type?: string
    id?: string
    object?: {
      order_created?: SquareEventEntity
      order_updated?: SquareEventEntity
      payment?: SquareEventEntity
    }
  }
}

const HANDLED_TYPES = ["order.created", "order.updated", "payment.created", "payment.updated"]

export async function POST(req: Request) {
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY
  if (!signatureKey) {
    return NextResponse.json({ error: "SQUARE_WEBHOOK_SIGNATURE_KEY is not configured" }, { status: 500 })
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) {
    return NextResponse.json({ error: "NEXT_PUBLIC_APP_URL is not configured" }, { status: 500 })
  }

  // Signature covers the exact raw body — read text, verify, then parse.
  const rawBody = await req.text()
  const notificationUrl = new URL("/api/webhooks/square", appUrl).toString()
  const valid = verifySquareWebhookSignature(notificationUrl, rawBody, signatureKey, req.headers.get(SQUARE_SIGNATURE_HEADER))
  if (!valid) {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 })
  }

  let event: SquareWebhookEvent
  try {
    event = JSON.parse(rawBody) as SquareWebhookEvent
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (!event.type || !HANDLED_TYPES.includes(event.type)) {
    return NextResponse.json({ received: true, ignored: "unhandled event type" })
  }

  const obj = event.data?.object
  const entity = obj?.order_created ?? obj?.order_updated ?? obj?.payment
  const locationId = entity?.location_id
  if (!locationId) {
    return NextResponse.json({ received: true, ignored: "no location_id in event" })
  }

  // The instant the change happened at Square — used both to pick the affected
  // local day and to skip work a newer sync already covered.
  const eventAt = new Date(event.created_at ?? entity?.created_at ?? Date.now())
  const orderAt = new Date(entity?.created_at ?? eventAt)

  // ACK now; resync after the response. Outside a Next request scope (the
  // verify fixture calls this handler directly) after() throws — run inline.
  try {
    after(() => processEvent(locationId, orderAt, eventAt))
  } catch {
    await processEvent(locationId, orderAt, eventAt)
  }
  return NextResponse.json({ received: true })
}

// Re-pulls the order's local day for the affected store. Never throws — a
// processing failure is logged and left to the 15-min lazy sync / nightly
// reconcile backstops (returning non-2xx here would only make Square retry a
// request we already know how to handle).
async function processEvent(locationId: string, orderAt: Date, eventAt: Date): Promise<void> {
  try {
    const store = await prisma.store.findUnique({
      where: { squareLocationId: locationId },
      include: { organization: true },
    })
    if (!store || !store.isActive || !store.organization.squareAccessToken) return

    // Orders are bucketed by created_at in the store's timezone (sales-sync.ts).
    const dateStr = localDateStr(orderAt, store.timezone)

    // Skip if a sync already ran after this event was emitted — that sync saw
    // the post-event order state. Absorbs bursts (Square delivers each order's
    // events with slight lag) without ever missing the last write.
    const cached = await prisma.salesPeriodCache.findUnique({
      where: { storeId_date: { storeId: store.id, date: dbDate(dateStr) } },
      select: { syncedAt: true },
    })
    if (cached && cached.syncedAt >= eventAt) return

    await syncSalesForStore(store.organization, store, dateStr, dateStr)
  } catch (e) {
    const msg = e instanceof Error ? e.message : "processing failed"
    console.error(`[webhooks:square] location=${locationId}: ${msg}`)
  }
}
