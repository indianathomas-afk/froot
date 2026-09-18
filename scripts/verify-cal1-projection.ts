/**
 * CAL-1 — the recurrence projection, pinned.
 *
 *   npx tsx scripts/verify-cal1-projection.ts
 *
 * PURE, AND DELIBERATELY SO — the same shape as verify-perm8-grants.ts and for
 * the same reason. What this checks is not a query: it is calendar arithmetic.
 * A database-backed fixture would be green on an empty CalendarEvent table and
 * would prove nothing at all.
 *
 * WHAT THIS CAN DETECT, stated so a green run means something:
 *   - THE MONTHLY CLAMP CARRYING FORWARD. If the 31st is clamped to 28 in
 *     February and then walks from 28 rather than from the original day, every
 *     later month is wrong by three days and nothing errors. Cases 1-4.
 *   - BIWEEKLY PHASE DERIVED FROM THE WINDOW. If the step is counted from
 *     `fromDate` instead of `startDate`, the same event lands on different
 *     dates depending on which month you scrolled to. Cases 6-7 are the same
 *     event queried from two windows and must agree.
 *   - nextDueDate() LOSING "STRICTLY AFTER". If it returns the date it was
 *     handed, the cron re-materialises a just-completed occurrence every hour
 *     forever. Cases 13-15.
 *   - THE BOUNDS LEAKING. startDate and endDate are applied outside the rules;
 *     if a rule ever applies them itself and disagrees, cases 8-11 fail.
 *   - normalizeCategory() ACCEPTING AN UNKNOWN VALUE. A category that falls
 *     through to "other" renders in the wrong colour forever. Cases 16-19.
 *
 * WHAT IT CANNOT DETECT, equally important: it does not prove the cron writes
 * the right rows, that dueAt is frozen correctly against real store hours, or
 * that any route enforces a capability. Those are the staging protocol's.
 * dueAtFor() is exercised here only for the two branches that need no store
 * hours; the hours-driven branch is dayCloseInstant()'s and is pinned by
 * scripts/verify-store-hours-engine.ts.
 */
import {
  CALENDAR_CATEGORIES,
  daysOverdue,
  dueAtFor,
  nextDueDate,
  normalizeCategory,
  normalizePriority,
  normalizeRecurrence,
  projectDueDates,
  type ProjectableEvent,
} from "../src/lib/calendar"

let failures = 0

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failures++
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`)
  if (!ok) console.log(`      expected ${e}\n      actual   ${a}`)
}

function ev(recurrence: string, startDate: string, endDate: string | null = null): ProjectableEvent {
  return { recurrence, startDate, endDate }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n1 · Monthly — the clamp, which is the rule most likely to rot")

// THE HEADLINE CASE. Jan 31 must reach Feb 28, and then RETURN to the 31st.
check(
  "1. start 2026-01-31, six months — clamps and returns to 31",
  projectDueDates(ev("Monthly", "2026-01-31"), "2026-01-01", "2026-06-30"),
  ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30"]
)
check(
  "2. leap year — 2028-01-31 clamps to Feb 29",
  projectDueDates(ev("Monthly", "2028-01-31"), "2028-02-01", "2028-02-29"),
  ["2028-02-29"]
)
check(
  "3. day 15 never clamps and never shifts",
  projectDueDates(ev("Monthly", "2026-01-15"), "2026-01-01", "2026-04-30"),
  ["2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15"]
)
// The clamp must be computed per month from the ORIGINAL day. If it carried
// forward, this window (which starts AFTER February) would return the 28th.
check(
  "4. clamp does not carry forward — window opens in March",
  projectDueDates(ev("Monthly", "2026-01-31"), "2026-03-01", "2026-05-31"),
  ["2026-03-31", "2026-04-30", "2026-05-31"]
)

console.log("\n2 · Weekly and Biweekly — phase belongs to the event")

// 2026-09-17 is a Thursday.
check(
  "5. Weekly — four consecutive Thursdays",
  projectDueDates(ev("Weekly", "2026-09-17"), "2026-09-17", "2026-10-08"),
  ["2026-09-17", "2026-09-24", "2026-10-01", "2026-10-08"]
)
check(
  "6. Biweekly from the start date",
  projectDueDates(ev("Biweekly", "2026-09-17"), "2026-09-17", "2026-10-29"),
  ["2026-09-17", "2026-10-01", "2026-10-15", "2026-10-29"]
)
// THE SAME EVENT, A LATER WINDOW. Must agree with case 6 on the dates they
// share — this is the check that fails if the phase is taken from `fromDate`.
check(
  "7. ...same event, window opens mid-cycle — phase unchanged",
  projectDueDates(ev("Biweekly", "2026-09-17"), "2026-10-05", "2026-10-29"),
  ["2026-10-15", "2026-10-29"]
)

console.log("\n3 · Bounds — applied outside the rules, never inside them")

check(
  "8. endDate is INCLUSIVE",
  projectDueDates(ev("Weekly", "2026-09-17", "2026-10-01"), "2026-09-17", "2026-12-31"),
  ["2026-09-17", "2026-09-24", "2026-10-01"]
)
check(
  "9. nothing before startDate, for any recurrence",
  projectDueDates(ev("Daily", "2026-09-17"), "2026-09-10", "2026-09-19"),
  ["2026-09-17", "2026-09-18", "2026-09-19"]
)
check(
  "10. a window entirely before startDate is empty",
  projectDueDates(ev("Monthly", "2026-09-17"), "2026-01-01", "2026-08-31"),
  []
)
check(
  "11. a window entirely after endDate is empty",
  projectDueDates(ev("Weekly", "2026-09-17", "2026-10-01"), "2026-11-01", "2026-11-30"),
  []
)

console.log("\n4 · None, and the deny-by-default case")

check("12a. None in range → exactly one date", projectDueDates(ev("None", "2026-09-17"), "2026-09-01", "2026-09-30"), ["2026-09-17"])
check("12b. None out of range → empty", projectDueDates(ev("None", "2026-09-17"), "2026-10-01", "2026-10-31"), [])
// An unregistered recurrence must project NOTHING rather than guessing Daily.
check("12c. unregistered recurrence projects nothing", projectDueDates(ev("Fortnightly", "2026-09-17"), "2026-09-01", "2026-12-31"), [])
check("12d. a malformed date projects nothing", projectDueDates(ev("Weekly", "2026-02-30"), "2026-01-01", "2026-12-31"), [])

console.log("\n5 · nextDueDate — STRICTLY after, which is what stops the cron looping")

check("13. null afterDate → startDate (nothing completed yet)", nextDueDate(ev("Weekly", "2026-09-17"), null), "2026-09-17")
// THE CRON'S CASE. Handed the date it just completed, it must return the NEXT
// one. Returning the same date re-materialises it every hour, forever.
check("14. afterDate ON a projected date → the next one", nextDueDate(ev("Weekly", "2026-09-17"), "2026-09-17"), "2026-09-24")
check("15a. afterDate between dates → the next one", nextDueDate(ev("Weekly", "2026-09-17"), "2026-09-20"), "2026-09-24")
check("15b. past endDate → null", nextDueDate(ev("Weekly", "2026-09-17", "2026-10-01"), "2026-10-01"), null)
check("15c. Monthly across a year boundary", nextDueDate(ev("Monthly", "2026-12-31"), "2026-12-31"), "2027-01-31")
// A one-off that has already happened has no next date.
check("15d. None, already past → null", nextDueDate(ev("None", "2026-09-17"), "2026-09-17"), null)

console.log("\n6 · normalizeCategory — rejects by name (the phases.ts pattern)")

for (const c of CALENDAR_CATEGORIES) {
  check(`16. "${c.id}" round-trips`, normalizeCategory(c.id), c.id)
}
check("17. the LABEL resolves to the id", normalizeCategory("Cleaning & Maintenance"), "cleaning")
check("18. whitespace is trimmed", normalizeCategory("  Ordering  "), "ordering")
// THE ONE THAT MATTERS: an unknown value must be REFUSED, not folded to "other".
check("19a. unknown category → null", normalizeCategory("marketing"), null)
check("19b. empty → null", normalizeCategory("   "), null)
check("19c. null → null", normalizeCategory(null), null)
check("19d. priority rejects unknown", normalizePriority("Urgent"), null)
check("19e. recurrence rejects unknown", normalizeRecurrence("Yearly"), null)

console.log("\n7 · dueAtFor — ruling 8's two hours-free branches")

const store = { timezone: "America/Los_Angeles" }
// An explicit time wins outright.
check(
  "20. dueTime set → that instant, store-local",
  dueAtFor(store, null, "2026-09-17", "14:30").toISOString(),
  "2026-09-17T21:30:00.000Z" // 14:30 PDT = 21:30 UTC
)
// NO HOURS → the END of the store's local day: midnight on D+1, and NOT the
// 03:00 that day close would give. This is R3's whole reason for existing.
check(
  "21. no hours → END of the store's local day (midnight, no 3h grace)",
  dueAtFor(store, null, "2026-09-17", null).toISOString(),
  "2026-09-18T07:00:00.000Z" // 00:00 PDT on the 18th = 07:00 UTC
)

console.log("\n8 · daysOverdue — one definition, so the banner cannot round its own way")

const due = new Date("2026-09-17T07:00:00.000Z")
check("22a. before dueAt → 0", daysOverdue(due, new Date("2026-09-17T06:00:00.000Z")), 0)
check("22b. two hours past → still 0 (reads as 'due', not '0 days overdue')", daysOverdue(due, new Date("2026-09-17T09:00:00.000Z")), 0)
check("22c. one full day → 1", daysOverdue(due, new Date("2026-09-18T08:00:00.000Z")), 1)
check("22d. three full days → 3", daysOverdue(due, new Date("2026-09-20T08:00:00.000Z")), 3)

console.log(failures === 0 ? "\n✓ ALL PASS\n" : `\n✗ ${failures} CHECK(S) FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
