/**
 * BUG-20 (measurement re-scope, Gary 2026-11-03) — the sales-sync timing line.
 *
 *   npx tsx scripts/verify-bug20.ts
 *
 * Square is STUBBED and COUNTED — globalThis.fetch is wrapped so that
 * /v2/orders/search answers from canned pages after a fixed delay, and any
 * other request to a Square host throws. Real Square is never called. The
 * database is the dev branch (.env), as for every verify-* fixture; a
 * throwaway org + store is created and deleted.
 *
 * Asserts:
 *   T1  a direct sync emits exactly ONE `[sales-sync] timing` line carrying the
 *       caller label, store, window, outcome=ok, page and order counts, and
 *       squareMs / writeMs / totalMs as numbers — squareMs at least the stubbed
 *       Square delay, totalMs at least squareMs + writeMs.
 *   T2  nothing fetched, stored or returned changed: one orders search per
 *       page, the stored day equals the hand-computed net/gross/orders, and
 *       the result object has exactly the pre-BUG-20 keys and values.
 *   T3  the fill-missing-days path labels its sync `<caller>:gap-fill`, and a
 *       fully cached window makes no Square call and logs no timing line.
 *   T4  a Square failure still throws the same error, and still logs one line
 *       with outcome=error, the time spent in Square, and writeMs=-.
 *
 * Proven able to fail: run against the pre-BUG-20 src/lib/sales-sync.ts (no
 * timing line) — T1, T3 and T4's line checks fail.
 */
import "dotenv/config"
import { prisma } from "../src/lib/prisma"
import { localDateStr, dbDate } from "../src/lib/reports"
import { syncSalesForStore, ensureSalesCached } from "../src/lib/sales-sync"

const TZ = "America/Los_Angeles"
const SQUARE_DELAY_MS = 120

let failures = 0
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures += 1
}

// ── Square stub ──────────────────────────────────────────────────────────────
let squareSearches = 0
let squareMode: "ok" | "fail" = "ok"
let pages: { orders: unknown[]; cursor?: string }[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
  if (/squareup(sandbox)?\.com/.test(url)) {
    if (!url.endsWith("/v2/orders/search")) throw new Error(`FIXTURE: unexpected Square call ${url}`)
    squareSearches += 1
    await new Promise((r) => setTimeout(r, SQUARE_DELAY_MS))
    if (squareMode === "fail") return new Response("stubbed outage", { status: 503 })
    const body = JSON.parse(String(init?.body ?? "{}")) as { cursor?: string }
    const page = body.cursor ? pages[Number(body.cursor)] : pages[0]
    return new Response(JSON.stringify(page), { status: 200, headers: { "Content-Type": "application/json" } })
  }
  return realFetch(input, init)
}) as typeof fetch

// ── console.log capture ──────────────────────────────────────────────────────
let captured: string[] = []
const realLog = console.log
function capture<T>(fn: () => Promise<T>): Promise<T> {
  captured = []
  console.log = (...args: unknown[]) => {
    captured.push(args.map(String).join(" "))
  }
  return fn().finally(() => {
    console.log = realLog
  })
}
const timingLines = () => captured.filter((l) => l.startsWith("[sales-sync] timing "))
function field(line: string, name: string): string | undefined {
  return new RegExp(`(?:^| )${name}=(\\S+)`).exec(line)?.[1]
}

function order(id: string, createdAt: string, totalCents: number, taxCents: number, state = "COMPLETED") {
  return {
    id,
    created_at: createdAt,
    state,
    tenders: [{ id: `t-${id}` }],
    total_money: { amount: totalCents, currency: "USD" },
    total_tax_money: { amount: taxCents, currency: "USD" },
    total_tip_money: { amount: 0, currency: "USD" },
    total_discount_money: { amount: 0, currency: "USD" },
    line_items: [{ catalog_object_id: "VAR-1", quantity: "1", gross_sales_money: { amount: totalCents - taxCents } }],
  }
}

async function main() {
  const tag = Math.random().toString(36).slice(2, 8)
  const today = localDateStr(new Date(), TZ)
  const yesterday = (() => {
    const d = new Date(`${today}T00:00:00.000Z`)
    d.setUTCDate(d.getUTCDate() - 1)
    return d.toISOString().slice(0, 10)
  })()
  // Noon local on each day, well clear of midnight spillover.
  const noon = (dateStr: string) => new Date(`${dateStr}T20:00:00.000Z`).toISOString()

  // A fake token and NO refresh token: getSquareClient's refresh check returns
  // early, so the only outbound Square call is the stubbed orders search.
  const org = await prisma.organization.create({
    data: {
      clerkOrgId: `fixture-bug20-${tag}`,
      name: "ZZ BUG-20 Fixture Org (safe to delete)",
      activeModules: ["inventory"],
      squareAccessToken: `fixture-bug20-not-a-token-${tag}`,
    },
  })
  const store = await prisma.store.create({
    data: { organizationId: org.id, name: "ZZ BUG-20 Fixture Store", timezone: TZ, squareLocationId: `FIXTURE-BUG20-${tag}` },
  })
  realLog(`Fixture org ${org.id} · store ${store.id} · today ${today} (${TZ})\n`)

  try {
    // ── T1 + T2: direct sync, two pages, three orders ──
    pages = [
      { orders: [order("o1", noon(today), 1100, 100), order("o2", noon(today), 2200, 200)], cursor: "1" },
      { orders: [order("o3", noon(today), 550, 50)] },
    ]
    squareSearches = 0
    const result = await capture(() => syncSalesForStore(org, store, today, today, "fixture/bug20:direct"))
    const lines = timingLines()
    check("T1 exactly one timing line per sync", lines.length === 1, `${lines.length} line(s)`)
    const line = lines[0] ?? ""
    realLog(`    ${line}`)
    check("T1 caller label carried", field(line, "caller") === "fixture/bug20:direct")
    check("T1 store id carried", field(line, "store") === store.id)
    check("T1 window carried", field(line, "window") === `${today}..${today}`)
    check("T1 outcome=ok", field(line, "outcome") === "ok")
    check("T1 pages=2 orders=3", field(line, "pages") === "2" && field(line, "orders") === "3")
    const squareMs = Number(field(line, "squareMs"))
    const writeMs = Number(field(line, "writeMs"))
    const totalMs = Number(field(line, "totalMs"))
    check(
      "T1 squareMs is a number ≥ the stubbed Square time",
      Number.isFinite(squareMs) && squareMs >= 2 * SQUARE_DELAY_MS - 5,
      `squareMs=${squareMs}, stub ${2 * SQUARE_DELAY_MS}ms`
    )
    check("T1 writeMs is a number", Number.isFinite(writeMs) && writeMs >= 0, `writeMs=${writeMs}`)
    check("T1 totalMs ≥ squareMs + writeMs", Number.isFinite(totalMs) && totalMs >= squareMs + writeMs, `totalMs=${totalMs}`)
    check("T1 wrote=1/1", field(line, "wrote") === "1/1")

    check("T2 one orders search per page", squareSearches === 2, `${squareSearches} search(es)`)
    const row = await prisma.salesPeriodCache.findUnique({ where: { storeId_date: { storeId: store.id, date: dbDate(today) } } })
    check(
      "T2 stored day unchanged in shape and value (net 35.00, gross 38.50, 3 orders)",
      !!row && Math.abs(row.netSales - 35) < 1e-9 && Math.abs(row.grossSales - 38.5) < 1e-9 && row.orderCount === 3,
      row ? `net ${row.netSales} gross ${row.grossSales} orders ${row.orderCount}` : "no row"
    )
    check(
      "T2 result object is the pre-BUG-20 shape and values",
      JSON.stringify(Object.keys(result).sort()) ===
        JSON.stringify(["days", "discardedDays", "endDate", "orders", "startDate", "storeId"]) &&
        result.orders === 3 && result.days === 1 && result.discardedDays === 0,
      JSON.stringify(result)
    )

    // ── T3: fill-missing-days path ──
    pages = [{ orders: [order("y1", noon(yesterday), 1000, 0)] }]
    squareSearches = 0
    await capture(() => ensureSalesCached(org, store, yesterday, today, "fixture/bug20:month"))
    const gap = timingLines()
    check("T3 gap-fill syncs once and logs once", squareSearches === 1 && gap.length === 1, `${squareSearches} search(es), ${gap.length} line(s)`)
    check("T3 gap-fill labelled <caller>:gap-fill", field(gap[0] ?? "", "caller") === "fixture/bug20:month:gap-fill", gap[0] ?? "")
    check("T3 gap-fill window is the missing span only", field(gap[0] ?? "", "window") === `${yesterday}..${yesterday}`)

    squareSearches = 0
    await capture(() => ensureSalesCached(org, store, yesterday, today, "fixture/bug20:month"))
    check("T3 fully cached window: no Square call, no timing line", squareSearches === 0 && timingLines().length === 0)

    // ── T4: Square failure ──
    squareMode = "fail"
    squareSearches = 0
    let thrown: unknown = null
    await capture(() => syncSalesForStore(org, store, today, today, "fixture/bug20:failure")).catch((e) => {
      thrown = e
    })
    squareMode = "ok"
    const fail = timingLines()
    check(
      "T4 failure still throws the same error",
      thrown instanceof Error && thrown.message.startsWith("SQUARE_SEARCH_ORDERS_FAILED:503:"),
      thrown instanceof Error ? thrown.message.slice(0, 60) : String(thrown)
    )
    check("T4 failure logs one line, outcome=error", fail.length === 1 && field(fail[0], "outcome") === "error", fail[0] ?? "no line")
    check(
      "T4 failure line: pages=1, squareMs ≥ stub, writeMs=-",
      field(fail[0] ?? "", "pages") === "1" &&
        Number(field(fail[0] ?? "", "squareMs")) >= SQUARE_DELAY_MS - 5 &&
        field(fail[0] ?? "", "writeMs") === "-"
    )
    const after = await prisma.salesPeriodCache.findUnique({ where: { storeId_date: { storeId: store.id, date: dbDate(today) } } })
    check("T4 failure wrote nothing (day still 35.00)", !!after && Math.abs(after.netSales - 35) < 1e-9)
  } finally {
    await prisma.salesHourlyCache.deleteMany({ where: { storeId: store.id } })
    await prisma.salesLineCache.deleteMany({ where: { storeId: store.id } })
    await prisma.salesPeriodCache.deleteMany({ where: { storeId: store.id } })
    await prisma.store.deleteMany({ where: { organizationId: org.id } })
    await prisma.organization.delete({ where: { id: org.id } })
    realLog("\nFixture org + store deleted.")
  }

  if (failures > 0) {
    console.error(`\nBUG-20: ${failures} check(s) FAILED`)
    process.exit(1)
  }
  realLog("\nBUG-20: all timing-line checks passed.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
