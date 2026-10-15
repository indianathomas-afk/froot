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

/** THE ONE RULE both Square resync routes apply (F6): a hand-edited start date
 *  is never touched; otherwise Square's created_at fills it when Square has
 *  one. Returns the Prisma `data` fragment — {} means "write nothing". */
export function squareStartDateData(
  startDateManual: boolean,
  createdAt: string | null | undefined,
  timeZone: string
): { startDate: Date } | Record<string, never> {
  if (startDateManual) return {}
  const startDate = startDateFromSquare(createdAt, timeZone)
  return startDate ? { startDate } : {}
}
