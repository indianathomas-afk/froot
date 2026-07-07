// ─── Vendor delivery-date defaults (Phase I-7) ────────────────────────────────
// A new/submitted PO's expectedAt defaults to the vendor's next configured
// delivery day; vendors without delivery days fall back to leadTimeDays, then
// to the next weekday. Days use JS getDay() numbering: 0 = Sunday … 6 = Saturday.

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/** Vendor.deliveryDays is Json? — normalize to a valid weekday-int array. */
export function parseDeliveryDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((d): d is number => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6)
}

export function defaultExpectedAt(
  vendor: { deliveryDays?: unknown; leadTimeDays: number | null },
  from: Date = new Date()
): Date {
  const days = parseDeliveryDays(vendor.deliveryDays)
  if (days.length > 0) {
    // Next configured delivery day strictly after `from` (order placed today
    // arrives on the next delivery run, not today).
    for (let offset = 1; offset <= 7; offset++) {
      const candidate = new Date(from.getTime() + offset * 86_400_000)
      if (days.includes(candidate.getDay())) return candidate
    }
  }
  if (vendor.leadTimeDays != null && vendor.leadTimeDays > 0) {
    return new Date(from.getTime() + vendor.leadTimeDays * 86_400_000)
  }
  // Next weekday.
  for (let offset = 1; offset <= 3; offset++) {
    const candidate = new Date(from.getTime() + offset * 86_400_000)
    const day = candidate.getDay()
    if (day !== 0 && day !== 6) return candidate
  }
  return new Date(from.getTime() + 86_400_000)
}
