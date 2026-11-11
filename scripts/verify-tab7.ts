/**
 * TAB-7 — today's sales vs last year AT THE SAME TIME OF DAY.
 *
 *   npx tsx scripts/verify-tab7.ts
 *
 * Pure cases (no database) for the shared helper src/lib/sales-same-time.ts,
 * the tablet-cards readers built on it, and STRUCTURAL checks over the
 * surfaces; then READ-ONLY database checks against the dev branch (.env),
 * which print the Neon branch id beside their results. Nothing is written.
 *
 * WHAT THIS CAN DETECT:
 *   1  THE MATHS: hour boundaries, the partial current hour, before opening
 *      ($0 → no percentage → "—"), after close equalling the full day.
 *   2  A PAST DAY THAT STOPPED COMPARING FULL DAYS.
 *   3  THE FALLBACK: a comparison day with a period row but no hourly rows
 *      compares the full day and says "(full day)"; a $0 day with no hourly
 *      rows is a same-time $0, not a fallback; no cached day → no comparison.
 *   4  STORE-LOCAL TIME in two zones (and three), midnight as hour 0, and the
 *      DST days read as wall clock.
 *   5  THE TABLET TILE / EXPANDED CARD reading anything but the shared
 *      comparison (the label, the "—", the "by 10:15 AM" row).
 *   6  A SURFACE THAT DOESN'T CALL THE SHARED HELPER, or still divides by the
 *      whole day. Every check runs again over the PRE-TAB-7 sources (8365e0a)
 *      as a NEGATIVE CONTROL and must fail there.
 *   7  A NEW SQUARE CALL SITE: the syncSalesForStore / orders-search census
 *      across src/ is pinned, the touched routes' sync and gap-fill counts
 *      equal 8365e0a's, and the helper imports no database, sync or fetch.
 *   8  THE ROLLUP: it shows no last-year comparison, so TAB-7 does not touch
 *      it (departure from leans 3/6, recorded) — checked with a control.
 *   9  DATABASE (dev): Σ hourly = the period net within a cent for every
 *      cached day; for each store's comparison day, the helper's full-day,
 *      after-close and same-time figures against the cached rows.
 *  10  TAB-7 FIX (Gary, 2026-11-11: "Cut it."): a RANGE ENDING TODAY compares
 *      with the matching window, its last day cut at the same time of day;
 *      a range ending before today is unchanged (null basis). Maths, the
 *      fallback and missing-day cases, two zones, compareSelection's four
 *      branches, the route on compareSelection — with negative controls
 *      against the TAB-7 work commit 316ffd4, where ranges were not cut —
 *      and, on dev, 7-day windows ending on each store's comparison day.
 *
 * WHAT IT CANNOT DETECT: the rendered pages (the local check covers those),
 * the TAB-5/TAB-8 refresh cycle actually re-running the summary fetch (that
 * wiring is TAB-5's fixture's), and production/staging data.
 */
import "dotenv/config"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import {
  compareSelection,
  compareTodayWithDay,
  compareWindowEndingToday,
  comparisonSuffix,
  formatTimeOfDay,
  pctChange,
  salesUpTo,
  storeLocalTime,
  type HourRow,
} from "../src/lib/sales-same-time"
import { salesDetail, salesTileComparison, type StripSummary } from "../src/lib/tablet-cards"

const PRE_TAB7 = "8365e0a"
/** The TAB-7 work commit — single days cut, ranges NOT cut (the fix's NC). */
const TAB7_WORK = "316ffd4"

let failures = 0
let passes = 0
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (ok) passes++
  else failures++
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`)
  if (!ok) console.log(`      expected ${e}\n      actual   ${a}`)
}
function ok(label: string, cond: boolean, detail = "") {
  check(detail ? `${label} — ${detail}` : label, cond, true)
}
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol

// ─── 1. The maths ────────────────────────────────────────────────────────────
console.log("1. helper maths")
const H: HourRow[] = [
  { hour: 7, net: 100, orders: 10 },
  { hour: 8, net: 200, orders: 20 },
  { hour: 9, net: 300, orders: 30 },
  { hour: 10, net: 600, orders: 40 },
  { hour: 20, net: 50, orders: 5 },
]
const TOTAL = 1250
check("1a 8:00 — hour 7 only, hour 8 contributes 0 minutes", salesUpTo(H, { hour: 8, minute: 0 }), { net: 100, orders: 10 })
check("1b 9:30 — 7 + 8 + half of 9", salesUpTo(H, { hour: 9, minute: 30 }), { net: 450, orders: 45 })
check("1c 10:15 — 7..9 + a quarter of 10", salesUpTo(H, { hour: 10, minute: 15 }).net, 750)
check("1d 7:00 sharp (opening hour, 0 minutes) — $0", salesUpTo(H, { hour: 7, minute: 0 }).net, 0)
check("1e before opening (6:45) — $0", salesUpTo(H, { hour: 6, minute: 45 }).net, 0)
check("1f after close (21:30) = full day", salesUpTo(H, { hour: 21, minute: 30 }).net, TOTAL)
check("1g 23:59 = full day", salesUpTo(H, { hour: 23, minute: 59 }).net, TOTAL)
check("1h 20:59 — the last open hour at 59/60", salesUpTo(H, { hour: 20, minute: 59 }).net, 1249.17)
check("1i unsorted rows give the same answer", salesUpTo([...H].reverse(), { hour: 10, minute: 15 }).net, 750)
const st = compareTodayWithDay({ total: TOTAL, orders: 105, hourly: H }, true, { hour: 10, minute: 15 })
check("1j today with hourly rows → same-time, net by 10:15, label", [st?.method, st?.net, st?.asOfLabel], ["same-time", 750, "10:15 AM"])
check("1k the problem case: $27 at 8 AM vs a $1,280.60 full day was ▼97.9%", pctChange(27, 1280.6)?.toFixed(1), "-97.9")
const pre = compareTodayWithDay({ total: TOTAL, orders: 105, hourly: H }, true, { hour: 6, minute: 45 })
check("1l before opening: same-time $0 → no percentage (→ \"—\")", [pre?.method, pre?.net, pctChange(0, pre!.net)], ["same-time", 0, null])
check("1m pctChange: no / zero / negative baseline → null", [pctChange(5, null), pctChange(5, undefined), pctChange(5, 0), pctChange(5, -3)], [null, null, null, null])
check("1n pctChange: 600 vs 750 = -20%", pctChange(600, 750), -20)
check(
  "1o formatTimeOfDay",
  [formatTimeOfDay({ hour: 0, minute: 5 }), formatTimeOfDay({ hour: 12, minute: 0 }), formatTimeOfDay({ hour: 10, minute: 15 }), formatTimeOfDay({ hour: 23, minute: 59 })],
  ["12:05 AM", "12:00 PM", "10:15 AM", "11:59 PM"]
)
check("1p suffix: same-time", comparisonSuffix(st!), "by 10:15 AM")

// ─── 2. Past days ────────────────────────────────────────────────────────────
console.log("2. past days compare full days")
const past = compareTodayWithDay({ total: TOTAL, orders: 105, hourly: H }, false, { hour: 8, minute: 0 })
check("2a not today → full-day, the period total, no as-of", [past?.method, past?.net, past?.orders, past?.asOf], ["full-day", TOTAL, 105, null])
check("2b full-day suffix is empty (existing wording)", comparisonSuffix(past!), "")
const pastNoHours = compareTodayWithDay({ total: TOTAL, hourly: [] }, false, { hour: 8, minute: 0 })
check("2c past day without hourly rows is still a plain full day", [pastNoHours?.method, pastNoHours?.net], ["full-day", TOTAL])

// ─── 3. Fallback ─────────────────────────────────────────────────────────────
console.log("3. fallback when the comparison day has no hourly rows")
const fb = compareTodayWithDay({ total: TOTAL, orders: 105, hourly: [] }, true, { hour: 10, minute: 15 })
check("3a period row with sales, no hourly → full-day-fallback, full total", [fb?.method, fb?.net, fb?.asOfLabel], ["full-day-fallback", TOTAL, null])
check("3b labelled \"(full day)\"", comparisonSuffix(fb!), "(full day)")
const zero = compareTodayWithDay({ total: 0, orders: 0, hourly: [] }, true, { hour: 10, minute: 15 })
check("3c a $0 day with no hourly rows is same-time $0 (\"—\"), not a fallback", [zero?.method, zero?.net, pctChange(50, zero!.net)], ["same-time", 0, null])
check("3d no comparison day cached → no comparison", compareTodayWithDay(null, true, { hour: 10, minute: 15 }), null)

// ─── 4. Store-local time ─────────────────────────────────────────────────────
console.log("4. store-local time")
const I = new Date("2026-11-11T18:15:00Z")
check("4a one instant, two zones: LA 10:15, Denver 11:15", [storeLocalTime(I, "America/Los_Angeles"), storeLocalTime(I, "America/Denver")], [
  { hour: 10, minute: 15 },
  { hour: 11, minute: 15 },
])
check("4b and New York 13:15", storeLocalTime(I, "America/New_York"), { hour: 13, minute: 15 })
const la = compareTodayWithDay({ total: TOTAL, hourly: H }, true, storeLocalTime(I, "America/Los_Angeles"))
const den = compareTodayWithDay({ total: TOTAL, hourly: H }, true, storeLocalTime(I, "America/Denver"))
check("4c same hourly history, same instant: LA by 10:15 = 750, Denver by 11:15 = 1200", [la?.net, la?.asOfLabel, den?.net, den?.asOfLabel], [750, "10:15 AM", 1200, "11:15 AM"])
check("4d local midnight is hour 0, never 24", storeLocalTime(new Date("2026-11-11T08:00:00Z"), "America/Los_Angeles"), { hour: 0, minute: 0 })
check(
  "4e DST fall-back: 1:30 PDT and 1:30 PST are both wall-clock hour 1 (no shifting)",
  [storeLocalTime(new Date("2026-11-01T08:30:00Z"), "America/Los_Angeles"), storeLocalTime(new Date("2026-11-01T09:30:00Z"), "America/Los_Angeles")],
  [
    { hour: 1, minute: 30 },
    { hour: 1, minute: 30 },
  ]
)
check("4f DST spring-forward: 10:30 UTC is 3:30 PDT (2 AM does not exist)", storeLocalTime(new Date("2026-03-08T10:30:00Z"), "America/Los_Angeles"), {
  hour: 3,
  minute: 30,
})

// ─── 5. Tablet tile and expanded card ────────────────────────────────────────
console.log("5. tablet readers")
const goal = { month: "2026-11-01", goalAmount: null, monthToDate: 0, daysElapsed: 11, daysInMonth: 30 }
const strip = (comparison: StripSummary["sales"] extends infer S ? (S extends { comparison?: infer C } ? C : never) : never, todayTotal = 600): StripSummary => ({
  salesAvailable: true,
  sales: {
    today: { total: todayTotal, hourly: [{ hour: 9, net: todayTotal }] },
    lastYear: { date: "2025-11-12", total: TOTAL, hourly: H.map((h) => ({ hour: h.hour, net: h.net })) },
    comparison,
  },
  goal,
})
check("5a tile: 600 vs 750 by 10:15 → -20%, \"vs last year by 10:15 AM\"", salesTileComparison(strip(st)), { pct: -20, label: "vs last year by 10:15 AM" })
check("5b tile never divides by the whole day (would be -52%)", salesTileComparison(strip(st))!.pct !== pctChange(600, TOTAL), true)
check("5c tile, fallback: full day, \"vs last year (full day)\"", salesTileComparison(strip(fb)), { pct: -52, label: "vs last year (full day)" })
check("5d tile, $0 baseline: pct null (renders \"—\"), label kept", salesTileComparison(strip(pre, 27)), { pct: null, label: "vs last year by 6:45 AM" })
check("5e tile, no comparison day: no aside", salesTileComparison(strip(null)), null)
check("5f tile, payload without `comparison`: no aside (never the whole day)", salesTileComparison({ ...strip(null), sales: { ...strip(null).sales!, comparison: undefined } }), null)
check("5g expanded card: the \"by 10:15 AM\" row", salesDetail(strip(st))?.lastYearByNow, { net: 750, asOfLabel: "10:15 AM" })
check("5h expanded card keeps the whole-day row", salesDetail(strip(st))?.lastYearTotal, TOTAL)
check("5i expanded card, fallback: no by-now row", salesDetail(strip(fb))?.lastYearByNow, null)

// ─── 6. Structural: every surface on the shared helper ───────────────────────
console.log("6. structural — surfaces call the shared helper (with negative controls)")
const SURFACES: { file: string; must: RegExp[]; mustNot: RegExp[] }[] = [
  {
    // Tablet tile + TAB-9 expanded card's source.
    file: "src/app/api/dashboard/summary/route.ts",
    must: [/from "@\/lib\/sales-same-time"/, /comparison: compareTodayWithDay\(/],
    mustNot: [],
  },
  {
    // Desktop Sales Performance card's source.
    file: "src/app/api/dashboard/sales/route.ts",
    must: [/from "@\/lib\/sales-same-time"/, /comparisonBasis: DayComparison \| null = compareSelection\(/],
    mustNot: [],
  },
  {
    file: "src/app/(app)/dashboard/sales-performance-card.tsx",
    must: [/from "@\/lib\/sales-same-time"/, /const delta = pctChange\(value, baseline\)/, /comparisonSuffix\(basis\)/, /baseline=\{hasCompare \? compNet : null\}/],
    mustNot: [/baseline=\{hasCompare \? compareData!\.net : null\}/, /\(\(value - baseline\) \/ baseline\)/],
  },
  {
    file: "src/lib/tablet-cards.ts",
    must: [/from "@\/lib\/sales-same-time"/, /pctChange\(s\.sales\.today\.total, c\.net\)/, /comparisonSuffix\(c\)/],
    mustNot: [],
  },
  {
    file: "src/app/(app)/dashboard/tablet-strip.tsx",
    must: [/salesTileComparison\(s\)/, /lastYearByNow/],
    mustNot: [/lastYear\?\.total/, /\(\(today - ly\) \/ ly\)/],
  },
]
function surfaceOk(text: string, s: (typeof SURFACES)[number]): boolean {
  return s.must.every((r) => r.test(text)) && s.mustNot.every((r) => !r.test(text))
}
const atRev = (rev: string, p: string) => execFileSync("git", ["show", `${rev}:${p}`], { encoding: "utf8" })
const atPre = (p: string) => atRev(PRE_TAB7, p)
for (const s of SURFACES) {
  ok(`6 ${s.file} on the helper`, surfaceOk(readFileSync(s.file, "utf8"), s))
  ok(`6 NC ${s.file} at ${PRE_TAB7} FAILS the same check`, !surfaceOk(atPre(s.file), s))
}
check("6 surface count (summary→tile+card, sales→desktop, card, tablet-cards, strip)", SURFACES.length, 5)

// ─── 7. Structural: no new Square call site ──────────────────────────────────
console.log("7. structural — no new syncSalesForStore / orders-search call site")
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? (n === "generated" ? [] : walk(p)) : /\.(ts|tsx)$/.test(n) ? [p] : []
  })
}
const census: Record<string, number> = {}
for (const f of walk("src")) {
  const n = (readFileSync(f, "utf8").match(/syncSalesForStore\(|\/v2\/orders\/search/g) ?? []).length
  if (n > 0) census[f] = n
}
check("7a census of syncSalesForStore( and /v2/orders/search across src/ (pinned at TAB-7)", census, {
  "src/app/api/cron/sales-reconcile/route.ts": 1,
  "src/app/api/dashboard/rollup/route.ts": 1,
  "src/app/api/dashboard/sales/route.ts": 2,
  "src/app/api/dashboard/summary/route.ts": 2,
  "src/app/api/forecasting/backfill/route.ts": 2,
  "src/app/api/forecasting/day-report/route.ts": 1,
  "src/app/api/square/sales/sync/route.ts": 1,
  "src/app/api/webhooks/square/route.ts": 1,
  "src/lib/sales-sync.ts": 3,
})
const count = (t: string, r: RegExp) => (t.match(r) ?? []).length
for (const f of ["src/app/api/dashboard/summary/route.ts", "src/app/api/dashboard/sales/route.ts"]) {
  const now = readFileSync(f, "utf8")
  const was = atPre(f)
  check(`7b ${f}: syncSalesForStore( and ensureSalesCached( counts unchanged since ${PRE_TAB7}`, [count(now, /syncSalesForStore\(/g), count(now, /ensureSalesCached\(/g)], [
    count(was, /syncSalesForStore\(/g),
    count(was, /ensureSalesCached\(/g),
  ])
}
// Comments stripped first: the helper's header names sales-sync.ts on purpose.
const codeOnly = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
const pure = (t: string) => !/^\s*import\s/m.test(codeOnly(t)) && !/prisma|fetch\(|require\(|sales-sync/.test(codeOnly(t))
ok("7c the helper is pure: no import at all, no prisma, no fetch, no sales-sync", pure(readFileSync("src/lib/sales-same-time.ts", "utf8")))
ok("7c NC the purity check fails on summary/route.ts", !pure(readFileSync("src/app/api/dashboard/summary/route.ts", "utf8")))

// ─── 8. The rollup ───────────────────────────────────────────────────────────
console.log("8. rollup shows no last-year comparison (so TAB-7 leaves it alone)")
const NO_COMPARISON = (t: string) => !/364|salesHourlyCache|lastYear|comparison/i.test(t)
ok("8a /api/dashboard/rollup reads no comparison day", NO_COMPARISON(readFileSync("src/app/api/dashboard/rollup/route.ts", "utf8")))
ok("8a NC the same check fails on the summary route", !NO_COMPARISON(readFileSync("src/app/api/dashboard/summary/route.ts", "utf8")))
ok("8b rollup route unchanged since " + PRE_TAB7, readFileSync("src/app/api/dashboard/rollup/route.ts", "utf8") === atPre("src/app/api/dashboard/rollup/route.ts"))

// ─── 10. TAB-7 fix: ranges ending today ──────────────────────────────────────
console.log("10. ranges ending today — last day cut at the same time (TAB-7 fix)")
const W = [
  { date: "2025-11-06", total: 1000, orders: 80 },
  { date: "2025-11-07", total: 2000, orders: 150 },
  { date: "2025-11-08", total: TOTAL, orders: 105 },
]
const AT = { hour: 10, minute: 15 }
const cut = compareWindowEndingToday(W, "2025-11-08", H, AT)
check("10a earlier days in full + last day by 10:15: 1000 + 2000 + 750", [cut?.method, cut?.net, cut?.asOfLabel], ["same-time", 3750, "10:15 AM"])
check("10b orders: 80 + 150 + (10 + 20 + 30 + 40/4)", cut?.orders, 300)
check("10c NC: the uncut window total (the pre-fix comparison) is 4250, not 3750", W.reduce((s, d) => s + d.total, 0) !== cut?.net, true)
check("10d before opening on the last day: earlier days only", compareWindowEndingToday(W, "2025-11-08", H, { hour: 6, minute: 0 })?.net, 3000)
check("10e after close on the last day = the whole window", compareWindowEndingToday(W, "2025-11-08", H, { hour: 21, minute: 30 })?.net, 4250)
check("10f unsorted window, same answer", compareWindowEndingToday([...W].reverse(), "2025-11-08", H, AT)?.net, 3750)
const wfb = compareWindowEndingToday(W, "2025-11-08", [], AT)
check("10g last day has sales but no hourly rows → whole window, \"(full day)\"", [wfb?.method, wfb?.net, comparisonSuffix(wfb!)], ["full-day-fallback", 4250, "(full day)"])
const wmiss = compareWindowEndingToday(W.slice(0, 2), "2025-11-08", [], AT)
check("10h last day not cached → earlier days, plain full-day (nothing to cut)", [wmiss?.method, wmiss?.net, wmiss?.asOfLabel], ["full-day", 3000, null])
check("10i nothing cached → no comparison", compareWindowEndingToday([], "2025-11-08", [], AT), null)
const wLA = compareWindowEndingToday(W, "2025-11-08", H, storeLocalTime(I, "America/Los_Angeles"))
const wDEN = compareWindowEndingToday(W, "2025-11-08", H, storeLocalTime(I, "America/Denver"))
check("10j two zones, one instant: LA cut at 10:15 (3750), Denver at 11:15 (4200)", [wLA?.net, wDEN?.net], [3750, 4200])

const COMP = { start: "2025-11-06", end: "2025-11-08", days: W, lastHourly: H }
check(
  "10k compareSelection: range ending today (This week) → window cut",
  compareSelection({ start: "2026-11-05", end: "2026-11-07", today: "2026-11-07" }, COMP, AT),
  cut
)
check(
  "10l compareSelection: Month to date (1st → today) → window cut",
  compareSelection({ start: "2026-11-01", end: "2026-11-07", today: "2026-11-07" }, COMP, AT)?.net,
  3750
)
check(
  "10m compareSelection: range ending BEFORE today → null (window totals, unchanged)",
  compareSelection({ start: "2026-11-01", end: "2026-11-06", today: "2026-11-07" }, COMP, AT),
  null
)
check(
  "10n NC: the same range made to end today IS cut — so 10m's null is the rule, not a dead path",
  compareSelection({ start: "2026-11-01", end: "2026-11-06", today: "2026-11-06" }, COMP, AT)?.method,
  "same-time"
)
const ONE = { start: "2025-11-08", end: "2025-11-08", days: [W[2]], lastHourly: H }
check(
  "10o compareSelection: single day today → same-time (unchanged from TAB-7)",
  compareSelection({ start: "2026-11-07", end: "2026-11-07", today: "2026-11-07" }, ONE, AT),
  compareTodayWithDay({ total: TOTAL, orders: 105, hourly: H }, true, AT)
)
check(
  "10p compareSelection: single past day → full-day (unchanged from TAB-7)",
  [compareSelection({ start: "2026-11-06", end: "2026-11-06", today: "2026-11-07" }, ONE, AT)?.method, compareSelection({ start: "2026-11-06", end: "2026-11-06", today: "2026-11-07" }, ONE, AT)?.net],
  ["full-day", TOTAL]
)

const ROUTE = "src/app/api/dashboard/sales/route.ts"
const rangeWired = (t: string) =>
  /comparisonBasis: DayComparison \| null = compareSelection\(\s*\{ start, end, today \}/.test(t) &&
  /const cutsLastDay = hourly \|\| end === today/.test(t) &&
  /loadWindow\(storeId, compStart, compEnd, hourly, cutsLastDay\)/.test(t) &&
  !/compareTodayWithDay\(/.test(t)
ok("10q route: comparisonBasis from compareSelection, last-day hours read when the range ends today", rangeWired(readFileSync(ROUTE, "utf8")))
ok(`10q NC route at ${TAB7_WORK} (ranges uncut) FAILS the same check`, !rangeWired(atRev(TAB7_WORK, ROUTE)))
const helperHasCut = (t: string) => /export function compareWindowEndingToday\(/.test(t) && /if \(sel\.end !== sel\.today\) return null/.test(t)
ok("10r helper: window cut + the ends-before-today guard", helperHasCut(readFileSync("src/lib/sales-same-time.ts", "utf8")))
ok(`10r NC helper at ${TAB7_WORK} FAILS the same check`, !helperHasCut(atRev(TAB7_WORK, "src/lib/sales-same-time.ts")))

// ─── 9. Database (dev, read-only) ────────────────────────────────────────────
async function db() {
  console.log("9. database — dev, read-only")
  const { prisma } = await import("../src/lib/prisma")
  const { localDateStr } = await import("../src/lib/reports")
  try {
    const [{ b }] = await prisma.$queryRaw<{ b: string | null }[]>`SELECT current_setting('neon.branch_id', true) AS b`
    console.log(`    branch_id=${b} (dev)`)
    const [gap] = await prisma.$queryRaw<{ days: bigint; off: bigint; maxGap: number | null }[]>`
      SELECT count(*) AS days,
             count(*) FILTER (WHERE abs(p."netSales" - h.s) > 0.01) AS off,
             max(abs(p."netSales" - h.s)) AS "maxGap"
      FROM "SalesPeriodCache" p
      JOIN (SELECT "storeId", "date", sum("netSales") AS s FROM "SalesHourlyCache" GROUP BY 1, 2) h
        ON h."storeId" = p."storeId" AND h."date" = p."date"`
    const [orphan] = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "SalesPeriodCache" p
      WHERE (p."orderCount" > 0 OR p."netSales" <> 0)
        AND NOT EXISTS (SELECT 1 FROM "SalesHourlyCache" h WHERE h."storeId" = p."storeId" AND h."date" = p."date")`
    console.log(`    branch_id=${b} days with hourly=${gap.days} off-by->1¢=${gap.off} maxGap=${gap.maxGap ?? 0} periodWithSalesNoHourly=${orphan.n}`)
    ok(`9a branch_id=${b}: Σ hourly = period net within a cent on every cached day`, Number(gap.days) > 0 && Number(gap.off) === 0, `${gap.days} days, ${gap.off} off`)
    ok(`9b branch_id=${b}: no period row with sales lacks hourly rows (the fallback is defensive on dev)`, Number(orphan.n) === 0, `${orphan.n}`)

    const stores = await prisma.store.findMany({ where: { squareLocationId: { not: null }, isActive: true }, select: { id: true, timezone: true } })
    let measured = 0
    for (const s of stores) {
      const today = localDateStr(new Date(), s.timezone)
      const d = new Date(`${today}T00:00:00.000Z`)
      d.setUTCDate(d.getUTCDate() - 364)
      const period = await prisma.salesPeriodCache.findUnique({ where: { storeId_date: { storeId: s.id, date: d } } })
      if (!period) continue
      const rows = await prisma.salesHourlyCache.findMany({ where: { storeId: s.id, date: d } })
      const hourly = rows.map((r) => ({ hour: r.hour, net: r.netSales, orders: r.orderCount }))
      const day = { total: period.netSales, orders: period.orderCount, hourly }
      const full = compareTodayWithDay(day, false, { hour: 12, minute: 0 })!
      const lastHour = Math.max(...hourly.map((h) => h.hour))
      const afterClose = lastHour < 23 ? compareTodayWithDay(day, true, { hour: lastHour + 1, minute: 0 })! : null
      const noon = compareTodayWithDay(day, true, { hour: 12, minute: 0 })!
      const noonHand = hourly.filter((h) => h.hour < 12).reduce((a, h) => a + h.net, 0)
      measured++
      // 10s — a 7-day window ending on this comparison day.
      const wStart = new Date(d)
      wStart.setUTCDate(wStart.getUTCDate() - 6)
      const wRows = await prisma.salesPeriodCache.findMany({ where: { storeId: s.id, date: { gte: wStart, lte: d } } })
      const lastDate = d.toISOString().slice(0, 10)
      const wDays = wRows.map((r) => ({ date: r.date.toISOString().slice(0, 10), total: r.netSales, orders: r.orderCount }))
      const wNoon = compareWindowEndingToday(wDays, lastDate, hourly, { hour: 12, minute: 0 })!
      const wHand = wDays.filter((x) => x.date !== lastDate).reduce((a, x) => a + x.total, 0) + noonHand
      const wAll = wDays.reduce((a, x) => a + x.total, 0)
      const wClose = lastHour < 23 ? compareWindowEndingToday(wDays, lastDate, hourly, { hour: lastHour + 1, minute: 0 })! : null
      ok(
        `10s branch_id=${b} store ${s.id} window ${wStart.toISOString().slice(0, 10)}..${lastDate} (${wDays.length} days): by noon=${wNoon.net.toFixed(2)} = earlier days + last-day hours<12 (${wHand.toFixed(2)}); after close=${wClose?.net.toFixed(2)} = window ${wAll.toFixed(2)}`,
        wNoon.method === "same-time" && near(wNoon.net, wHand) && (wClose === null || near(wClose.net, wAll)) && !near(wNoon.net, wAll)
      )
      ok(
        `9c branch_id=${b} store ${s.id} ${d.toISOString().slice(0, 10)}: full-day=${full.net.toFixed(2)} = period; after close=${afterClose?.net.toFixed(2)}; by noon=${noon.net.toFixed(2)} = Σ hours<12`,
        near(full.net, period.netSales) && (afterClose === null || near(afterClose.net, period.netSales)) && noon.method === "same-time" && near(noon.net, noonHand)
      )
    }
    ok(`9d branch_id=${b}: at least one store's comparison day measured`, measured > 0, `${measured}/${stores.length} stores`)
  } finally {
    await prisma.$disconnect()
  }
}

db()
  .catch((e) => {
    failures++
    console.error("  ✗ database section threw:", e)
  })
  .finally(() => {
    console.log(`\nverify-tab7: ${passes} passed, ${failures} failed`)
    process.exitCode = failures === 0 ? 0 : 1
  })
