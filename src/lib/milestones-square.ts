// MS-1 (F6, Gary 2026-10-15) — StaffMember.startDate FROM SQUARE.
//
// "Fill start date from Square created_at only when it hasn't been
// hand-edited." Square has no hire date; created_at is when the Square PROFILE
// was made. It is the only date Square offers, and a hand edit
// (startDateManual) always wins.
//
// THE INSTANT BECOMES A DATE IN THE MEMBER'S STORE ZONE, never by slicing the
// UTC string: a profile created at 18:30 PDT is the next day in UTC.
// Server-only: localDateStr lives in a module that imports prisma.

import { localDateStr } from "@/lib/reports"
import { DEFAULT_TIME_ZONE } from "@/lib/hr"

/** Square created_at → @db.Date value, or null when absent or unparseable. */
export function startDateFromSquare(createdAt: string | null | undefined, timeZone: string): Date | null {
  if (!createdAt) return null
  const t = Date.parse(createdAt)
  if (Number.isNaN(t)) return null
  return new Date(`${localDateStr(new Date(t), timeZone)}T00:00:00.000Z`)
}

/** The zone a member's Square start date is read in: their primary store's,
 *  else the org's — displayTimeZone()'s chain, for the moment of a sync when
 *  the assignment rows are being rebuilt and cannot be read back. */
export function squareStartZone(
  primaryStoreId: string | null,
  stores: { id: string; timezone: string }[],
  orgTimeZone: string | null | undefined
): string {
  const store = primaryStoreId ? stores.find((s) => s.id === primaryStoreId) : undefined
  return store?.timezone ?? orgTimeZone ?? DEFAULT_TIME_ZONE
}

/** THE ONE RULE both Square resync routes apply (F6, plus Gary 2026-10-15):
 *  Square's date is ALWAYS recorded in squareStartDate, so a later Square
 *  correction is visible beside a hand-set date; it becomes the working
 *  startDate only when that has not been hand-edited. Returns the Prisma `data`
 *  fragment — {} when Square gave no usable created_at. */
export function squareStartDateData(
  startDateManual: boolean,
  createdAt: string | null | undefined,
  timeZone: string
): { squareStartDate: Date; startDate?: Date } | Record<string, never> {
  const squareStartDate = startDateFromSquare(createdAt, timeZone)
  if (!squareStartDate) return {}
  return startDateManual ? { squareStartDate } : { squareStartDate, startDate: squareStartDate }
}
