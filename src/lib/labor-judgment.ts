// AL-2 — ADVANCED LABOR PHASE 2. Design record: docs/ADVANCED_LABOR.md § Phase 2.
//
// THE SHARED COMPARATOR AND THE SHARED PAYLOAD, and they live here rather than
// inside a card for the reason the seam keeps re-teaching: three surfaces render
// this judgment (Sales Performance, Monthly Goal, All Locations) and three
// hand-copied ternaries is how two of them end up disagreeing about what "over
// budget" means. Pure — no prisma, no next — so client components can import it.
//
// WHAT THIS FILE DOES NOT DO: it does not read Square, it does not read the
// database, and it does not touch a core labor engine. L-2 seam (b) is unchanged
// — labor-budget.ts / labor-plan.ts / labor-coverage.ts / labor-forecast.ts
// neither import this nor are imported by it.

import type { LaborActualsResult, LaborHealth } from "@/lib/labor-actuals"

/// The judgment, and the four states are NOT interchangeable:
/// - "within" / "near" / "over" are real verdicts on a trustworthy number.
/// - "unjudged" is the refusal to render a verdict at all, and it is load-bearing.
///   A stale or never-synced number painted green is a false reassurance, which is
///   worse than no colour — seam (c)'s rule applied to the judgment rather than to
///   the value.
export type LaborVerdict = "within" | "near" | "over" | "unjudged"

/// The amber band sits ONE POINT ABOVE TARGET — a grace band on the over-budget
/// side, not a caution band on the under-budget side.
///
/// THIS DELIBERATELY DIVERGES FROM zone() (Gary, 2026-08-19, superseding his own
/// R3 of the same day). zone() in labor-budget-card.tsx puts amber BELOW target
/// (`projected > target - 1`), warning a planner who is cutting it fine while
/// still inside budget; R3 originally said to reuse that scale verbatim. Gary
/// flipped it for ACTUALS, and the two are different questions: a PLAN that lands
/// a hair under target is worth a nudge, whereas an ACTUAL that lands at or under
/// target is simply a win and must read as one. Meeting budget is green, full
/// stop — vision item 3's "green if meets/exceeds", now literal.
///
/// THE VISIBLE CONSEQUENCE, so nobody rediscovers it as a bug: on one dashboard a
/// store at 19.5% against a 20% target shows AMBER on the Labor Budget card
/// (planned) and GREEN on every labor % readout (actual). Intended asymmetry, not
/// drift.
export const LABOR_OVER_BAND_POINTS = 1

/// Judged against laborTargetPct AS THE OPERATOR SET IT (Gary's R2, 2026-08-19) —
/// never against computeWeeklyLaborBudget's projectedLaborPctAtForecast, which is
/// lower because the sales basis is floored to the rounding tier. That flooring is
/// scheduling conservatism, not a judgment threshold: judging actuals against the
/// floored rate would mark a store "over" at 19% when the operator set 20%.
export function judgeLaborPct(pct: number | null, target: number, health: LaborHealth): LaborVerdict {
  // No number, no verdict. laborPct is null when there are no sales on the
  // covered days, which is "no sales yet" and not 0%.
  if (pct === null) return "unjudged"
  // NEVER JUDGE DATA THAT IS NOT CURRENT. "never" has nothing to judge; "stale"
  // and "error" have a real number that describes a moment that has passed, and
  // the surface says so with a last-synced stamp instead of a colour.
  if (health !== "fresh") return "unjudged"
  // AT OR UNDER TARGET IS GREEN. The `<=` is the ruling: meeting budget exactly is
  // meeting budget, and an operator who hits 20.0% against a 20% target must not
  // be shown a warning colour for succeeding.
  if (pct <= target) return "within"
  // Over, but inside the grace band — over budget and worth seeing, not yet worth
  // alarm.
  if (pct <= target + LABOR_OVER_BAND_POINTS) return "near"
  return "over"
}

/// Tailwind/CSS classes per verdict, matching the tokens the dashboard already
/// uses for on-pace / behind (rollup-view.tsx, dashboard-client.tsx).
/// "over" is BOLD RED by Gary's vision item 3, which asked for it by name.
export function laborVerdictClass(verdict: LaborVerdict): string {
  switch (verdict) {
    case "within":
      return "text-[var(--color-success-text,#1d7c2e)]"
    case "near":
      return "text-[var(--color-warning-text,#a36a00)]"
    case "over":
      return "font-bold text-[#b42318]"
    case "unjudged":
      return "text-[var(--color-muted-foreground)]"
  }
}

/// The meter fill, same three zones. Used by the slim labor bar on the Sales
/// Performance card (Gary's R5: no recolouring of the sales graph).
export function laborVerdictBar(verdict: LaborVerdict): string {
  switch (verdict) {
    case "within":
      return "var(--color-success)"
    case "near":
      return "var(--color-warning)"
    case "over":
      return "#e5484d"
    case "unjudged":
      return "var(--color-muted-foreground)"
  }
}

/// One decimal, and AN EM-DASH FOR NULL — never "0%", never "0.0%". The whole
/// module exists so this one substitution cannot be made by accident.
export function formatLaborPct(pct: number | null): string {
  return pct === null ? "—" : `${pct.toFixed(1)}%`
}

// ─── THE DASHBOARD PAYLOAD ────────────────────────────────────────────────────

/// What a dashboard route sends for labor. AGGREGATES ONLY, and one step
/// stricter than getLaborActuals: `laborCost` is OPTIONAL and present only for
/// viewers who can see labor dollars (Gary's Q-V ruling, 2026-08-19 — the
/// percentage is OPERATIONAL, the dollars stay MANAGE). No hours, no team member,
/// no wage, no name — none of those exist in LaborActualsResult to begin with.
export type LaborBlock = {
  laborPct: number | null
  /// The store's laborTargetPct (LaborSettings, per-store row over org default).
  target: number
  health: LaborHealth
  /// See LaborActualsResult.daysCovered — the surface renders "N of M days synced"
  /// whenever these differ. A partial month is EXPECTED and is fine (Gary,
  /// 2026-08-19); what is not fine is rendering it as if it were the whole month.
  daysCovered: number
  daysInWindow: number
  openTimecardCount: number
  wageMissingCount: number
  costComplete: boolean
  /// Always false in Phase 2 — straight time only, overtime still deferred by
  /// ruling. Carried so a card cannot render the number as if OT were handled.
  otApplied: false
  lastSyncOkAt: string | null
  /// Dollars. MANAGE-tier viewers only; absent — not zeroed — for everyone else.
  laborCost?: number
}

/// Narrows a full LaborActualsResult down to what a dashboard may carry.
/// `includeDollars` is the ONLY way laborCost reaches a payload, so the
/// MANAGE-gate is expressed once instead of at each of the three routes.
export function toLaborBlock(
  actuals: LaborActualsResult,
  target: number,
  includeDollars: boolean
): LaborBlock {
  return {
    laborPct: actuals.laborPct,
    target,
    health: actuals.health,
    daysCovered: actuals.daysCovered,
    daysInWindow: actuals.daysInWindow,
    openTimecardCount: actuals.openTimecardCount,
    wageMissingCount: actuals.wageMissingCount,
    costComplete: actuals.costComplete,
    otApplied: false,
    lastSyncOkAt: actuals.lastSyncOkAt,
    ...(includeDollars ? { laborCost: actuals.laborCost } : {}),
  }
}

/// The All Locations summary card's block: one percentage for the whole estate,
/// plus the two counts that say how much of the estate it actually describes.
export type EstateLaborBlock = LaborBlock & {
  /// Stores that carry at least one timecard in the window, against the stores in
  /// scope. A company-wide labor % computed from three of nine stores is not a
  /// company-wide labor %, and this pair is what lets the card say so.
  storesReporting: number
  storesTotal: number
}

/// ESTATE ROLL-UP — SUM THE DOLLARS, THEN DIVIDE. Never the mean of the stores'
/// percentages: averaging ratios weights a $4k Tuesday the same as a $40k
/// Saturday and produces a number no store recognises. Same rule
/// src/lib/pacing.ts already states for goals ("summed per store — never
/// averaged").
///
/// THE ESTATE TARGET IS SALES-WEIGHTED for the identical reason. Stores may carry
/// different laborTargetPct values (LaborSettings has a per-store override row),
/// and the only comparator that stays like-for-like against a summed actual is
/// Σ(sales × target) / Σ sales — which is exactly "total budgeted labor dollars
/// over total sales". A plain mean of targets would judge the estate against a
/// budget no one holds.
export function aggregateLaborActuals(
  results: { laborCost: number; sales: number; result: LaborActualsResult }[],
  targets: number[]
): EstateLaborBlock {
  const totalCost = results.reduce((s, r) => s + r.laborCost, 0)
  const totalSales = results.reduce((s, r) => s + r.sales, 0)
  const weightedTarget =
    totalSales > 0
      ? results.reduce((s, r, i) => s + r.sales * (targets[i] ?? 0), 0) / totalSales
      : targets.length > 0
        ? targets.reduce((s, t) => s + t, 0) / targets.length
        : 0

  // WORST HEALTH WINS. One store that has never synced makes the company number
  // incomplete, and the badge must describe the weakest link rather than the
  // average of them — an "average freshness" would be a measurement of nothing.
  const order: Record<LaborHealth, number> = { never: 3, error: 2, stale: 1, fresh: 0 }
  const health = results.reduce<LaborHealth>(
    (worst, r) => (order[r.result.health] > order[worst] ? r.result.health : worst),
    "fresh"
  )

  const reporting = results.filter((r) => r.result.daysCovered > 0)
  const lastOk = results
    .map((r) => r.result.lastSyncOkAt)
    .filter((v): v is string => v !== null)
    .sort()

  return {
    laborPct: totalSales > 0 ? (totalCost / totalSales) * 100 : null,
    target: weightedTarget,
    health,
    // The widest coverage any store has, against the window — paired with
    // storesReporting below, which is what actually qualifies the estate figure.
    daysCovered: results.reduce((m, r) => Math.max(m, r.result.daysCovered), 0),
    daysInWindow: results[0]?.result.daysInWindow ?? 0,
    openTimecardCount: results.reduce((s, r) => s + r.result.openTimecardCount, 0),
    wageMissingCount: results.reduce((s, r) => s + r.result.wageMissingCount, 0),
    costComplete: results.every((r) => r.result.costComplete),
    otApplied: false,
    // The OLDEST good sync in the estate — the company number is only as current
    // as its stalest contributor.
    lastSyncOkAt: lastOk[0] ?? null,
    storesReporting: reporting.length,
    storesTotal: results.length,
  }
}

// ─── THE HONESTY LINES ────────────────────────────────────────────────────────

/// Every caveat the block carries, as sentences, in one place so the three cards
/// cannot drift into three different wordings of the same warning. Returned in
/// severity order; a card renders them as a footnote stack.
///
/// `tone` splits the wage gap (a WARNING — the cost is understated by an unknown
/// amount) from the rest (context). The warning tone reuses the affordance the
/// seam named: the "No store assigned" line on staff/[id].
export function laborFootnotes(block: LaborBlock, timeZone?: string): { text: string; tone: "warn" | "muted" }[] {
  const out: { text: string; tone: "warn" | "muted" }[] = []

  const estate = block as Partial<EstateLaborBlock>
  if (
    estate.storesTotal !== undefined &&
    estate.storesReporting !== undefined &&
    estate.storesReporting < estate.storesTotal
  ) {
    out.push({
      tone: "muted",
      text: `${estate.storesReporting} of ${estate.storesTotal} stores have synced labor — the company figure covers those stores only.`,
    })
  }

  if (!block.costComplete) {
    out.push({
      tone: "warn",
      text: `${block.wageMissingCount} timecard${block.wageMissingCount === 1 ? "" : "s"} ${
        block.wageMissingCount === 1 ? "has" : "have"
      } no wage in Square — labor cost is a floor, not a total.`,
    })
  }
  if (block.health === "never") {
    out.push({ tone: "muted", text: "Not synced yet — no timecards have been pulled for this store." })
  } else if (block.health === "error") {
    out.push({ tone: "warn", text: `Sync is failing. Last good sync ${syncStamp(block.lastSyncOkAt, timeZone)}.` })
  } else if (block.health === "stale") {
    out.push({ tone: "muted", text: `As of ${syncStamp(block.lastSyncOkAt, timeZone)} — not judged against budget until it refreshes.` })
  }
  if (block.daysCovered > 0 && block.daysCovered < block.daysInWindow) {
    out.push({
      tone: "muted",
      text: `${block.daysCovered} of ${block.daysInWindow} days synced — the percentage covers those days only.`,
    })
  }
  if (block.openTimecardCount > 0) {
    out.push({
      tone: "muted",
      text: `${block.openTimecardCount} on the clock — this number is still moving.`,
    })
  }
  // LAST, and unconditional whenever there is a number: straight time only. Kept
  // out of the conditional stack above because its absence would be the one that
  // makes an understated percentage look precise.
  if (block.laborPct !== null) {
    out.push({ tone: "muted", text: "*Straight time — overtime is not applied." })
  }
  return out
}

function syncStamp(iso: string | null, timeZone?: string): string {
  if (!iso) return "never"
  return new Date(iso).toLocaleString("en-US", {
    ...(timeZone ? { timeZone } : {}),
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}
