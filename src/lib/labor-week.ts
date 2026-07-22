// Week-key helpers for the Labor model. SalesForecast.weekStart is a bare DATE
// keyed to the Monday of the week, so all math here is UTC (no timezone) — the
// Monday of a calendar week is the same whichever store reads it.

// Monday (yyyy-mm-dd) of the week containing the given yyyy-mm-dd. Weeks start
// Monday. Idempotent: mondayOfWeekStr of a Monday returns that Monday.
export function mondayOfWeekStr(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  const dow = d.getUTCDay() // 0 Sun .. 6 Sat
  const offset = dow === 0 ? -6 : 1 - dow
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

// Convenience: the Monday-key Date (UTC midnight) for a yyyy-mm-dd, ready for a
// Prisma `@db.Date` column.
export function mondayOfWeekDate(dateStr: string): Date {
  return new Date(`${mondayOfWeekStr(dateStr)}T00:00:00.000Z`)
}
