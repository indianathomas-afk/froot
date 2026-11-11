// TAB-9 — the tablet home's expandable cards and in-place overdue list, their
// rules as pure functions so scripts/verify-tab9-cards.ts can pin them without
// a database or a browser. The React half is src/app/(app)/dashboard/
// tablet-home.tsx (state, timers, scroll) and tablet-strip.tsx (the tiles).
//
// Gary's rulings, 2026-11-10 ("yes to all" — the wording of each is the
// planning chat's; his agreement makes them rulings; DECISIONS DRAFT TAB-9):
//   1  The overdue list opens IN PLACE under the header, not in a sheet.
//      Tapping the chip again closes it.
//   2  Cards keep their headline and expand on tap, ONE AT A TIME.
//   3  The home always scrolls; collapsing a card returns the page to where
//      it was before that card expanded.
//   4  An expanded card or the open list collapses after IDLE_COLLAPSE_MS with
//      no touch, and at the TAB-5 day rollover — never because of a refresh.
//   5  Expanded cards show only data the existing payload already carries.
//   6  The personal HR chip is amber or neutral and reads "My HR · N"; only
//      the store's overdue chip is red and says "overdue".
//   7  Expansion is never saved: React state only, no settings, cookie or
//      storage, no sync.
//
// Pure: no React, no Prisma, no Next. Imports only other pure libs.

import { formatLaborPct, judgeLaborPct, laborFootnotes, type LaborBlock, type LaborVerdict } from "@/lib/labor-judgment"
import { dayRolledOver } from "@/lib/tablet-refresh"
import { comparisonSuffix, pctChange, type DayComparison } from "@/lib/sales-same-time"

/** Ruling 4: five minutes with no touch. */
export const IDLE_COLLAPSE_MS = 5 * 60_000

/** How often the tablet home checks the idle rule. Well under the window, so
 *  a card collapses within a few seconds of the five minutes. */
export const IDLE_CHECK_MS = 5_000

// ─── The expansion state machine (rulings 1, 2, 4, 7) ────────────────────────

export type CardsState = {
  /** The expanded strip tile's key, or null. ONE at a time (ruling 2). */
  expanded: string | null
  /** The overdue list open in place (ruling 1). Independent of the cards. */
  dueOpen: boolean
  /** The last touch anywhere on the page (ms epoch). */
  lastTouchAt: number
  /** True once IDLE_COLLAPSE_MS has passed since lastTouchAt. */
  idle: boolean
  /** `${storeId}:${shownDay}` — a new day (TAB-5 rollover) or another store
   *  starts the page collapsed. */
  scope: string
}

export type CardsEvent =
  /** A tap on a strip tile: open it (closing any other), or close it. */
  | { type: "tap"; key: string; at: number }
  /** The expanded card's "Show less". */
  | { type: "showLess"; at: number }
  /** A tap on the overdue chip, or the list's Close. */
  | { type: "toggleDue"; at: number }
  /** The list emptied (its last item completed): close it, not a touch. */
  | { type: "closeDue" }
  /** Any touch on the page that is not one of the above. */
  | { type: "touch"; at: number }
  /** The idle check. `lastTouchAt` is the page's latest touch (kept in a ref
   *  so a touch does not re-render the page). */
  | { type: "tick"; at: number; lastTouchAt: number }
  /** A refresh cycle landed (TAB-5). Changes nothing — ruling 4. */
  | { type: "refresh" }
  /** The page moved to another day or store. */
  | { type: "scope"; scope: string }

export function initialCards(scope: string, now: number): CardsState {
  return { expanded: null, dueOpen: false, lastTouchAt: now, idle: false, scope }
}

/** Ruling 2 alone: what tapping `key` does to the expanded key. */
export function toggleExpanded(current: string | null, key: string): string | null {
  return current === key ? null : key
}

/** Ruling 4: has the page gone IDLE_COLLAPSE_MS without a touch? */
export function isIdle(lastTouchAt: number, now: number): boolean {
  return now - lastTouchAt >= IDLE_COLLAPSE_MS
}

/** The whole state machine. Returns the SAME object when nothing changes, so
 *  a tick or a refresh never re-renders the page. */
export function cardsReducer(s: CardsState, e: CardsEvent): CardsState {
  switch (e.type) {
    case "tap":
      return { ...s, expanded: toggleExpanded(s.expanded, e.key), lastTouchAt: Math.max(s.lastTouchAt, e.at), idle: false }
    case "showLess":
      return { ...s, expanded: null, lastTouchAt: Math.max(s.lastTouchAt, e.at), idle: false }
    case "toggleDue":
      return { ...s, dueOpen: !s.dueOpen, lastTouchAt: Math.max(s.lastTouchAt, e.at), idle: false }
    case "closeDue":
      return s.dueOpen ? { ...s, dueOpen: false } : s
    case "touch":
      if (!s.idle && e.at <= s.lastTouchAt) return s
      return { ...s, lastTouchAt: Math.max(s.lastTouchAt, e.at), idle: false }
    case "tick": {
      const last = Math.max(s.lastTouchAt, e.lastTouchAt)
      if (!isIdle(last, e.at)) return s.idle ? { ...s, lastTouchAt: last, idle: false } : s
      if (s.idle && s.expanded === null && !s.dueOpen) return s
      return { ...s, expanded: null, dueOpen: false, lastTouchAt: last, idle: true }
    }
    case "refresh":
      return s
    case "scope":
      if (e.scope === s.scope) return s
      return { ...s, expanded: null, dueOpen: false, scope: e.scope }
  }
}

/** The expanded key, but only if that tile is actually rendered for this
 *  viewer. A tile its gate hides can never be expanded (§ 3, "permissions
 *  stay the payload's"): no Labor card at all when `labor` is absent. */
export function visibleExpanded(expanded: string | null, renderedKeys: string[]): string | null {
  return expanded !== null && renderedKeys.includes(expanded) ? expanded : null
}

/** What the tablet home reports to the TAB-5 refresh controller (ruling 4:
 *  a refresh never closes or jumps an open card or list). An expanded card
 *  and the open list are busy until they close. A page scrolled away from
 *  the top is busy only while someone is using it — after the idle window a
 *  scrolled, untouched page lets the refresh run again, so a counter tablet
 *  left scrolled down never goes stale for good.
 *  TAB-9 fix (Gary, 2026-11-10): "the day rollover must never be blocked by
 *  scroll position". With `rolloverDue` true the scroll flag is off, so the
 *  cycle that adopts the new day runs however far down the page is. */
export function cardsBusy(s: Pick<CardsState, "expanded" | "dueOpen" | "idle">, scrolledAway: boolean, rolloverDue = false) {
  return {
    "cards:expanded": s.expanded !== null,
    "due:list": s.dueOpen,
    "page:scrolled": scrolledAway && !s.idle && !rolloverDue,
  }
}

/** Is a day rollover waiting? Either the last server render already names a
 *  later day than the one on screen, or the store-local clock has passed
 *  midnight since that day (TAB-5's dayRolledOver, the store's zone). */
export function rolloverDue(shownDay: string, serverDay: string, now: Date, timeZone: string): boolean {
  if (!shownDay) return false
  if (serverDay && serverDay !== shownDay) return true
  return timeZone ? dayRolledOver(shownDay, now, timeZone) : false
}

/** TAB-9 fix (Gary, 2026-11-10): where the page goes when the state moves
 *  from `prev` to `next`. Going idle (the 5-minute collapse) and a new day or
 *  store send it back to the TOP — 0; anything else leaves the scroll alone
 *  (null). The idle reset wins over ruling 3's "return to where it was":
 *  nobody is there to return to. */
export function pageScrollReset(prev: Pick<CardsState, "idle" | "scope">, next: Pick<CardsState, "idle" | "scope">): 0 | null {
  if (prev.scope !== next.scope) return 0
  if (!prev.idle && next.idle) return 0
  return null
}

/** Ruling 3: where a collapse returns the page to. The position saved when
 *  the FIRST card opened is kept while another card replaces it, so closing
 *  the last one returns to where the page was before any expanded. */
export function restoreTarget(saved: number | null, prevExpanded: string | null, nextExpanded: string | null, scrollY: number): number | null {
  if (prevExpanded === null && nextExpanded !== null) return scrollY
  if (nextExpanded === null) return null
  return saved
}

// ─── Ruling 6: the two header chips ──────────────────────────────────────────

export type ChipTone = "red" | "amber" | "neutral"

/** Classes per tone. Red is the store's overdue chip ONLY. */
export const CHIP_TONE_CLASS: Record<ChipTone, string> = {
  red: "bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)]",
  amber: "border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]",
  neutral: "border border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-foreground)]",
}

/** The store's due chip: red when anything is overdue (its label, from
 *  dueChipFor in tablet-due.ts, then says "N overdue"), amber otherwise. */
export function dueChipTone(overdue: number): ChipTone {
  return overdue > 0 ? "red" : "amber"
}

/** TAB-9 fix (Gary, 2026-11-10): "HR chip — hide it on STORE logins in
 *  Tablet mode; keep it for personal logins." A STORE login is a shared
 *  counter account, so a personal training count has no one to belong to.
 *  Desktop's ComplianceBanner is not touched. */
export function showHrChip(role: string | null): boolean {
  return role !== "STORE"
}

/** The personal HR chip (SELF-1's ComplianceChip). Never red and never the
 *  word "overdue": amber when something is past due, neutral otherwise. */
export function hrChipFor(owed: { openCount: number; overdueCount: number }): { label: string; tone: ChipTone; ariaLabel: string } {
  const plural = owed.openCount === 1 ? "" : "s"
  const late = owed.overdueCount > 0 ? `, ${owed.overdueCount} past due` : ""
  return {
    label: `My HR · ${owed.openCount}`,
    tone: owed.overdueCount > 0 ? "amber" : "neutral",
    ariaLabel: `My HR: ${owed.openCount} training or document item${plural} to complete${late}. Go to your portal.`,
  }
}

// ─── Ruling 5: what each expanded card shows, from the payload alone ─────────

/** The slice of GET /api/dashboard/summary the strip reads. */
export type StripSummary = {
  store?: { timezone: string }
  salesAvailable: boolean
  sales: {
    /** TAB-10 — `orders` is today's order count (SalesPeriodCache
     *  .orderCount). Optional only so a payload without it reads as "no
     *  Transactions / Average sale rows", never as 0; the route always sends it. */
    today: { total: number; orders?: number; hourly: { hour: number; net: number }[] }
    lastYear: { date: string; total: number; hourly: { hour: number; net: number }[] } | null
    /** TAB-7 — today so far is measured against THIS, never lastYear.total
     *  (the whole day). Built by src/lib/sales-same-time.ts on the route.
     *  Optional only so a hand-built payload without it reads as "no
     *  comparison"; the route always sends it. */
    comparison?: DayComparison | null
  } | null
  goal: { month: string; goalAmount: number | null; monthToDate: number | null; daysElapsed: number; daysInMonth: number }
  labor?: LaborBlock
}

export function hourLabel(h: number): string {
  if (h === 0) return "12 AM"
  if (h < 12) return `${h} AM`
  if (h === 12) return "12 PM"
  return `${h - 12} PM`
}

/** TAB-7 — the Sales tile's ▲/▼ and what it is measured against.
 *  Null when there is no comparison day at all (no tile aside). `pct` null
 *  with a comparison present means a $0 baseline: render "—" (lean 5).
 *  `label` is the short "vs last year by 10:15 AM" / "vs last year (full
 *  day)" line (lean 4). */
export type SalesTileComparison = { pct: number | null; label: string }

export function salesTileComparison(s: StripSummary): SalesTileComparison | null {
  const c = s.sales?.comparison
  if (!s.salesAvailable || !s.sales || !c) return null
  const suffix = comparisonSuffix(c)
  return { pct: pctChange(s.sales.today.total, c.net), label: suffix ? `vs last year ${suffix}` : "vs last year" }
}

export type SalesHourRow = { hour: number; label: string; today: number | null; lastYear: number | null }
export type SalesDetail = {
  todayTotal: number
  lastYearTotal: number | null
  lastYearDate: string | null
  /** TAB-7 — last year up to the same time of day ("by 10:15 AM"), when the
   *  comparison is same-time; null otherwise (fallback or none). */
  lastYearByNow: { net: number; asOfLabel: string } | null
  hours: SalesHourRow[]
  /** The largest hourly figure on either side — the bars' full width. */
  max: number
}

/** Sales, expanded: today hour by hour against the same weekday last year
 *  hour by hour. Every hour either day has, in order; an hour only one day
 *  has reads null on the other side (not 0 — the cache has no row for it).
 *  The ▲/▼ headline is salesTileComparison (TAB-7), not computed here.
 *  Transactions and average sale are salesCounts (TAB-10), below. Null when
 *  the tile itself would not render. */
export function salesDetail(s: StripSummary): SalesDetail | null {
  if (!s.salesAvailable || !s.sales) return null
  const today = new Map(s.sales.today.hourly.map((h) => [h.hour, h.net]))
  const ly = new Map((s.sales.lastYear?.hourly ?? []).map((h) => [h.hour, h.net]))
  const hours = [...new Set([...today.keys(), ...ly.keys()])].sort((a, b) => a - b)
  const rows = hours.map((hour) => ({
    hour,
    label: hourLabel(hour),
    today: today.get(hour) ?? null,
    lastYear: s.sales!.lastYear ? (ly.get(hour) ?? null) : null,
  }))
  const max = rows.reduce((m, r) => Math.max(m, r.today ?? 0, r.lastYear ?? 0), 0)
  return {
    todayTotal: s.sales.today.total,
    lastYearTotal: s.sales.lastYear?.total ?? null,
    lastYearDate: s.sales.lastYear?.date ?? null,
    lastYearByNow:
      s.sales.comparison?.method === "same-time" && s.sales.comparison.asOfLabel
        ? { net: s.sales.comparison.net, asOfLabel: s.sales.comparison.asOfLabel }
        : null,
    hours: rows,
    max,
  }
}

/** TAB-10 — one figure on the expanded Sales card with its ▲/▼.
 *  `pct` null with `compared` true renders "—" (a 0 baseline, or no figure
 *  today to compare); `compared` false renders no pill at all — the same two
 *  rules as the Sales tile's headline (TAB-7 lean 5). */
export type SalesCountStat = { pct: number | null; compared: boolean }
export type SalesCounts = {
  /** Today's order count. */
  transactions: number
  /** Today's net ÷ transactions; null at 0 transactions (renders "—"). */
  averageSale: number | null
  transactionsVs: SalesCountStat
  averageSaleVs: SalesCountStat
}

/** TAB-10 — Transactions and Average sale on the expanded Sales card, with
 *  the SAME definitions as the desktop Sales Performance card on Today
 *  (sales-performance-card.tsx over /api/dashboard/sales):
 *    transactions   today's order count (desktop `selected.orders`)
 *    averageSale    today's net ÷ transactions, null at 0 (`selected.avgSale`)
 *    vs last year   against TAB-7's same-time comparison: its `orders`
 *                   (pro-rated to the time of day, so possibly fractional —
 *                   desktop's `compOrders`) and its net ÷ its orders
 *                   (desktop's `compAvg`), through the one pctChange.
 *  One departure, a display rule (TAB-10, design choice): with no
 *  transactions today the average sale is "—", so its pill is "—" too;
 *  desktop measures 0 against last year's average there (▼100.0%).
 *  Null when the tile would not render, or the payload has no order count
 *  (an older answer): the rows are left out, never shown as 0. */
export function salesCounts(s: StripSummary): SalesCounts | null {
  if (!s.salesAvailable || !s.sales) return null
  const orders = s.sales.today.orders
  if (typeof orders !== "number") return null
  const averageSale = orders > 0 ? s.sales.today.total / orders : null
  const c = s.sales.comparison ?? null
  if (!c) {
    return { transactions: orders, averageSale, transactionsVs: { pct: null, compared: false }, averageSaleVs: { pct: null, compared: false } }
  }
  const compAvg = c.orders !== null && c.orders > 0 ? c.net / c.orders : null
  return {
    transactions: orders,
    averageSale,
    transactionsVs: { pct: pctChange(orders, c.orders), compared: true },
    averageSaleVs: { pct: averageSale === null ? null : pctChange(averageSale, compAvg), compared: true },
  }
}

export type GoalDetail =
  | { kind: "no-goal"; month: string; monthToDate: number }
  | {
      kind: "goal"
      month: string
      monthToDate: number
      goalAmount: number
      toGo: number
      /** Days after today — the desktop Monthly Goal card's "N days left". */
      daysLeft: number
      /** toGo spread over daysLeft; null on the month's last day or once the
       *  goal is met (nothing to spread). */
      perDayNeeded: number | null
    }

/** Monthly goal, expanded: month-to-date, the goal, and what is needed per
 *  remaining day. Month-to-date treats "no sales block" as 0, exactly as the
 *  desktop card and the collapsed tile do. */
export function goalDetail(s: StripSummary): GoalDetail {
  const month = new Date(`${s.goal.month}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })
  const monthToDate = s.goal.monthToDate ?? 0
  if (s.goal.goalAmount === null) return { kind: "no-goal", month, monthToDate }
  const toGo = Math.max(0, s.goal.goalAmount - monthToDate)
  const daysLeft = Math.max(0, s.goal.daysInMonth - s.goal.daysElapsed)
  return {
    kind: "goal",
    month,
    monthToDate,
    goalAmount: s.goal.goalAmount,
    toGo,
    daysLeft,
    perDayNeeded: daysLeft > 0 && toGo > 0 ? toGo / daysLeft : null,
  }
}

export type LaborDetail = {
  pct: string
  verdict: LaborVerdict
  target: string
  lastSyncOkAt: string | null
  notes: { text: string; tone: "warn" | "muted" }[]
}

/** TAB-9 fix (Gary, 2026-11-10): "Labor dollars — never shown on the tablet;
 *  percentages only." The summary payload carries laborCost for MANAGE-tier
 *  viewers; the tablet drops it the moment the payload arrives, so no tablet
 *  state or component ever holds a dollar labor figure. Returns the same
 *  object when there is nothing to drop. */
export function withoutLaborDollars<T extends { labor?: LaborBlock }>(s: T): T {
  if (!s.labor || !("laborCost" in s.labor)) return s
  const { laborCost: _dropped, ...labor } = s.labor
  void _dropped
  return { ...s, labor }
}

/** Labor, expanded: month-to-date %, the target, and the rest of the block as
 *  the desktop renders it (laborFootnotes — coverage, open timecards, wage
 *  gaps, stale cards, sync health, straight time). NULL WHEN `labor` IS
 *  ABSENT: a viewer whose gate hides the tile gets no card at all. laborCost
 *  (MANAGE-tier dollars) is deliberately not read — no desktop surface
 *  renders it either, and since the TAB-9 fix it never reaches here
 *  (withoutLaborDollars, Gary's ruling: percentages only). */
export function laborDetail(s: StripSummary): LaborDetail | null {
  if (!s.labor) return null
  const b = s.labor
  return {
    pct: formatLaborPct(b.laborPct),
    verdict: judgeLaborPct(b.laborPct, b.target, b.health),
    target: `${b.target.toFixed(1)}%`,
    lastSyncOkAt: b.lastSyncOkAt,
    notes: laborFootnotes(b, s.store?.timezone),
  }
}
