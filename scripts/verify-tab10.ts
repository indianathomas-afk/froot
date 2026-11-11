/**
 * TAB-10 — Transactions and Average sale on the tablet's expanded Sales card.
 *
 *   npx tsx scripts/verify-tab10.ts
 *
 * Pure cases for src/lib/tablet-cards.ts salesCounts, STRUCTURAL checks over
 * the summary route, the card and the desktop surfaces (each with a negative
 * control), then READ-ONLY database checks against the dev branch (.env),
 * which print the Neon branch id beside their results. Nothing is written.
 *
 * WHAT THIS CAN DETECT:
 *   1  THE ROUTE: GET /api/dashboard/summary answers `sales.today.orders`
 *      from today's SalesPeriodCache.orderCount, and still builds
 *      `sales.comparison` (which carries last year's same-time orders) with
 *      TAB-7's helper. NC: the pre-TAB-10 route (885d65f) fails.
 *   2  THE MATHS: transactions = today's orders; average sale = net ÷
 *      transactions; 0 transactions → "—"; a 0 baseline → "—"; no comparison
 *      day → no pill; a payload without the order count → no rows (never 0).
 *   3  THE CARD reads both rows from the summary answer (useStripSummary →
 *      /api/dashboard/summary), not from page props; pill = the tile's pill.
 *      NC: the pre-TAB-10 card and a mutant fed from props both fail.
 *   4  DESKTOP UNCHANGED: the desktop route, card and the shared helper are
 *      byte-identical to 885d65f; the summary diff is additive. NC: the same
 *      byte check run on the summary route reports a change.
 *   5  NO NEW SQUARE CALL, NO NEW TIMER.
 *   6  DATABASE (dev, read-only): for each Square-linked store, its latest
 *      day with sales taken as "today" at four store-local moments, the
 *      tablet's figures (summary route's reads → salesCounts) equal the
 *      desktop's (sales route's reads → the card's formulas).
 *
 * WHAT IT CANNOT DETECT: the rendered page (the local check covers it), the
 * routes run under a real Clerk session, staging/production data.
 */
import "dotenv/config"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import {
  compareSelection,
  compareTodayWithDay,
  pctChange,
  type DayComparison,
  type HourRow,
  type LocalTime,
  type WindowDay,
} from "../src/lib/sales-same-time"
import { salesCounts, salesTileComparison, type StripSummary } from "../src/lib/tablet-cards"

/** HEAD before TAB-10 (TAB-7 PRE-PUSH-CHECK). */
const PRE_TAB10 = "885d65f"

let failures = 0
let passes = 0
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const pass = a === e
  if (pass) passes++
  else failures++
  console.log(`${pass ? "  ✓" : "  ✗"} ${label}`)
  if (!pass) console.log(`      expected ${e}\n      actual   ${a}`)
}
function ok(label: string, cond: boolean) {
  check(label, cond, true)
}
const near = (a: number | null, b: number | null, tol = 1e-9) =>
  a === null || b === null ? a === b : Math.abs(a - b) <= tol
const atPre = (p: string) => execFileSync("git", ["show", `${PRE_TAB10}:${p}`], { encoding: "utf8" })
const now = (p: string) => readFileSync(p, "utf8")

const SUMMARY = "src/app/api/dashboard/summary/route.ts"
const DESK_ROUTE = "src/app/api/dashboard/sales/route.ts"
const DESK_CARD = "src/app/(app)/dashboard/sales-performance-card.tsx"
const HELPER = "src/lib/sales-same-time.ts"
const STRIP = "src/app/(app)/dashboard/tablet-strip.tsx"
const HOME = "src/app/(app)/dashboard/tablet-home.tsx"
const CARDS = "src/lib/tablet-cards.ts"

// ─── 1. The summary route answers the order counts ───────────────────────────
console.log("1. summary route carries the order counts (NC: 885d65f)")
const routeOk = (t: string) =>
  /today: \{ total: number; orders: number; hourly:/.test(t) &&
  /orders: todayDay\?\.orderCount \?\? 0,/.test(t) &&
  /comparison: compareTodayWithDay\(/.test(t) &&
  /orders: lastYearDay\.orderCount,/.test(t) &&
  /hourly: lastYearHours\.map\(\(h\) => \(\{ hour: h\.hour, net: h\.netSales, orders: h\.orderCount \}\)\)/.test(t)
ok("1a route: today.orders from todayDay.orderCount; comparison (with last year's orders) via compareTodayWithDay", routeOk(now(SUMMARY)))
ok("1a NC the same check fails on the pre-TAB-10 route", !routeOk(atPre(SUMMARY)))
ok("1b the strip's payload type declares today.orders", /today: \{ total: number; orders\?: number; hourly:/.test(now(CARDS)))
ok("1b NC absent before TAB-10", !/orders\?: number/.test(atPre(CARDS)))

// ─── 2. The maths ────────────────────────────────────────────────────────────
console.log("2. salesCounts — desktop's definitions on TAB-7's basis")
const goal = { month: "2026-11-01", goalAmount: null, monthToDate: 0, daysElapsed: 11, daysInMonth: 30 }
const sameTime = (net: number, orders: number | null): DayComparison => ({
  method: "same-time",
  net,
  orders,
  asOf: { hour: 10, minute: 15 },
  asOfLabel: "10:15 AM",
})
const strip = (total: number, orders: number | undefined, comparison: DayComparison | null): StripSummary => ({
  salesAvailable: true,
  sales: {
    today: { total, ...(orders === undefined ? {} : { orders }), hourly: [{ hour: 9, net: total }] },
    lastYear: { date: "2025-11-12", total: 900, hourly: [{ hour: 9, net: 900 }] },
    comparison,
  },
  goal,
})
// The prompt's example: 9 transactions, $11.88 average.
const ex = salesCounts(strip(106.92, 9, sameTime(100, 8.5)))!
check("2a 9 transactions, $106.92 → average $11.88", [ex.transactions, Math.round(ex.averageSale! * 100) / 100], [9, 11.88])
ok("2b transactions vs last year by 10:15 (8.5, pro-rated) → +5.88%", near(ex.transactionsVs.pct, ((9 - 8.5) / 8.5) * 100))
ok("2c average vs last year's same-time average (100 ÷ 8.5) → pctChange(11.88, 11.7647)", near(ex.averageSaleVs.pct, pctChange(106.92 / 9, 100 / 8.5)))
check("2c NC average is not compared with last year's whole-day net", ex.averageSaleVs.pct === pctChange(106.92 / 9, 900), false)
const zero = salesCounts(strip(0, 0, sameTime(100, 8)))!
check("2d 0 transactions → average null (renders \"—\"), its pill \"—\" (design choice)", [zero.transactions, zero.averageSale, zero.averageSaleVs], [0, null, { pct: null, compared: true }])
check("2e 0 transactions vs 8 last year → ▼100.0% on Transactions", zero.transactionsVs.pct, -100)
const lyZero = salesCounts(strip(50, 4, sameTime(0, 0)))!
check("2f last year's same-time figure 0 → both pills \"—\", not a percentage", [lyZero.transactionsVs, lyZero.averageSaleVs], [{ pct: null, compared: true }, { pct: null, compared: true }])
const lyNullOrders = salesCounts(strip(50, 4, { method: "full-day-fallback", net: 900, orders: null, asOf: null, asOfLabel: null }))!
check("2g comparison without an order count → \"—\" on both", [lyNullOrders.transactionsVs.pct, lyNullOrders.averageSaleVs.pct], [null, null])
const fb = salesCounts(strip(50, 4, { method: "full-day-fallback", net: 900, orders: 60, asOf: null, asOfLabel: null }))!
check("2h full-day fallback compares with the whole day's orders (desktop does the same)", fb.transactionsVs.pct, pctChange(4, 60))
const none = salesCounts(strip(50, 4, null))!
check("2i no comparison day → no pill on either row", [none.transactionsVs, none.averageSaleVs], [{ pct: null, compared: false }, { pct: null, compared: false }])
check("2j payload without today.orders → no rows (never read as 0)", salesCounts(strip(50, undefined, sameTime(10, 1))), null)
check("2k sales unavailable → no rows", salesCounts({ ...strip(50, 4, null), salesAvailable: false }), null)
check("2l no sales block → no rows", salesCounts({ ...strip(50, 4, null), sales: null }), null)
check("2m the headline is unchanged by TAB-10 (tile still dollars vs same-time net)", salesTileComparison(strip(106.92, 9, sameTime(100, 8.5)))?.pct, pctChange(106.92, 100))

// ─── 3. The card reads the route's answer ────────────────────────────────────
console.log("3. the expanded card renders both rows from the summary answer (NC: 885d65f, props mutant)")
const cardOk = (t: string) =>
  /function SalesBody\(\{ data \}: \{ data: StripSummary \}\)/.test(t) &&
  /const n = salesCounts\(data\)/.test(t) &&
  /label="Transactions"\s+value=\{n\.transactions\.toLocaleString\("en-US"\)\}/.test(t) &&
  /label="Average sale"\s+value=\{n\.averageSale === null \? "—" : usdCents\(n\.averageSale\)\}/.test(t) &&
  /aside=\{n\.transactionsVs\.compared \? <DeltaText pct=\{n\.transactionsVs\.pct\} \/> : undefined\}/.test(t) &&
  /aside=\{n\.averageSaleVs\.compared \? <DeltaText pct=\{n\.averageSaleVs\.pct\} \/> : undefined\}/.test(t)
ok("3a SalesBody renders Transactions and Average sale from salesCounts(data)", cardOk(now(STRIP)))
ok("3a NC the pre-TAB-10 card fails", !cardOk(atPre(STRIP)))
const homeFeedsRoute = (home: string, stripSrc: string) =>
  /const strip = useStripSummary\(storeId, stripTiles\.length > 0, ctl\.register\)/.test(home) &&
  /<StripDetail data=\{strip\}/.test(home) &&
  /fetchCard<StripSummary>\("tablet strip", `\/api\/dashboard\/summary\?storeId=\$\{storeId\}`\)/.test(stripSrc)
ok("3b the card's `data` is useStripSummary's answer from /api/dashboard/summary, on the TAB-5 cycle (ctl.register)", homeFeedsRoute(now(HOME), now(STRIP)))
ok(
  "3b NC a mutant feeding StripDetail from page props fails",
  !homeFeedsRoute(now(HOME).replace("<StripDetail data={strip}", "<StripDetail data={props.summary}"), now(STRIP))
)
ok("3c tablet-home.tsx unchanged by TAB-10 (no new prop, no new timer)", now(HOME) === atPre(HOME))
// The tile's pill, extracted into DeltaText: same classes, same "—" rule.
const preTileClasses = [
  '"text-sm font-bold"',
  '"text-[var(--color-muted-foreground)]"',
  '"text-[var(--color-success-text,#1d7c2e)]"',
  '"text-[var(--color-warning-text,#a36a00)]"',
]
const deltaText = now(STRIP).match(/function DeltaText[\s\S]*?\n\}\n/)?.[0] ?? ""
ok("3d DeltaText carries the pre-TAB-10 tile's exact classes", preTileClasses.every((c) => atPre(STRIP).includes(c) && deltaText.includes(c)))
ok("3e DeltaText keeps the \"—\" rule and the ▲/▼ format", deltaText.includes('pct === null ? "—" : `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}%`'))
ok("3f the collapsed tile renders the same pill through DeltaText", /<DeltaText pct=\{delta\} \/>/.test(now(STRIP)) && /label: "Sales today",\s+value: usd\(today\),/.test(now(STRIP)))
ok("3g the hour-by-hour table is unchanged (no Transactions column — design choice)", (now(STRIP).match(/grid-cols-\[6rem_minmax\(0,1fr\)_7rem_7rem\]/g) ?? []).length === 2)

// ─── 4. Desktop unchanged ────────────────────────────────────────────────────
console.log("4. desktop route, card and helper byte-identical to 885d65f")
for (const p of [DESK_ROUTE, DESK_CARD, HELPER]) ok(`4a ${p} unchanged`, now(p) === atPre(p))
ok("4a NC the same byte check reports the summary route as changed", now(SUMMARY) !== atPre(SUMMARY))
const diff = execFileSync("git", ["diff", "--unified=0", PRE_TAB10, "--", SUMMARY], { encoding: "utf8" })
const removed = diff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"))
check(
  "4b summary diff is additive: the one removed line is the `today` type, re-added with `orders`",
  removed,
  ["-    today: { total: number; hourly: { hour: number; net: number }[] }"]
)
// The fixture's desktop model below is the card's own formulas — pin them.
const deskCard = now(DESK_CARD)
ok("4c desktop compOrders = basis.orders", /const compOrders = basis \? basis\.orders : \(compareData\?\.orders \?\? null\)/.test(deskCard))
ok("4c desktop compAvg = basis.net / basis.orders (orders > 0)", /\? basis\.orders !== null && basis\.orders > 0\s+\? basis\.net \/ basis\.orders\s+: null/.test(deskCard))
ok("4c desktop avgSale = net / orders, null at 0", /avgSale: orders > 0 \? net \/ orders : null/.test(now(DESK_ROUTE)))

// ─── 5. No new Square call, no new timer ─────────────────────────────────────
console.log("5. no new Square call, no new timer")
const count = (t: string, r: RegExp) => (t.match(r) ?? []).length
const SQ = /syncSalesForStore\(|ensureSalesCached\(|fetch\(/g
check("5a summary route: sync / gap-fill / fetch calls equal 885d65f's", count(now(SUMMARY), SQ), count(atPre(SUMMARY), SQ))
const TIMERS = /setInterval\(|setTimeout\(/g
check("5b tablet-strip.tsx: timers equal 885d65f's", count(now(STRIP), TIMERS), count(atPre(STRIP), TIMERS))
check("5c tablet-cards.ts imports nothing new (still pure)", count(now(CARDS), /^import /gm), count(atPre(CARDS), /^import /gm))

// ─── 6. Database (dev, read-only): tablet = desktop ──────────────────────────
console.log("6. database (dev, read-only) — tablet figures equal desktop's, same store and moment")

function shift(d: string, days: number): string {
  const x = new Date(`${d}T00:00:00.000Z`)
  x.setUTCDate(x.getUTCDate() + days)
  return x.toISOString().slice(0, 10)
}

async function db() {
  const { prisma } = await import("../src/lib/prisma")
  const { dbDate } = await import("../src/lib/reports")
  try {
    const [{ b }] = await prisma.$queryRaw<{ b: string | null }[]>`SELECT current_setting('neon.branch_id', true) AS b`
    console.log(`  branch: dev (neon.branch_id=${b ?? "null"})`)
    const stores = await prisma.store.findMany({
      where: { squareLocationId: { not: null }, isActive: true },
      select: { id: true },
    })
    const MOMENTS: LocalTime[] = [
      { hour: 0, minute: 0 },
      { hour: 9, minute: 30 },
      { hour: 13, minute: 15 },
      { hour: 23, minute: 59 },
    ]
    let compared = 0
    let mismatches = 0
    let storesUsed = 0
    for (const s of stores) {
      // The store's latest day with sales whose same weekday last year is cached.
      const days = await prisma.salesPeriodCache.findMany({
        where: { storeId: s.id, orderCount: { gt: 0 } },
        orderBy: { date: "desc" },
        take: 60,
        select: { date: true },
      })
      let d: string | null = null
      for (const r of days) {
        const cand = r.date.toISOString().slice(0, 10)
        const ly = await prisma.salesPeriodCache.findUnique({ where: { storeId_date: { storeId: s.id, date: dbDate(shift(cand, -364)) } } })
        if (ly) {
          d = cand
          break
        }
      }
      if (!d) continue
      storesUsed++
      const c = shift(d, -364)

      // TABLET — the summary route's reads, verbatim shapes.
      const [todayDay, lastYearDay, lastYearHours] = await Promise.all([
        prisma.salesPeriodCache.findUnique({ where: { storeId_date: { storeId: s.id, date: dbDate(d) } } }),
        prisma.salesPeriodCache.findUnique({ where: { storeId_date: { storeId: s.id, date: dbDate(c) } } }),
        prisma.salesHourlyCache.findMany({ where: { storeId: s.id, date: dbDate(c) }, orderBy: { hour: "asc" } }),
      ])
      // DESKTOP — the sales route's loadWindow for [d,d] and [c,c], compare
      // mode same_weekday_last_year (start − 364).
      const [selRows, compRows, compHours] = await Promise.all([
        prisma.salesPeriodCache.findMany({ where: { storeId: s.id, date: { gte: dbDate(d), lte: dbDate(d) } } }),
        prisma.salesPeriodCache.findMany({ where: { storeId: s.id, date: { gte: dbDate(c), lte: dbDate(c) } } }),
        prisma.salesHourlyCache.findMany({ where: { storeId: s.id, date: dbDate(c) }, orderBy: { hour: "asc" } }),
      ])

      for (const at of MOMENTS) {
        const tabletStrip: StripSummary = {
          salesAvailable: true,
          sales: {
            today: { total: todayDay?.netSales ?? 0, orders: todayDay?.orderCount ?? 0, hourly: [] },
            lastYear: null,
            comparison: compareTodayWithDay(
              lastYearDay
                ? {
                    total: lastYearDay.netSales,
                    orders: lastYearDay.orderCount,
                    hourly: lastYearHours.map((h) => ({ hour: h.hour, net: h.netSales, orders: h.orderCount })),
                  }
                : null,
              true,
              at
            ),
          },
          goal,
        }
        const t = salesCounts(tabletStrip)!

        const selNet = selRows.reduce((x, r) => x + r.netSales, 0)
        const selOrders = selRows.reduce((x, r) => x + r.orderCount, 0)
        const selAvg = selOrders > 0 ? selNet / selOrders : null
        const compDays: WindowDay[] = compRows.map((r) => ({ date: r.date.toISOString().slice(0, 10), total: r.netSales, orders: r.orderCount }))
        const lastHourly: HourRow[] = compHours.map((h) => ({ hour: h.hour, net: h.netSales, orders: h.orderCount }))
        const basis = compareSelection({ start: d, end: d, today: d }, { start: c, end: c, days: compDays, lastHourly }, at)
        const hasCompare = compRows.some((r) => r.orderCount > 0 || r.netSales > 0)
        const compOrders = basis ? basis.orders : compRows.reduce((x, r) => x + r.orderCount, 0)
        const compAvg = basis ? (basis.orders !== null && basis.orders > 0 ? basis.net / basis.orders : null) : null
        const dTx = pctChange(selOrders, hasCompare ? compOrders : null)
        const dAvg = pctChange(selAvg ?? 0, hasCompare ? compAvg : null)

        compared++
        const same =
          t.transactions === selOrders &&
          near(t.averageSale, selAvg) &&
          near(t.transactionsVs.pct, dTx) &&
          near(t.averageSaleVs.pct, dAvg)
        if (!same) {
          mismatches++
          console.log(`      ✗ store=${s.id} day=${d} at ${at.hour}:${String(at.minute).padStart(2, "0")}`, {
            tablet: t,
            desktop: { orders: selOrders, avg: selAvg, dTx, dAvg },
          })
        }
      }
    }
    console.log(`  dev (neon.branch_id=${b ?? "null"}): ${storesUsed} stores × 4 moments = ${compared} comparisons, ${mismatches} mismatches`)
    ok("6a dev: at least one store had a day and its comparison day cached", storesUsed > 0)
    check("6b dev: tablet transactions, average sale and both ▲/▼ equal desktop's", mismatches, 0)
    // NC: the comparison must be able to fail — a tablet reading last year's
    // WHOLE day for orders would differ from desktop at 9:30.
    let ncDiffers = 0
    for (const s of stores.slice(0, 20)) {
      const rows = await prisma.salesPeriodCache.findMany({ where: { storeId: s.id, orderCount: { gt: 0 } }, orderBy: { date: "desc" }, take: 1 })
      if (!rows[0]) continue
      const d = rows[0].date.toISOString().slice(0, 10)
      const ly = await prisma.salesPeriodCache.findUnique({ where: { storeId_date: { storeId: s.id, date: dbDate(shift(d, -364)) } } })
      const hrs = await prisma.salesHourlyCache.findMany({ where: { storeId: s.id, date: dbDate(shift(d, -364)) } })
      if (!ly || hrs.length === 0 || ly.orderCount === 0) continue
      const at = { hour: 9, minute: 30 }
      const st = compareTodayWithDay({ total: ly.netSales, orders: ly.orderCount, hourly: hrs.map((h) => ({ hour: h.hour, net: h.netSales, orders: h.orderCount })) }, true, at)
      if (st && !near(pctChange(rows[0].orderCount, ly.orderCount), pctChange(rows[0].orderCount, st.orders))) ncDiffers++
    }
    ok("6b NC dev: a whole-day order baseline differs from the same-time one for some store at 9:30", ncDiffers > 0)
    await prisma.$disconnect()
  } catch (e) {
    failures++
    console.error("  ✗ database section threw:", e)
  }
}

db().then(() => {
  console.log(`\nverify-tab10: ${passes} passed, ${failures} failed`)
  process.exit(failures ? 1 : 0)
})
