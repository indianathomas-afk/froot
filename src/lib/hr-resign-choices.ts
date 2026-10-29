// DOC-7 ruling 1 (Gary, 2026-10-28): the only "re-sign every N months" an admin
// may choose. A pure module with no server imports, so the Edit dialog (a
// client component) and the PATCH route read the same list. The rule itself is
// in lib/hr-resign.ts.
export const RE_SIGN_CHOICES = [6, 12, 24] as const
export type ReSignChoice = (typeof RE_SIGN_CHOICES)[number]

/**
 * DOC-7 F6 (Gary, 2026-10-28) — the write for a PATCH, DOC-8 F5's rules:
 *   null → N   stamp now (the ruling 6 floor counts from here)
 *   N → M      keep the stamp
 *   N → null   clear both
 * `next === undefined` means the field was not in the request: write nothing.
 * Pure (the clock is passed in) so the fixture asserts what the route writes.
 */
export function reSignStampData(
  current: { reSignEveryMonths: number | null; reSignEveryMonthsSetAt: Date | null },
  next: number | null | undefined,
  now: Date
): { reSignEveryMonths?: number | null; reSignEveryMonthsSetAt?: Date | null } {
  if (next === undefined) return {}
  if (next === null) return { reSignEveryMonths: null, reSignEveryMonthsSetAt: null }
  return {
    reSignEveryMonths: next,
    reSignEveryMonthsSetAt:
      current.reSignEveryMonths !== null && current.reSignEveryMonthsSetAt ? current.reSignEveryMonthsSetAt : now,
  }
}
