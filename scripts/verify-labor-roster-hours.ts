/**
 * WK HRS acceptance fixture — the "Team from Square" roster's one editable
 * Froot field, end to end minus the network.
 *
 *   npx tsx scripts/verify-labor-roster-hours.ts
 *
 * Pure functions, no DB. The three cases Gary named on 2026-08-21, when the
 * column looked inert in production, are cases 3, 4 and 5:
 *
 *   WRITING A VALUE      — a typed number reaches the column.
 *   CLEARING TO BLANK    — a blank box is a real write of NULL, not a no-op,
 *                          INCLUDING when the stored value is already null.
 *   RELOAD READS IT BACK — what the roster read returns after the write is
 *                          what was written, blank included.
 *
 * Case 2 is the one that made this file worth having: everything the input is
 * willing to emit must be something the route is willing to accept. The two
 * ends used to validate separately — an inline guard in the cell, a zod schema
 * declared inside the route file — with nothing able to import both and compare
 * them. `parseWeeklyHoursDraft` and `rosterRowPatchSchema` now live in one
 * module precisely so this assertion can exist.
 *
 * NOT ASSERTED, AND DELIBERATELY: that weeklyHoursOverride reaches the weekly
 * labor budget. It does not. budget.salariedHours sums LaborPosition rows
 * (src/lib/labor-budget.ts:74-77) and no core engine reads this column — seam
 * (b). A fixture claiming otherwise would be the first thing to mislead the
 * next reader.
 */
import {
  MAX_WEEKLY_HOURS,
  MIN_WEEKLY_HOURS,
  formatWeeklyHoursDraft,
  parseWeeklyHoursDraft,
  rosterRowPatchSchema,
} from "../src/lib/labor-roster-hours"

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = Object.is(actual, expected)
  if (!ok) failures++
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`)
}

/// The mirrored row, reduced to the two columns this fixture is about. Kelton
/// Thomas at Las Brisas as production held him on 2026-08-21: Square carries
/// weekly_hours 40, Froot's override has never been set.
type Row = { squareWeeklyHours: number | null; weeklyHoursOverride: number | null }

/// The route's write, minus auth and minus prisma: parse the body, apply only
/// the keys it carried. The `Object.keys(...).length === 0` refusal is the
/// route's, reproduced here because an empty patch is a 400 and must not read
/// as a successful clear.
function applyPatch(row: Row, body: unknown): { status: number; row: Row } {
  const parsed = rosterRowPatchSchema.safeParse(body)
  if (!parsed.success || Object.keys(parsed.data).length === 0) return { status: 400, row }
  const next = { ...row }
  if ("weeklyHoursOverride" in parsed.data) next.weeklyHoursOverride = parsed.data.weeklyHoursOverride ?? null
  return { status: 200, row: next }
}

/// One Save press: the text in the box → the PATCH body → the stored row. A
/// draft that does not parse never leaves the client, which is what the cell's
/// disabled Save button enforces.
function pressSave(row: Row, draft: string): { sent: boolean; status: number; row: Row } {
  const parsed = parseWeeklyHoursDraft(draft)
  if (!parsed.ok) return { sent: false, status: 0, row }
  const res = applyPatch(row, { weeklyHoursOverride: parsed.value })
  return { sent: true, status: res.status, row: res.row }
}

/// What the card renders after a reload — getStoreRoster hands back the stored
/// override, and the cell seeds its draft from it (src/lib/labor-roster.ts:369-370).
function reload(row: Row): string {
  return formatWeeklyHoursDraft(row.weeklyHoursOverride)
}

console.log("1 · parseWeeklyHoursDraft — what the box can say:")
check('"40" → 40', (parseWeeklyHoursDraft("40") as { value: number | null }).value, 40)
check('"" → null (blank is a VALUE, not a rejection)', (parseWeeklyHoursDraft("") as { value: number | null }).value, null)
check('"   " → null', (parseWeeklyHoursDraft("   ") as { value: number | null }).value, null)
check('" 40 " → 40', (parseWeeklyHoursDraft(" 40 ") as { value: number | null }).value, 40)
check(`"${MIN_WEEKLY_HOURS}" accepted`, parseWeeklyHoursDraft(String(MIN_WEEKLY_HOURS)).ok, true)
check(`"${MAX_WEEKLY_HOURS}" accepted`, parseWeeklyHoursDraft(String(MAX_WEEKLY_HOURS)).ok, true)
check('"0" rejected (no override, not an override of zero)', parseWeeklyHoursDraft("0").ok, false)
check('"169" rejected', parseWeeklyHoursDraft("169").ok, false)
check('"-5" rejected', parseWeeklyHoursDraft("-5").ok, false)
check('"40.5" rejected', parseWeeklyHoursDraft("40.5").ok, false)
check('"4e1" rejected (Number() would say 40)', parseWeeklyHoursDraft("4e1").ok, false)
check('"abc" rejected', parseWeeklyHoursDraft("abc").ok, false)

console.log("\n2 · The two ends agree — nothing the box emits is refused by the route:")
for (const draft of ["", "1", "40", "168", "  40  "]) {
  const parsed = parseWeeklyHoursDraft(draft)
  const accepted =
    parsed.ok && rosterRowPatchSchema.safeParse({ weeklyHoursOverride: parsed.value }).success
  check(`draft ${JSON.stringify(draft)} parses AND is accepted`, accepted, true)
}
check("route refuses 0 too", rosterRowPatchSchema.safeParse({ weeklyHoursOverride: 0 }).success, false)
check("route refuses 169 too", rosterRowPatchSchema.safeParse({ weeklyHoursOverride: 169 }).success, false)
check("route refuses 40.5 too", rosterRowPatchSchema.safeParse({ weeklyHoursOverride: 40.5 }).success, false)
check("an empty body is a 400, never a silent clear", applyPatch({ squareWeeklyHours: 40, weeklyHoursOverride: 40 }, {}).status, 400)

console.log("\n3 · WRITING A VALUE (Kelton: Square 40, no override → type 12, Save):")
const kelton: Row = { squareWeeklyHours: 40, weeklyHoursOverride: null }
check("the box starts EMPTY, not at Square's 40", reload(kelton), "")
const wrote = pressSave(kelton, "12")
check("the write was sent", wrote.sent, true)
check("200", wrote.status, 200)
check("stored override", wrote.row.weeklyHoursOverride, 12)
check("Square's own figure is untouched", wrote.row.squareWeeklyHours, 40)

console.log("\n4 · CLEARING TO BLANK (12 → empty, Save):")
const cleared = pressSave(wrote.row, "")
check("the write was sent — blank is not 'no change'", cleared.sent, true)
check("200", cleared.status, 200)
check("stored override is NULL", cleared.row.weeklyHoursOverride, null)
check("Square's 40 still sits behind it, unwritten", cleared.row.squareWeeklyHours, 40)

console.log("\n5 · RELOAD READS BACK WHAT WAS WRITTEN:")
check("after writing 12, the box reads 12", reload(wrote.row), "12")
check("after clearing, the box reads BLANK — not Square's 40", reload(cleared.row), "")
check("Square's figure is displayed beside the box, never inside it", formatWeeklyHoursDraft(null), "")

console.log("\n6 · The regression that made the column look inert:")
// The old cell returned before fetching whenever the parsed value equalled the
// stored one — so clearing a field that was ALREADY null did nothing at all,
// and Square's placeholder repainted 40 into the empty box. Both halves are
// asserted, because either alone still reads as "40 always comes back".
const alreadyBlank: Row = { squareWeeklyHours: 40, weeklyHoursOverride: null }
const reSaved = pressSave(alreadyBlank, "")
check("saving blank over an already-blank field STILL writes", reSaved.sent, true)
check("200", reSaved.status, 200)
check("and it is still blank afterwards", reload(reSaved.row), "")
// Same value re-saved: a deliberate Save is honoured, never swallowed.
const same = pressSave({ squareWeeklyHours: 40, weeklyHoursOverride: 30 }, "30")
check("re-saving an unchanged number still writes", same.sent, true)
check("30", same.row.weeklyHoursOverride, 30)
// An invalid draft never reaches the network — the Save button is disabled.
const bad = pressSave({ squareWeeklyHours: 40, weeklyHoursOverride: 30 }, "0")
check("an invalid draft is not sent", bad.sent, false)
check("and leaves the stored value alone", bad.row.weeklyHoursOverride, 30)

console.log("\n7 · A member Square carries no weekly_hours for (the hourly majority):")
const hourly: Row = { squareWeeklyHours: null, weeklyHoursOverride: null }
check("box is blank", reload(hourly), "")
const hourlySaved = pressSave(hourly, "24")
check("an override can still be set", hourlySaved.row.weeklyHoursOverride, 24)
check("clearing it returns to blank", reload(pressSave(hourlySaved.row, "").row), "")

console.log(`\n${failures === 0 ? "✅ All checks passed." : `❌ ${failures} check(s) failed.`}`)
process.exitCode = failures === 0 ? 0 : 1
