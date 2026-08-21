import { z } from "zod"

// AL-3 / TIER-2 fix — THE WK HRS FIELD'S ONE SOURCE OF TRUTH.
//
// Both ends of the write parse the same way from here: the roster card's cell
// (a client component) and PATCH /api/square/labor/roster/[id] (a route). They
// used to disagree by construction — the cell's inline guard admitted any
// integer 1..168 while the route's zod admitted the same range separately, and
// nothing held them together. This module is small and DEPENDENCY-FREE ON
// PURPOSE: it is imported into a client bundle, so it may never reach for
// prisma, the Square client, or anything else server-only.
//
// IT IS NOT A CORE ENGINE AND NOTHING IN labor-budget.ts / labor-plan.ts /
// labor-coverage.ts / labor-daily.ts MAY IMPORT IT. Seam (b) still holds: the
// weekly budget is built from LaborPosition and gains no Square-sourced input
// here (labor-budget.ts:74-77).

/// Hours in a week. Square's own weekly_hours is bounded the same way.
export const MAX_WEEKLY_HOURS = 168
/// 1, not 0. A person who works no hours has NO override, not an override of
/// zero — clearing the field is how that is said, and `null` is what it stores.
/// The route has always rejected 0 (z.number().positive()); this constant is
/// that rule written once instead of twice.
export const MIN_WEEKLY_HOURS = 1

export type WeeklyHoursParse =
  | { ok: true; value: number | null }
  | { ok: false; reason: string }

/// The text in the box → what the PATCH body will carry.
///
/// AN EMPTY STRING IS A VALID PARSE, NOT A REJECTION, and that is the whole
/// point of this function. `{ ok: true, value: null }` is a real answer meaning
/// "clear the override"; the caller must send it rather than treating blank as
/// "nothing to do". Before this, blank was indistinguishable from unparseable
/// at the call site and the write was skipped.
export function parseWeeklyHoursDraft(raw: string): WeeklyHoursParse {
  const trimmed = raw.trim()
  if (trimmed === "") return { ok: true, value: null }
  // Digits only. `Number()` alone would accept "40.5", "-5", "4e1" and " 40 ",
  // and an <input type="number"> hands us the raw string on a locale that uses
  // a comma, so the shape is checked before the coercion rather than after.
  if (!/^\d+$/.test(trimmed)) return { ok: false, reason: "Whole hours only" }
  const value = Number(trimmed)
  if (value < MIN_WEEKLY_HOURS || value > MAX_WEEKLY_HOURS) {
    return { ok: false, reason: `${MIN_WEEKLY_HOURS}–${MAX_WEEKLY_HOURS}` }
  }
  return { ok: true, value }
}

/// The stored column → the text in the box. NULL IS AN EMPTY BOX, never a "0"
/// and never Square's number: an operator has to be able to see that the
/// override is unset, which is exactly what rendering Square's weekly_hours as
/// the input's placeholder made impossible.
export function formatWeeklyHoursDraft(value: number | null): string {
  return value === null ? "" : String(value)
}

/// The PATCH body for one roster row. LIVES HERE, NOT IN THE ROUTE, so a
/// fixture can assert that everything parseWeeklyHoursDraft is willing to emit
/// is something the route is willing to accept — the two used to be able to
/// drift apart silently, which is the failure this whole fix is about.
///
/// Still exactly two keys. Nothing Square owns is writable; see the route's
/// header for why that is a rule rather than an omission.
export const rosterRowPatchSchema = z
  .object({
    // Null clears the override and falls back to Square's own weekly_hours,
    // which is present for salaried members and absent for hourly ones.
    weeklyHoursOverride: z.number().int().min(MIN_WEEKLY_HOURS).max(MAX_WEEKLY_HOURS).nullable(),
    isSupervisory: z.boolean().nullable(),
  })
  .partial()

export type RosterRowPatch = z.infer<typeof rosterRowPatchSchema>
