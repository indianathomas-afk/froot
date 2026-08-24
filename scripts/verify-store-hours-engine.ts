/**
 * BUG-14 — THE ENGINE'S ADMISSION RULE, AND THE SURFACING THAT DEPENDS ON IT.
 *
 *   npx tsx scripts/verify-store-hours-engine.ts
 *
 * PURE. No database, no network — the sibling of verify-store-hours.ts, which
 * covers the EDITOR's rules. This one covers the OTHER predicate.
 *
 * WHY BOTH FILES EXIST. verify-store-hours.ts proves what the dialog will
 * accept. It cannot prove what the labor model will READ, and those are not the
 * same question: an overnight window is clean by the validator and discarded by
 * the engine, and that gap is the whole of BUG-14. A row the engine discards is
 * displayed on the store card exactly like one it uses, and the store quietly
 * runs on sales inference instead.
 *
 * IT IMPORTS THE PARSERS FROM `labor-plan` ON PURPOSE, NOT FROM THE MODULE.
 * labor-plan.ts re-exports them from store-hours-window.ts, so reaching through
 * it is what makes this fixture a DRIFT GUARD: if anyone ever gives the engine
 * its own private parser again, or edits the ones it re-exports, these
 * assertions move with it and the surfacing's promise is re-checked for free.
 * The whole point of BUG-11/BUG-12 is that a rule spelled twice drifts.
 */
import { parseHourStart, parseHourEnd } from "../src/lib/labor-plan"
import * as hoursWindow from "../src/lib/store-hours-window"
import {
  engineOpenWindow,
  engineHoursUse,
  discardedByEngine,
  type StoreHoursWindowDay,
} from "../src/lib/store-hours-window"

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = Object.is(actual, expected)
  if (!ok) failures++
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`)
}

function day(openingTime: string | null, closingTime: string | null, isClosed = false): StoreHoursWindowDay {
  return { openingTime, closingTime, isClosed }
}

/// The window rendered as a comparable string, so a wrong window fails loudly
/// rather than passing a truthiness test.
function win(d: StoreHoursWindowDay): string {
  const w = engineOpenWindow(d)
  return w ? `${w.startHour}-${w.endHour}` : "DISCARDED"
}

// ── 1. THE DRIFT GUARD ───────────────────────────────────────────────────────
// If these two stop being the same function, the store card is answering a
// different question from the one the engine asks, and the surfacing is a lie.
console.log("1 · labor-plan re-exports the module's parsers, not copies of them:")

check("labor-plan's parseHourStart IS store-hours-window's", parseHourStart, hoursWindow.parseHourStart)
check("labor-plan's parseHourEnd IS store-hours-window's", parseHourEnd, hoursWindow.parseHourEnd)

// The predicate stated in terms of the parsers themselves — this is the literal
// `s != null && e != null && e > s` that stood inline at labor-plan.ts:286.
function predicateByHand(o: string | null, c: string | null): boolean {
  const s = parseHourStart(o)
  const e = parseHourEnd(c)
  return s != null && e != null && e > s
}
for (const [o, c] of [["08:00", "20:00"], ["22:00", "02:00"], ["08:00", "08:00"], ["18:00", "00:00"], ["07:00", "00:30"]] as const) {
  check(
    `engineOpenWindow agrees with the parsers' own e > s for ${o}-${c}`,
    engineOpenWindow(day(o, c)) != null,
    predicateByHand(o, c)
  )
}

// ── 2. ADMITTED — the model plans on exactly these hours ─────────────────────
console.log("\n2 · Rows the engine READS:")

check("08:00-20:00 -> window 8-20", win(day("08:00", "20:00")), "8-20")

// SHIPPED IN 817b3ef AND ASSERTED HERE FROM THE OTHER SIDE. A midnight close
// was discarded until R7-E; verify-labor-coverage.ts pins parseHourEnd("00:00")
// at 24, and this pins the consequence — the row is now ADMITTED. A store whose
// hours looked ignored last week is live now, which is why the sweep is re-run.
check("18:00-00:00 midnight close -> ADMITTED at 18-24 (817b3ef)", win(day("18:00", "00:00")), "18-24")

// Fractional times round outward: open floors, close ceils, so the window never
// narrows the day. 08:30-19:30 is planned as 8-20.
check("08:30-19:30 -> widened to 8-20, never narrowed", win(day("08:30", "19:30")), "8-20")

// ── 3. DISCARDED — the shapes BUG-14 exists for ──────────────────────────────
console.log("\n3 · Rows the engine SILENTLY DISCARDS (sales inference instead):")

// THE OVERNIGHT CASE. The dialog's helper text promises this is fine, the
// validator raises nothing, and the engine drops it. That contradiction is the
// defect; it is NOT fixed by making the validator warn (ruled 2026-08-23).
check("22:00-02:00 overnight -> DISCARDED", win(day("22:00", "02:00")), "DISCARDED")

// A 00:30 close is overnight, not midnight, and stays discarded — the 817b3ef
// fix was deliberately exactly "00:00" and widening it would build CUTOFF-1 by
// accident. Pinned so the narrowness is a decision, not a coincidence.
check("07:00-00:30 -> STILL DISCARDED (CUTOFF-1, not the midnight fix)", win(day("07:00", "00:30")), "DISCARDED")

// ZERO-LENGTH. B1 blocks this in the editor now, but rows saved before the
// validator shipped are still in the table and still discarded.
check("08:00-08:00 zero-length -> DISCARDED", win(day("08:00", "08:00")), "DISCARDED")

// ONE-SIDED. B2 blocks it now; legacy rows exist and the card renders them as
// "Opens 07:00", which reads like the engine is using an opening time it isn't.
check("07:00 with no close -> DISCARDED", win(day("07:00", null)), "DISCARDED")
check("no open with a 20:00 close -> DISCARDED", win(day(null, "20:00")), "DISCARDED")

// ── 4. THE CLASSIFIER THE SURFACING KEYS ON ──────────────────────────────────
console.log("\n4 · What the store card is allowed to say:")

// A CLOSED DAY IS NOT A DISAGREEMENT. The operator said the store is shut, the
// engine gives it no window and no inference, and the card must stay silent —
// warning here would tell someone to fix what they already did (CHK-4's rule).
check("Closed day -> 'closed', never flagged", engineHoursUse(day("08:00", "08:00", true)), "closed")

// NOR IS AN EMPTY DAY. Inference runs, but nothing on screen claims otherwise,
// so there is no gap between what is shown and what is used.
check("both times blank -> 'undecided', never flagged", engineHoursUse(day(null, null)), "undecided")

check("08:00-20:00 -> 'used'", engineHoursUse(day("08:00", "20:00")), "used")
check("22:00-02:00 -> 'discarded' — THIS is what must be visible", engineHoursUse(day("22:00", "02:00")), "discarded")
check("07:00 with no close -> 'discarded'", engineHoursUse(day("07:00", null)), "discarded")

// ── 5. THE STORE-LEVEL QUESTION ──────────────────────────────────────────────
console.log("\n5 · Per-store roll-up, which is what the card renders:")

const mixed = [
  { dayOfWeek: 1, ...day("08:00", "20:00") },
  { dayOfWeek: 2, ...day("08:00", "20:00") },
  { dayOfWeek: 3, ...day("22:00", "02:00") },
  { dayOfWeek: 4, ...day(null, null) },
  { dayOfWeek: 5, ...day("08:00", "08:00") },
  { dayOfWeek: 6, ...day("10:00", "16:00", true) },
]
check("a mixed week names only the discarded days", discardedByEngine(mixed).join(","), "3,5")

const allGood = [
  { dayOfWeek: 1, ...day("08:00", "20:00") },
  { dayOfWeek: 0, ...day("18:00", "00:00") },
]
check("an all-admitted week names none", discardedByEngine(allGood).join(",") || "(none)", "(none)")

// A store with no rows at all is not "discarded" — it is CHK-4's existing
// "Hours: not set" note, and the two signals must not both fire on it.
check("no rows at all -> nothing to flag", discardedByEngine([]).join(",") || "(none)", "(none)")

// ── 6. NEVER REWRITE ─────────────────────────────────────────────────────────
console.log("\n6 · The module reports; it never rewrites:")

const input = [{ dayOfWeek: 3, ...day("22:00", "02:00") }]
const snapshot = JSON.stringify(input)
discardedByEngine(input)
engineOpenWindow(input[0])
engineHoursUse(input[0])
check("input is not mutated", JSON.stringify(input), snapshot)

console.log(`\n${failures === 0 ? "✓ ALL PASS" : `✗ ${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
