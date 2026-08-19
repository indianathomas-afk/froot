// AL-3 — ADVANCED LABOR PHASE 3. Design record: docs/ADVANCED_LABOR.md § Phase 3.
//
// THE SHARED WAGE AND TIP PAYLOAD, AND HOW IT IS WRITTEN DOWN. Pure — no prisma,
// no next, no clerk — so a CLIENT COMPONENT CAN IMPORT IT. That constraint is
// the whole reason this file is separate from the gate that decides who may see
// its contents, exactly as labor-judgment.ts is separate from labor-dashboard.ts:
// the All Locations table is a client component, and pulling the gate in with the
// formatter drags Clerk's server auth into the browser bundle. The build catches
// it, loudly, which is how this split came to be written down.
//
// THE GATE LIVES IN labor-dashboard.ts — canSeeWages / canSeeTips / loadTipBlocks.
// Nothing here decides access; everything here decides WORDING.
//
// WHY THE WORDING IS LOAD-BEARING AT ALL. Phase 3 is the first phase where names
// sit beside wages, and the three ways a pay figure can be absent — no Square
// link, no wage configured, no tip-eligible hours — are three different
// sentences. A single "$0.00" would say all three at once, and would say the one
// thing that is never true.

// ─── FORMATTING ───────────────────────────────────────────────────────────────

/// What a Square wage setting says a person is paid. RETURNED AS A SENTENCE,
/// never as a number a caller might format as $0.
///
/// NULL RENDERS AS "Not set in Square" (Gary's Q1 ruling, 2026-08-19) — the same
/// law AL-1 wrote into moneyToDollars and wageMissingCount: Square carries a rate
/// only where wage settings are configured, and a zero there would be the silent
/// zero seam (c) forbids. Measured 2026-08-19: 99 of 99 Keva members carry one,
/// so this branch is the exception — which is exactly why it must be a sentence
/// and not a fallback value nobody notices.
export function formatPay(pay: {
  payType: string | null
  hourlyRate: number | null
  annualRate: number | null
}): string {
  if (pay.payType === "SALARY" && pay.annualRate !== null) {
    return `${usdWhole(pay.annualRate)}/yr`
  }
  if (pay.hourlyRate !== null) return `${usd2(pay.hourlyRate)}/hr`
  // A SALARY assignment with no annual_rate, or an assignment Square returned
  // with neither figure. Both are "Square has not been told", not "$0".
  return "Not set in Square"
}

/// Average hourly tip payout. Null is an EM DASH, never $0.00 — the same
/// substitution formatLaborPct exists to make impossible for percentages.
export function formatTipsPerHour(value: number | null): string {
  return value === null ? "—" : `${usd2(value)}/hr`
}

const usd2 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 })

const usdWhole = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })


// ─── THE TIP PAYLOAD ──────────────────────────────────────────────────────────

/// What a dashboard carries for tips. Every field is MANAGE-only by
/// construction, because the whole object is absent for anyone else.
export type TipBlock = {
  /// Dollars per hour, or null — "—", never $0.00.
  avgHourlyTips: number | null
  tipsTotal: number
  /// The two halves, kept apart so the card can name them in its label and so
  /// the declared-cash total Gary asked for is readable off a live payload
  /// rather than off a database query.
  posTips: number
  declaredCashTips: number
  eligibleHours: number
  unknownEligibilityHours: number
  daysCovered: number
  daysInWindow: number
}

/// The footnote stack for a tips figure, in one place so the column header, the
/// tooltip and any later card cannot drift into three wordings of one caveat.
/// Mirrors laborFootnotes' shape and tone split.
export function tipFootnotes(block: TipBlock): { text: string; tone: "warn" | "muted" }[] {
  const out: { text: string; tone: "warn" | "muted" }[] = []
  if (block.avgHourlyTips === null) {
    out.push({ tone: "muted", text: "No tip-eligible hours in this range — not yet a rate." })
    return out
  }
  out.push({
    tone: "muted",
    text: `Square-recorded tips + declared cash: ${usd2(block.posTips)} recorded, ${usd2(block.declaredCashTips)} declared cash, over ${block.eligibleHours.toFixed(1)} tip-eligible hours.`,
  })
  if (block.declaredCashTips > 0) {
    // THE DOUBLE-COUNT, NAMED. A cash tip rung into the POS lands in
    // total_tip_money and can also be declared on a timecard. It cannot be
    // separated from the data Froot holds, so the card says so rather than
    // presenting a possibly-inflated rate as exact.
    out.push({
      tone: "warn",
      text: "A cash tip both rung into the POS and declared on a timecard is counted twice — this rate is an upper bound.",
    })
  }
  if (block.unknownEligibilityHours > 0) {
    out.push({
      tone: "muted",
      text: `${block.unknownEligibilityHours.toFixed(1)} of those hours have no tip-eligibility set in Square and are counted as eligible.`,
    })
  }
  if (block.daysCovered > 0 && block.daysCovered < block.daysInWindow) {
    out.push({
      tone: "muted",
      text: `${block.daysCovered} of ${block.daysInWindow} days synced — the rate covers those days only.`,
    })
  }
  return out
}
