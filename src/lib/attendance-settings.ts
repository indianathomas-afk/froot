// MS-2 — the On-Time SETTINGS: shape, defaults, bounds and the one validator.
// PURE, NO PRISMA IMPORT, so the client setup form (/staff/milestones) and the
// write route (via src/lib/attendance.ts, which re-exports this file) share one
// rule and one set of sentences.

export type MilestoneSettingsValues = {
  onTimeRedBelow: number
  onTimeGreenAtOrAbove: number
  onTimeLookbackDays: number
  onTimeMinShifts: number
  onTimeGraceMinutes: number
}

/// MUST EQUAL the @defaults on MilestoneSettings in prisma/schema.prisma —
/// scripts/verify-ms2.ts reads the schema and asserts it. An org with no row
/// reads exactly these.
export const DEFAULT_MILESTONE_SETTINGS: MilestoneSettingsValues = {
  onTimeRedBelow: 80,
  onTimeGreenAtOrAbove: 90,
  onTimeLookbackDays: 30,
  onTimeMinShifts: 5,
  onTimeGraceMinutes: 5,
}

/// F2 (Gary, 2026-10-16): "a choice of 5, 10 or 15 minutes, default 5".
export const GRACE_CHOICES = [5, 10, 15] as const

export const SETTINGS_BOUNDS = {
  pct: { min: 1, max: 100 },
  lookbackDays: { min: 7, max: 90 },
  minShifts: { min: 1, max: 50 },
} as const

/// The one validator — the write route and the setup form's error text both
/// come from here. Returns the first problem in words, or null.
export function settingsProblem(v: MilestoneSettingsValues): string | null {
  const ints = Object.values(v).every((n) => Number.isInteger(n))
  if (!ints) return "Every value must be a whole number."
  const { pct, lookbackDays, minShifts } = SETTINGS_BOUNDS
  if (v.onTimeRedBelow < pct.min || v.onTimeRedBelow > pct.max || v.onTimeGreenAtOrAbove < pct.min || v.onTimeGreenAtOrAbove > pct.max) {
    return `Percentages must be between ${pct.min} and ${pct.max}.`
  }
  // F8: red must sit strictly below green, or amber has no room and a single
  // number would be both colours.
  if (v.onTimeRedBelow >= v.onTimeGreenAtOrAbove) return "The red threshold must be below the green threshold."
  if (v.onTimeLookbackDays < lookbackDays.min || v.onTimeLookbackDays > lookbackDays.max) {
    return `Look-back must be between ${lookbackDays.min} and ${lookbackDays.max} days.`
  }
  if (v.onTimeMinShifts < minShifts.min || v.onTimeMinShifts > minShifts.max) {
    return `Minimum shifts must be between ${minShifts.min} and ${minShifts.max}.`
  }
  if (!(GRACE_CHOICES as readonly number[]).includes(v.onTimeGraceMinutes)) {
    return "Grace period must be 5, 10 or 15 minutes."
  }
  return null
}
