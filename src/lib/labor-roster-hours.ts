import { z } from "zod"

// BUG-11 / BUG-12 — THE WK HRS FIELD'S ONE SOURCE OF TRUTH.
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

/// ZERO IS A VALUE, NOT AN ABSENCE — Gary's ruling, 2026-08-21. This constant
/// was 1 and the change from 1 to 0 is the whole of BUG-12's third finding.
///
/// THE TWO STATES ARE DISTINCT AND MUST STAY DISTINCT:
///   null → NO OVERRIDE. Froot has no opinion; Square's own weekly_hours is
///          what this person's week is, and the card shows it beside the box.
///   0    → EXPLICITLY ZERO HOURS. A human has said this person contributes no
///          weekly hours, which is NOT the same as never having been asked.
///
/// Nothing may collapse them. `Int?` stores both without a schema change (0 is
/// a perfectly good Int), and every consumer of weeklyHoursOverride was audited
/// on 2026-08-21 for falsy handling — `||`, `!x`, a truthy ternary — and there
/// is none: every one is a passthrough or an explicit `!= null`. IF YOU ADD A
/// CONSUMER, `if (row.weeklyHoursOverride)` IS THE BUG. Write `!= null`.
export const MIN_WEEKLY_HOURS = 0

export type WeeklyHoursParse =
  | { ok: true; value: number | null }
  | { ok: false; reason: string }

/// The text in the box → what the PATCH body will carry.
///
/// AN EMPTY STRING IS A VALID PARSE, NOT A REJECTION, and that is the whole
/// point of this function. `{ ok: true, value: null }` is a real answer meaning
/// "clear the override"; the caller must send it rather than treating blank as
/// "nothing to do". Blank and "0" are DIFFERENT ANSWERS — null and 0 — and this
/// is the function where that distinction is made.
export function parseWeeklyHoursDraft(raw: string): WeeklyHoursParse {
  const trimmed = raw.trim()
  if (trimmed === "") return { ok: true, value: null }
  // Digits only. `Number()` alone would accept "40.5", "-5", "4e1" and " 40 ",
  // and the box is a text input (see the cell for why it is not type="number"),
  // so the shape is checked before the coercion rather than after.
  if (!/^\d+$/.test(trimmed)) return { ok: false, reason: "Whole hours only" }
  const value = Number(trimmed)
  if (value < MIN_WEEKLY_HOURS || value > MAX_WEEKLY_HOURS) {
    return { ok: false, reason: `${MIN_WEEKLY_HOURS}–${MAX_WEEKLY_HOURS}` }
  }
  return { ok: true, value }
}

/// The stored column → the text in the box. NULL IS AN EMPTY BOX; ZERO IS THE
/// STRING "0". The `value === null` test is deliberate and must never become a
/// falsy one, or an explicit zero renders as "no override" and the distinction
/// this module exists to keep is gone from the screen.
export function formatWeeklyHoursDraft(value: number | null): string {
  return value === null ? "" : String(value)
}

/// Is this row an uncommitted edit? THE CARD'S SAVE BAR IS DRIVEN BY THIS, and
/// so is the fixture — the point of exporting it is that the button's arithmetic
/// and the assertions about it are the same code.
///
/// AN INVALID DRAFT COUNTS AS PENDING. It is an edit the operator has made and
/// not committed; calling it "nothing to save" would let the bar read "all
/// changes saved" while a box sits there in red.
export function isPendingChange(draft: string, persisted: number | null): boolean {
  const parsed = parseWeeklyHoursDraft(draft)
  if (!parsed.ok) return true
  return parsed.value !== persisted
}

export type RosterEditSummary = {
  /// Touched rows that differ from what is stored, invalid ones included.
  pending: number
  /// Touched rows whose text cannot be parsed. These block the card-level save.
  invalid: number
  /// Pending AND parseable — what "Save all" would actually write.
  committable: number
}

/// The card-level save bar's whole arithmetic, in one pure function.
export function summarizeRosterEdits<T extends { draft: string; persisted: number | null }>(
  entries: T[]
): RosterEditSummary {
  let pending = 0
  let invalid = 0
  let committable = 0
  for (const e of entries) {
    if (!isPendingChange(e.draft, e.persisted)) continue
    pending++
    if (parseWeeklyHoursDraft(e.draft).ok) committable++
    else invalid++
  }
  return { pending, invalid, committable }
}

/// WHICH ROWS "Save changes" COMMITS, and in what order. Exported so the button
/// and the fixture run the SAME selection rather than two descriptions of it —
/// the A13 lesson: a fixture that re-implements the decision it is checking
/// proves only that the fixture agrees with itself.
///
/// Invalid rows are SKIPPED, not fatal. One unparseable box among fifteen must
/// not strand the fourteen good ones; the save bar names the count that still
/// needs fixing, and those rows stay pending afterwards, which is visible.
export function pendingCommitIds<T extends { id: string; draft: string; persisted: number | null }>(
  entries: T[]
): string[] {
  return entries
    .filter((e) => isPendingChange(e.draft, e.persisted) && parseWeeklyHoursDraft(e.draft).ok)
    .map((e) => e.id)
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
    // Null clears the override and falls back to Square's own weekly_hours.
    // ZERO IS ADMITTED — `.min(0)`, not `.positive()` — because zero hours is a
    // statement, not an absence. See MIN_WEEKLY_HOURS.
    weeklyHoursOverride: z.number().int().min(MIN_WEEKLY_HOURS).max(MAX_WEEKLY_HOURS).nullable(),
    isSupervisory: z.boolean().nullable(),
  })
  .partial()

export type RosterRowPatch = z.infer<typeof rosterRowPatchSchema>
