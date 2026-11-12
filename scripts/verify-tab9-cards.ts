/**
 * TAB-9 — the tablet home's expandable cards, in-place overdue list and chips,
 * pinned.
 *
 *   npx tsx scripts/verify-tab9-cards.ts
 *
 * PURE, in the verify-tab5-refresh.ts style: no database, no browser, fixed
 * instants and hand-built payloads shaped like GET /api/dashboard/summary.
 *
 * WHAT THIS CAN DETECT:
 *   - TWO CARDS OPEN AT ONCE, or a tap that fails to close its own card
 *     (ruling 2). Cases 1.
 *   - AN EXPANDED CARD BUILT FROM ANYTHING BUT THE PAYLOAD, or built wrong:
 *     hours out of order, a missing hour read as $0 instead of "—", the
 *     per-remaining-day figure on the wrong day count (ruling 5). Cases 2.
 *   - A HIDDEN FIELD LEAKING THROUGH AN EXPANDED CARD: with `labor` absent
 *     there is no Labor card at all, collapsed or expanded, and a stale
 *     "labor-pct" expansion cannot surface it; laborCost is never read
 *     (§ 3, permissions stay the payload's). Cases 3.
 *   - AN IDLE COLLAPSE THAT FIRES EARLY, LATE OR NOT AT ALL (ruling 4). Cases 4.
 *   - A REFRESH THAT COLLAPSES ANYTHING, or a refresh that runs while a card
 *     or the list is open (ruling 4 through TAB-5's busy flags). Cases 5.
 *   - A DAY ROLLOVER OR STORE SWITCH THAT LEAVES A CARD OPEN (ruling 4). Cases 6.
 *   - THE TWO CHIPS CLASHING AGAIN: the HR chip red, or saying "overdue"; the
 *     store chip losing its red (ruling 6). Cases 7.
 *   - A COLLAPSE THAT RETURNS THE PAGE TO THE WRONG PLACE (ruling 3). Cases 8.
 *
 * TAB-9 FIX (Gary, 2026-11-10), cases 9-12:
 *   - AN IDLE PAGE LEFT SCROLLED DOWN, or one that still holds the refresh:
 *     after the 5-minute idle the page goes to the top and the refresh
 *     resumes. Cases 9.
 *   - A DAY ROLLOVER BLOCKED BY SCROLL POSITION ("the day rollover must never
 *     be blocked by scroll position"). Cases 10.
 *   - THE HR CHIP ON A SHARED STORE LOGIN ("hide it on STORE logins in Tablet
 *     mode; keep it for personal logins"). Cases 11.
 *   - A LABOR DOLLAR FIGURE REACHING TABLET STATE ("Labor dollars — never
 *     shown on the tablet; percentages only"). Cases 12.
 *
 * TAB-15 RULING (Gary, 2026-11-12), cases 13:
 *   - THE HOW-TO IDLE WINDOW WRONG: "While a How-to is open (panel, player or
 *     expanded row), the idle timer waits 15 minutes instead of 5. Idle stays
 *     exactly the same everywhere else." Idle at 5:00 with a How-to open, not
 *     idle at 15:00, or the 5-minute window moved when none is open.
 *
 * WHAT IT CANNOT DETECT: the React wiring (that the listeners and the idle
 * timer are attached, that the busy flags reach the controller), the layout
 * (first screen unchanged, flicks chaining out of the columns on iPad), and
 * that nothing is persisted (ruling 7 — there is no storage call in the
 * code to test; the local check and Gary's staging list cover the rest).
 */
import {
  CHIP_TONE_CLASS,
  HOWTO_IDLE_MS,
  IDLE_COLLAPSE_MS,
  cardsBusy,
  cardsReducer,
  dueChipTone,
  goalDetail,
  hrChipFor,
  idleWindow,
  initialCards,
  isIdle,
  laborDetail,
  pageScrollReset,
  restoreTarget,
  rolloverDue,
  salesDetail,
  showHrChip,
  toggleExpanded,
  visibleExpanded,
  withoutLaborDollars,
  type CardsState,
  type StripSummary,
} from "../src/lib/tablet-cards"
import { isBusy, nextShownDay, shouldRunCycle } from "../src/lib/tablet-refresh"
import { dueChipFor } from "../src/lib/tablet-due"
import type { LaborBlock } from "../src/lib/labor-judgment"

let failures = 0

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failures++
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`)
  if (!ok) console.log(`      expected ${e}\n      actual   ${a}`)
}

const T0 = Date.UTC(2026, 10, 10, 18, 0, 0) // 2026-11-10 10:00 PST
const SCOPE = "store-a:2026-11-10"

function run(s: CardsState, ...events: Parameters<typeof cardsReducer>[1][]): CardsState {
  return events.reduce(cardsReducer, s)
}

// ── Payloads shaped like GET /api/dashboard/summary ──
const labor: LaborBlock = {
  laborPct: 18.4,
  target: 20,
  health: "fresh",
  daysCovered: 9,
  daysInWindow: 10,
  openTimecardCount: 2,
  wageMissingCount: 0,
  costComplete: true,
  otApplied: false,
  lastSyncOkAt: "2026-11-10T17:45:00.000Z",
}
const full: StripSummary = {
  store: { timezone: "America/Los_Angeles" },
  salesAvailable: true,
  sales: {
    today: {
      total: 812,
      hourly: [
        { hour: 9, net: 310 },
        { hour: 7, net: 120 },
        { hour: 8, net: 382 },
      ],
    },
    lastYear: {
      date: "2025-11-11",
      total: 2410,
      hourly: [
        { hour: 7, net: 150 },
        { hour: 8, net: 400 },
        { hour: 10, net: 455 },
      ],
    },
  },
  goal: { month: "2026-11-01", goalAmount: 60_000, monthToDate: 20_000, daysElapsed: 10, daysInMonth: 30 },
  labor,
}
const noLabor: StripSummary = { ...full, labor: undefined }
const TILES = ["sales", "monthly-goal", "labor-pct"]
// What renders: the same rule as tablet-strip.tsx's tile() — sales needs a
// sales block, goal always renders, labor only when the payload carries it.
const rendered = (s: StripSummary) =>
  TILES.filter((t) => (t === "sales" ? s.salesAvailable && !!s.sales : t === "labor-pct" ? !!s.labor : true))

console.log("\n1 · One card at a time (ruling 2)")
{
  const s0 = initialCards(SCOPE, T0)
  check("1  starts collapsed, list closed", [s0.expanded, s0.dueOpen], [null, false])
  const s1 = run(s0, { type: "tap", key: "sales", at: T0 + 1 })
  check("1a tap Sales → Sales expanded", s1.expanded, "sales")
  const s2 = run(s1, { type: "tap", key: "monthly-goal", at: T0 + 2 })
  check("1b tap Goal while Sales is open → Goal expanded, Sales closed", s2.expanded, "monthly-goal")
  check("1c tap Goal again → nothing expanded", run(s2, { type: "tap", key: "monthly-goal", at: T0 + 3 }).expanded, null)
  check("1d Show less → nothing expanded", run(s2, { type: "showLess", at: T0 + 3 }).expanded, null)
  check("1e toggleExpanded is the whole rule", [toggleExpanded(null, "a"), toggleExpanded("a", "a"), toggleExpanded("a", "b")], ["a", null, "b"])
  const s3 = run(s1, { type: "toggleDue", at: T0 + 4 })
  check("1f the overdue list is independent of the cards (both may be open)", [s3.expanded, s3.dueOpen], ["sales", true])
  check("1g tapping the chip again closes the list (ruling 1)", run(s3, { type: "toggleDue", at: T0 + 5 }).dueOpen, false)
  check("1h the list emptying closes it", run(s3, { type: "closeDue" }).dueOpen, false)
}

console.log("\n2 · Detail rows built from the payload (ruling 5)")
{
  const d = salesDetail(full)!
  check("2  sales: today's total and last year's whole-day total, as carried", [d.todayTotal, d.lastYearTotal, d.lastYearDate], [812, 2410, "2025-11-11"])
  check(
    "2a sales: every hour either day has, in order",
    d.hours.map((h) => h.label),
    ["7 AM", "8 AM", "9 AM", "10 AM"]
  )
  check(
    "2b sales: an hour only one day has reads null on the other side, never 0",
    d.hours.map((h) => [h.today, h.lastYear]),
    [[120, 150], [382, 400], [310, null], [null, 455]]
  )
  check("2c sales: the bars' scale is the largest hour on either side", d.max, 455)
  check(
    "2d sales: no last-year row → last-year column all null, not zero",
    salesDetail({ ...full, sales: { ...full.sales!, lastYear: null } })!.hours.map((h) => h.lastYear),
    [null, null, null]
  )
  check("2e sales: no sales block → no Sales card", salesDetail({ ...full, salesAvailable: false }), null)

  const g = goalDetail(full)
  check(
    "2f goal: month-to-date, goal, to go, days left (desktop's daysInMonth − daysElapsed), per remaining day",
    g,
    { kind: "goal", month: "November", monthToDate: 20_000, goalAmount: 60_000, toGo: 40_000, daysLeft: 20, perDayNeeded: 2_000 }
  )
  const last = goalDetail({ ...full, goal: { ...full.goal, daysElapsed: 30 } })
  check("2g goal: on the month's last day nothing is spread → perDayNeeded null", last.kind === "goal" ? [last.daysLeft, last.perDayNeeded] : null, [0, null])
  const met = goalDetail({ ...full, goal: { ...full.goal, monthToDate: 61_000 } })
  check("2h goal: goal met → to go 0, nothing per day", met.kind === "goal" ? [met.toGo, met.perDayNeeded] : null, [0, null])
  check(
    "2i goal: no goal set → the no-goal card with month-to-date",
    goalDetail({ ...full, goal: { ...full.goal, goalAmount: null } }),
    { kind: "no-goal", month: "November", monthToDate: 20_000 }
  )
  check(
    "2j goal: no sales block (monthToDate null) reads 0, as the desktop card does",
    goalDetail({ ...full, goal: { ...full.goal, monthToDate: null } }).monthToDate,
    0
  )

  const l = laborDetail(full)!
  check("2k labor: month-to-date %, verdict, target, last sync", [l.pct, l.verdict, l.target, l.lastSyncOkAt], ["18.4%", "within", "20.0%", "2026-11-10T17:45:00.000Z"])
  check(
    "2l labor: the rest of the block, as the desktop's footnotes word it",
    l.notes.map((n) => n.text),
    [
      "9 of 10 days synced — the percentage covers those days only.",
      "2 on the clock — this number is still moving.",
      "*Straight time — overtime is not applied.",
    ]
  )
}

console.log("\n3 · The labor gate: an expanded card never exposes a hidden field")
{
  check("3  labor absent → no Labor detail", laborDetail(noLabor), null)
  check("3a labor absent → no Labor tile among those rendered", rendered(noLabor), ["sales", "monthly-goal"])
  const stale = run(initialCards(SCOPE, T0), { type: "tap", key: "labor-pct", at: T0 + 1 })
  check("3b a 'labor-pct' expansion with labor absent shows nothing", visibleExpanded(stale.expanded, rendered(noLabor)), null)
  check("3c …and holds no refresh", cardsBusy({ ...stale, expanded: visibleExpanded(stale.expanded, rendered(noLabor)) }, false)["cards:expanded"], false)
  check("3d labor present → the Labor card can open", visibleExpanded(stale.expanded, rendered(full)), "labor-pct")
  const withCost = laborDetail({ ...full, labor: { ...labor, laborCost: 4321.5 } })!
  check(
    "3e laborCost (MANAGE-tier dollars) is never read into the card",
    JSON.stringify(withCost).includes("4321"),
    false
  )
}

console.log("\n4 · Idle collapse after five minutes (ruling 4)")
{
  check("4  the window is five minutes", IDLE_COLLAPSE_MS, 300_000)
  const open = run(initialCards(SCOPE, T0), { type: "tap", key: "sales", at: T0 }, { type: "toggleDue", at: T0 })
  const almost = run(open, { type: "tick", at: T0 + IDLE_COLLAPSE_MS - 1, lastTouchAt: T0 })
  check("4a 4:59.999 with no touch → still open, same object", [almost === open, almost.expanded, almost.dueOpen], [true, "sales", true])
  const gone = run(open, { type: "tick", at: T0 + IDLE_COLLAPSE_MS, lastTouchAt: T0 })
  check("4b 5:00 with no touch → card and list both collapse", [gone.expanded, gone.dueOpen, gone.idle], [null, false, true])
  const touched = run(open, { type: "tick", at: T0 + IDLE_COLLAPSE_MS, lastTouchAt: T0 + 60_000 })
  check("4c a touch at 1:00 restarts the window → still open at 5:00", touched.expanded, "sales")
  check(
    "4d …and collapses at 6:00",
    run(touched, { type: "tick", at: T0 + 60_000 + IDLE_COLLAPSE_MS, lastTouchAt: T0 + 60_000 }).expanded,
    null
  )
  check("4e isIdle boundary", [isIdle(T0, T0 + IDLE_COLLAPSE_MS - 1), isIdle(T0, T0 + IDLE_COLLAPSE_MS)], [false, true])
  const idleAgain = run(gone, { type: "tick", at: T0 + IDLE_COLLAPSE_MS + 5_000, lastTouchAt: T0 })
  check("4f idle and already collapsed → the tick returns the same object", idleAgain === gone, true)
  check("4g a touch after idle wakes the page", run(gone, { type: "touch", at: T0 + IDLE_COLLAPSE_MS + 9_000 }).idle, false)
}

console.log("\n5 · No collapse on a refresh cycle (ruling 4, via TAB-5's busy flags)")
{
  const open = run(initialCards(SCOPE, T0), { type: "tap", key: "monthly-goal", at: T0 }, { type: "toggleDue", at: T0 })
  let s = open
  for (let i = 0; i < 5; i++) s = run(s, { type: "refresh" }, { type: "tick", at: T0 + (i + 1) * 60_000, lastTouchAt: T0 + i * 60_000 })
  check("5  five 60s cycles with someone using the page → card and list still open", [s.expanded, s.dueOpen], ["monthly-goal", true])
  check("5a a refresh event is the identity", run(open, { type: "refresh" }) === open, true)
  const visibleIdle = { visibilityState: "visible", busy: false, refreshing: false, online: true }
  const flags = (st: CardsState, scrolled: boolean) => isBusy(Object.values(cardsBusy(st, scrolled)), 0)
  check("5b a card open → the cycle is skipped", shouldRunCycle({ ...visibleIdle, busy: flags(run(initialCards(SCOPE, T0), { type: "tap", key: "sales", at: T0 }), false) }), false)
  check("5c the list open → the cycle is skipped", shouldRunCycle({ ...visibleIdle, busy: flags(run(initialCards(SCOPE, T0), { type: "toggleDue", at: T0 }), false) }), false)
  check("5d scrolled down and in use → skipped (nothing jumps under a reader)", shouldRunCycle({ ...visibleIdle, busy: flags(initialCards(SCOPE, T0), true) }), false)
  const idleScrolled = run(initialCards(SCOPE, T0), { type: "tick", at: T0 + IDLE_COLLAPSE_MS, lastTouchAt: T0 })
  check("5e scrolled down but idle → the cycle runs (a counter tablet never goes stale for good)", shouldRunCycle({ ...visibleIdle, busy: flags(idleScrolled, true) }), true)
  check("5f nothing open, at the top → the cycle runs", shouldRunCycle({ ...visibleIdle, busy: flags(initialCards(SCOPE, T0), false) }), true)
}

console.log("\n6 · Collapse at day rollover (ruling 4) and on a store switch")
{
  const open = run(initialCards(SCOPE, T0), { type: "tap", key: "sales", at: T0 }, { type: "toggleDue", at: T0 })
  const next = run(open, { type: "scope", scope: "store-a:2026-11-11" })
  check("6  the shown day moves → card and list collapse", [next.expanded, next.dueOpen, next.scope], [null, false, "store-a:2026-11-11"])
  check("6a another store → collapse", run(open, { type: "scope", scope: "store-b:2026-11-10" }).expanded, null)
  check("6b the same scope again → the same object", run(open, { type: "scope", scope: SCOPE }) === open, true)
}

console.log("\n7 · The two chips stop clashing (ruling 6)")
{
  const hr = hrChipFor({ openCount: 2, overdueCount: 1 })
  check("7  HR chip reads 'My HR · 2'", hr.label, "My HR · 2")
  check("7a HR chip with something past due is amber, never red", hr.tone, "amber")
  check("7b HR chip with nothing past due is neutral", hrChipFor({ openCount: 3, overdueCount: 0 }).tone, "neutral")
  check(
    "7c HR chip never says 'overdue', visibly or to a screen reader",
    [hr.label, hr.ariaLabel, hrChipFor({ openCount: 1, overdueCount: 1 }).ariaLabel].some((t) => /overdue/i.test(t)),
    false
  )
  check("7d HR chip's classes carry no destructive token", /destructive/.test(CHIP_TONE_CLASS[hr.tone]) || /destructive/.test(CHIP_TONE_CLASS.neutral), false)
  const now = "2026-11-10T18:00:00.000Z"
  const feed = [
    { id: "a", storeId: "store-a", dueAt: "2026-11-09T18:00:00.000Z", daysOverdue: 1 },
    { id: "b", storeId: "store-a", dueAt: "2026-11-10T23:00:00.000Z", daysOverdue: 0 },
  ]
  const chip = dueChipFor(feed, "store-a", now)
  check("7e store chip with an overdue item: red, says 'overdue'", [dueChipTone(chip.overdue), chip.label], ["red", "1 overdue"])
  const later = dueChipFor([feed[1]], "store-a", now)
  check("7f store chip with only due-today items: amber, says 'due'", [dueChipTone(later.overdue), later.label], ["amber", "1 due"])
  check("7g red is the destructive token", /destructive/.test(CHIP_TONE_CLASS.red), true)
}

console.log("\n8 · Collapsing returns the page to where it was (ruling 3)")
{
  check("8  first card opens at scrollY 0 → saves 0", restoreTarget(null, null, "sales", 0), 0)
  check("8a another card replaces it after scrolling to 900 → keeps 0", restoreTarget(0, "sales", "monthly-goal", 900), 0)
  check("8b the last card closes → nothing saved any more (the page scrolls back to 0)", restoreTarget(0, "monthly-goal", null, 900), null)
  check("8c opened while scrolled to 120 → saves 120", restoreTarget(null, null, "labor-pct", 120), 120)
}

const visible = { visibilityState: "visible", busy: false, refreshing: false, online: true }
const LA = "America/Los_Angeles"

console.log("\n9 · TAB-9 fix: after the idle, the page goes to the top and the refresh resumes")
{
  const inUse = run(initialCards(SCOPE, T0), { type: "tap", key: "sales", at: T0 })
  const idled = run(inUse, { type: "tick", at: T0 + IDLE_COLLAPSE_MS, lastTouchAt: T0 })
  check("9  going idle sends the page to the top (0)", pageScrollReset(inUse, idled), 0)
  check("9a idle releases page:scrolled even before the scroll lands", cardsBusy(idled, true)["page:scrolled"], false)
  check("9b idle + collapsed + still scrolled → the cycle runs", shouldRunCycle({ ...visible, busy: isBusy(Object.values(cardsBusy(idled, true)), 0) }), true)
  check("9c …and once at the top → the cycle runs", shouldRunCycle({ ...visible, busy: isBusy(Object.values(cardsBusy(idled, false)), 0) }), true)
  const stillIdle = run(idled, { type: "tick", at: T0 + IDLE_COLLAPSE_MS + 5_000, lastTouchAt: T0 })
  check("9d staying idle → no second reset (null)", pageScrollReset(idled, stillIdle), null)
  const woke = run(idled, { type: "touch", at: T0 + IDLE_COLLAPSE_MS + 9_000 })
  check("9e a touch after idle → no reset (null)", pageScrollReset(idled, woke), null)
  const tapped = run(inUse, { type: "tap", key: "monthly-goal", at: T0 + 1 })
  check("9f an ordinary tap → no reset (null; ruling 3's restore handles collapses)", pageScrollReset(inUse, tapped), null)
  const untouchedScrolled = run(initialCards(SCOPE, T0), { type: "tick", at: T0 + 60_000, lastTouchAt: T0 })
  check("9g scrolled and touched 1 min ago → still holds the refresh", cardsBusy(untouchedScrolled, true)["page:scrolled"], true)
}

console.log("\n10 · TAB-9 fix: the day rollover is never blocked by scroll position")
{
  const inUse = run(initialCards(SCOPE, T0), { type: "tick", at: T0 + 60_000, lastTouchAt: T0 + 30_000 })
  const before = new Date("2026-11-11T07:59:00Z") // 11:59 PM Pacific, Nov 10
  const after = new Date("2026-11-11T08:01:00Z") // 12:01 AM Pacific, Nov 11
  check("10  before the store's midnight → no rollover due", rolloverDue("2026-11-10", "2026-11-10", before, LA), false)
  check("10a past the store's midnight → rollover due (clock)", rolloverDue("2026-11-10", "2026-11-10", after, LA), true)
  check("10b server already on the next day → rollover due", rolloverDue("2026-11-10", "2026-11-11", before, LA), true)
  check("10c scrolled + in use, no rollover → holds the refresh", cardsBusy(inUse, true, false)["page:scrolled"], true)
  const flags = cardsBusy(inUse, true, rolloverDue("2026-11-10", "2026-11-10", after, LA))
  check("10d scrolled + in use, rollover due → scroll flag off", flags["page:scrolled"], false)
  check("10e …so the cycle runs", shouldRunCycle({ ...visible, busy: isBusy(Object.values(flags), 0) }), true)
  check(
    "10f …and the new day is adopted (nextShownDay sees not-busy)",
    nextShownDay("2026-11-10", "2026-11-11", isBusy(Object.values(cardsBusy(inUse, true, true)), 0)),
    "2026-11-11"
  )
  const rolled = run(inUse, { type: "scope", scope: "store-a:2026-11-11" })
  check("10g the new day sends the page to the top", pageScrollReset(inUse, rolled), 0)
  check("10h an open card still holds it (ruling 4: collapses at idle, then rolls)", cardsBusy({ ...inUse, expanded: "sales" }, true, true)["cards:expanded"], true)
}

console.log("\n11 · TAB-9 fix: the HR chip is hidden on STORE logins, kept for personal logins")
{
  check("11  STORE → hidden", showHrChip("STORE"), false)
  check(
    "11a ADMIN, MANAGER, STAFF → shown",
    ["ADMIN", "MANAGER", "STAFF"].map((r) => showHrChip(r)),
    [true, true, true]
  )
  check("11b no role resolved → shown (the route's own gates still decide)", showHrChip(null), true)
}

console.log("\n12 · TAB-9 fix: labor dollars never reach the tablet — percentages only")
{
  const manage = { ...full, labor: { ...labor, laborCost: 4321.5 } }
  const clean = withoutLaborDollars(manage)
  check("12  laborCost dropped from the payload the tablet keeps", "laborCost" in (clean.labor ?? {}), false)
  check("12a the percentage and target survive", [clean.labor?.laborPct, clean.labor?.target], [18.4, 20])
  check("12b the input is not mutated", manage.labor.laborCost, 4321.5)
  check("12c nothing to drop → the same object", withoutLaborDollars(full) === full, true)
  check("12d labor absent → the same object (still no Labor card)", withoutLaborDollars(noLabor) === noLabor, true)
  check("12e no dollar sign anywhere in the expanded Labor card", /\$/.test(JSON.stringify(laborDetail(clean))), false)
}

console.log("\n13 · TAB-15 ruling: an open How-to stretches the idle to 15 minutes, nothing else")
{
  check("13  the How-to window is fifteen minutes", HOWTO_IDLE_MS, 900_000)
  check("13a idleWindow: How-to open → 15 min, closed → the unchanged 5", [idleWindow(true), idleWindow(false)], [900_000, IDLE_COLLAPSE_MS])
  const open = run(initialCards(SCOPE, T0), { type: "tap", key: "sales", at: T0 })
  const at5 = run(open, { type: "tick", at: T0 + IDLE_COLLAPSE_MS, lastTouchAt: T0, idleAfterMs: idleWindow(true) })
  check("13b How-to open, 5:00 untouched → NOT idle, card still open, same object", [at5 === open, at5.idle, at5.expanded], [true, false, "sales"])
  const almost = run(open, { type: "tick", at: T0 + HOWTO_IDLE_MS - 1, lastTouchAt: T0, idleAfterMs: idleWindow(true) })
  check("13c How-to open, 14:59.999 → still not idle", almost.idle, false)
  const at15 = run(open, { type: "tick", at: T0 + HOWTO_IDLE_MS, lastTouchAt: T0, idleAfterMs: idleWindow(true) })
  check("13d How-to open, 15:00 → idle, collapses as before", [at15.idle, at15.expanded], [true, null])
  check(
    "13e How-to closed → idle at 5:00 exactly as TAB-9 (explicit window = default)",
    [
      run(open, { type: "tick", at: T0 + IDLE_COLLAPSE_MS, lastTouchAt: T0, idleAfterMs: idleWindow(false) }).idle,
      run(open, { type: "tick", at: T0 + IDLE_COLLAPSE_MS, lastTouchAt: T0 }).idle,
    ],
    [true, true]
  )
  const touched = run(open, { type: "tick", at: T0 + HOWTO_IDLE_MS, lastTouchAt: T0 + 60_000, idleAfterMs: idleWindow(true) })
  check("13f a touch at 1:00 restarts the 15-minute window too", touched.idle, false)
  check("13g isIdle with the How-to window", [isIdle(T0, T0 + HOWTO_IDLE_MS - 1, HOWTO_IDLE_MS), isIdle(T0, T0 + HOWTO_IDLE_MS, HOWTO_IDLE_MS)], [false, true])
}

console.log(failures === 0 ? "\n✓ ALL PASS\n" : `\n✗ ${failures} CHECK(S) FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
