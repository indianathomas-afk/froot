/**
 * Store hours validation acceptance fixture — block the impossible, flag the
 * improbable, and NEVER normalise.
 *
 *   npx tsx scripts/verify-store-hours.ts
 *
 * PURE. No database, no network — the same shape as
 * verify-labor-position-hours.ts.
 *
 * WHAT THIS PROVES: the rule set, on hand-built weeks, including the two real
 * errors that motivated it (08:00-08:00 saved silently; a 01:00 Sunday open on
 * a campus store) and the one shape that must NOT be flagged (an overnight
 * close, which the dialog's own helper text promises is fine).
 * WHAT IT DOES NOT PROVE: anything about the estate's actual rows. That is the
 * read-only sweep, which runs against a named branch and is reported separately.
 */
import {
  validateStoreHours,
  type StoreHoursDay,
  type StoreHoursIssue,
} from "../src/lib/store-hours-validate"

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = Object.is(actual, expected)
  if (!ok) failures++
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`)
}

/// Issues rendered as a stable, sorted, comparable string. The REASON text is
/// deliberately not asserted — it is copy, it will be edited, and pinning it
/// here would make every wording change look like a regression.
function codes(issues: StoreHoursIssue[]): string {
  return (
    issues
      .map((i) => `${i.code}@${i.dayOfWeek}${i.field === "day" ? "" : `:${i.field}`}`)
      .sort()
      .join(",") || "(none)"
  )
}

function day(dayOfWeek: number, openingTime: string | null, closingTime: string | null, isClosed = false): StoreHoursDay {
  return { dayOfWeek, openingTime, closingTime, isClosed }
}

/// Days 1..6 all alike, for the W4 median cases.
function siblings(open: string, close: string, count: number): StoreHoursDay[] {
  return Array.from({ length: count }, (_, i) => day(i + 1, open, close))
}

// ── 1. BLOCKING — unambiguous, no legitimate case ────────────────────────────
console.log("1 · Blocking rules:")

// ERROR 1, BY NAME. Gary entered Mon-Fri as 08:00 to 08:00 on 2026-08-23 and
// the editor took it without a word. Zero-length or 24-hour; neither is a store.
const b1 = validateStoreHours([day(1, "08:00", "08:00")])
check("08:00-08:00 not closed -> BLOCKS (error 1)", codes(b1.blocking), "B1@1")
check("  ...and raises no warning on top of the block", codes(b1.warnings), "(none)")

const b2 = validateStoreHours([day(2, "08:00", null)])
check("open filled, close blank, not closed -> BLOCKS on the empty box", codes(b2.blocking), "B2@2:close")

const b2b = validateStoreHours([day(3, null, "17:00")])
check("close filled, open blank, not closed -> BLOCKS on the empty box", codes(b2b.blocking), "B2@3:open")

// ── 2. LEGAL SHAPES — these must stay silent ─────────────────────────────────
console.log("\n2 · Legal shapes that must NOT be flagged:")

const blank = validateStoreHours([day(3, null, null)])
check("both blank, not closed -> clean (undecided is legal)", codes(blank.blocking), "(none)")
check("  ...and no warning either", codes(blank.warnings), "(none)")

// A closed day KEEPS whatever times were typed — the route says so and unchecking
// the box has to give them back. So a closed day is not validated at all.
const closed = validateStoreHours([day(4, "08:00", "08:00", true)])
check("Closed day WITH times present -> no blocking", codes(closed.blocking), "(none)")
check("  ...and no warning, though 08:00-08:00 would block if open", codes(closed.warnings), "(none)")

// THE PROMISE THE HELPER TEXT MAKES: "A store that closes after midnight is fine
// — enter the real closing time (say 02:00) rather than 24:00." Blocking or even
// warning on close < open would break it. Asserted explicitly, both lists.
const overnight = validateStoreHours([day(5, "22:00", "02:00")])
check("22:00-02:00 overnight -> NOT blocking", codes(overnight.blocking), "(none)")
check("22:00-02:00 overnight -> NOT a warning either", codes(overnight.warnings), "(none)")

// ── 3. WARN AND ALLOW — improbable, but real stores are strange ──────────────
console.log("\n3 · Warnings, which must never block:")

// ERROR 2, BY NAME. The AM/PM slip on a campus store: Sunday at 01:00 against
// six siblings at 08:00. W3 fires on the hour itself, W4 on the shape.
const slip = validateStoreHours([day(0, "01:00", "16:00"), ...siblings("08:00", "16:00", 6)])
check("01:00 open + six siblings at 08:00 -> W3 and W4 both fire", codes(slip.warnings), "W3@0:open,W4@0:open")
check("  ...and the save still SUCCEEDS (nothing blocking)", codes(slip.blocking), "(none)")

// W4 is computed per FIELD, so a normal open with a divergent close flags the
// close alone. 10:00 is 2h off the 08:00 median (under the threshold); 16:00 is
// 4h off the 20:00 median (over it).
const closeOnly = validateStoreHours([day(0, "10:00", "16:00"), ...siblings("08:00", "20:00", 6)])
check("10:00-16:00 vs siblings 08:00-20:00 -> W4 on close, not open", codes(closeOnly.warnings), "W4@0:close")

// Below three siblings there is no shape to compare against, so W4 stays quiet.
// W3 still fires — it needs no siblings.
const thin = validateStoreHours([day(0, "01:00", "16:00"), ...siblings("08:00", "16:00", 2)])
check("fewer than 3 sibling days -> W4 does NOT fire", codes(thin.warnings), "W3@0:open")

// Rohan's Restaurant, Cafe De Keva Cart and Keva Kiosk are seasonal and
// legitimately odd. A short day is worth a flag and must never be a block.
const short = validateStoreHours([day(6, "11:00", "14:00")])
check("seasonal 11:00-14:00 -> W2 only", codes(short.warnings), "W2@6")
check("  ...and is ALLOWED", codes(short.blocking), "(none)")

const long = validateStoreHours([day(6, "05:00", "23:00")])
check("05:00-23:00 (18h) -> W1 only", codes(long.warnings), "W1@6")

// ── 4. NEVER NORMALISE — R7-C's shape ────────────────────────────────────────
console.log("\n4 · The validator reports; it never rewrites:")

// Inventing a value nobody typed is the failure mode this house has ruled
// against twice. The input object must come back untouched, AM/PM slip and all.
const input: StoreHoursDay[] = [day(0, "01:00", "16:00"), ...siblings("08:00", "16:00", 6)]
const snapshot = JSON.stringify(input)
validateStoreHours(input)
check("input is not mutated by validation", JSON.stringify(input), snapshot)

console.log(`\n${failures === 0 ? "✓ ALL PASS" : `✗ ${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
