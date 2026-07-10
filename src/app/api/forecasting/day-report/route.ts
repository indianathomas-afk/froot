import { NextResponse } from "next/server"
import { requireForecastContext, requireForecastStore } from "@/lib/forecasting-access"
import { getSquareClient } from "@/lib/square"
import { localMidnightUtc } from "@/lib/sales-sync"
import { addDaysStr, round2 } from "@/lib/goal-engine"

export const maxDuration = 60

// GET /api/forecasting/day-report?storeId=&date= — a live Square "balancing
// report" for one day: the same breakdown as Square's Sales Summary, computed
// straight from the Orders API so it's authoritative and can be reconciled
// against the Square dashboard. One day = one cheap SearchOrders call.
//
// Sales are bucketed by created_at (Square's reporting-day rule) and COMPLETED
// only, matching what the sync stores. Tenders are split by type so the
// Square-processed vs. third-party-delivery (OTHER) share is explicit.

type SquareMoney = { amount?: number } | null | undefined
const dollars = (m: SquareMoney) => (m?.amount ?? 0) / 100

type SquareOrder = {
  state?: string
  total_money?: SquareMoney
  total_tax_money?: SquareMoney
  total_tip_money?: SquareMoney
  total_discount_money?: SquareMoney
  tenders?: { type?: string; amount_money?: SquareMoney }[]
  source?: { name?: string }
}

// Human labels for Square tender types.
const TENDER_LABELS: Record<string, string> = {
  CARD: "Card",
  CASH: "Cash",
  SQUARE_GIFT_CARD: "Gift card",
  WALLET: "Digital wallet",
  BANK_ACCOUNT: "Bank account",
  BUY_NOW_PAY_LATER: "Buy now, pay later",
  OTHER: "Other / delivery",
  NO_SALE: "No sale",
}
const DELIVERY_TYPES = new Set(["OTHER"])

export async function GET(req: Request) {
  const ctx = await requireForecastContext()
  if ("error" in ctx) return ctx.error

  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId") ?? ""
  const date = url.searchParams.get("date") ?? ""
  if (!storeId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "storeId and a valid date are required" }, { status: 400 })
  }

  const store = await requireForecastStore(ctx, storeId)
  if ("error" in store) return store.error
  if (!store.squareLocationId || !ctx.org.squareAccessToken) {
    return NextResponse.json({ error: "SQUARE_NOT_CONNECTED" }, { status: 409 })
  }

  const tz = store.timezone
  const startAt = localMidnightUtc(date, tz)
  const endAt = localMidnightUtc(addDaysStr(date, 1), tz)

  let client: Awaited<ReturnType<typeof getSquareClient>>
  try {
    client = await getSquareClient(ctx.org)
  } catch {
    return NextResponse.json({ error: "SQUARE_NOT_CONNECTED" }, { status: 409 })
  }

  const orders: SquareOrder[] = []
  let cursor: string | undefined
  try {
    do {
      const res = await fetch(`${client.baseUrl}/v2/orders/search`, {
        method: "POST",
        headers: client.headers,
        body: JSON.stringify({
          location_ids: [store.squareLocationId],
          limit: 500,
          cursor,
          query: {
            filter: {
              state_filter: { states: ["OPEN", "COMPLETED"] },
              date_time_filter: { created_at: { start_at: startAt.toISOString(), end_at: endAt.toISOString() } },
            },
            sort: { sort_field: "CREATED_AT", sort_order: "ASC" },
          },
        }),
      })
      if (!res.ok) {
        const text = await res.text()
        return NextResponse.json({ error: `SQUARE_ERROR:${res.status}`, detail: text.slice(0, 200) }, { status: 502 })
      }
      const data = (await res.json()) as { orders?: SquareOrder[]; cursor?: string }
      orders.push(...(data.orders ?? []))
      cursor = data.cursor
    } while (cursor)
  } catch {
    return NextResponse.json({ error: "SQUARE_UNREACHABLE" }, { status: 502 })
  }

  let net = 0
  let tax = 0
  let tips = 0
  let discounts = 0
  let deliveryNet = 0
  let deliveryOrders = 0
  const byTender = new Map<string, number>()

  let orderCount = 0
  for (const o of orders) {
    // Paid orders only (has a tender), matching the sync and Square's Net Sales.
    if (!o.tenders || o.tenders.length === 0) continue
    orderCount += 1
    const orderNet = dollars(o.total_money) - dollars(o.total_tax_money) - dollars(o.total_tip_money)
    net += orderNet
    tax += dollars(o.total_tax_money)
    tips += dollars(o.total_tip_money)
    discounts += dollars(o.total_discount_money)
    for (const t of o.tenders ?? []) {
      const type = t.type ?? "OTHER"
      byTender.set(type, (byTender.get(type) ?? 0) + dollars(t.amount_money))
    }
    // An order is "delivery" if it settled only via OTHER tenders (DoorDash,
    // Uber Eats, Grubhub push their orders in with an external tender).
    const types = (o.tenders ?? []).map((t) => t.type ?? "OTHER")
    if (types.length > 0 && types.every((t) => DELIVERY_TYPES.has(t))) {
      deliveryNet += orderNet
      deliveryOrders += 1
    }
  }

  return NextResponse.json({
    date,
    orderCount,
    netSales: round2(net),
    grossSales: round2(net + discounts), // Square "gross sales" = net + discounts
    discounts: round2(discounts),
    tax: round2(tax),
    tips: round2(tips),
    totalCollected: round2(net + tax + tips),
    tenders: [...byTender.entries()]
      .map(([type, amount]) => ({ type, label: TENDER_LABELS[type] ?? type, amount: round2(amount) }))
      .sort((a, b) => b.amount - a.amount),
    delivery: { netSales: round2(deliveryNet), orders: deliveryOrders },
    inStore: { netSales: round2(net - deliveryNet), orders: orderCount - deliveryOrders },
  })
}
