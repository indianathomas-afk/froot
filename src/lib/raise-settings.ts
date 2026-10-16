// MS-3a — the RAISE ELIGIBILITY SETTINGS: shape, defaults, bounds and the one
// validator. PURE, NO PRISMA IMPORT (the attendance-settings.ts pattern), so
// the client setup form on /staff/milestones and the write route share one rule
// and one set of sentences.

export type RaiseSettingsValues = {
  /// Ruling 5 — ADMIN toggle, raise eligibility only.
  raiseComplianceGate: boolean
  /// 0 switches the hours criterion off.
  raiseMinHoursPerWeek: number
  raiseConsecutiveWeeks: number
  /// 0 switches the on-time criterion off.
  raiseMinOnTimePct: number
  raiseCooldownDays: number
  requiredTrainingIds: string[]
  requiredDocumentIds: string[]
}

/// MUST EQUAL the @defaults on MilestoneSettings in prisma/schema.prisma —
/// scripts/verify-ms3.ts reads the schema and asserts it. Gary's F13 ruling
/// (2026-10-16): 20 hours/week, 3 consecutive weeks, 90% on-time, 90-day
/// cooldown; the gate on and nothing required.
export const DEFAULT_RAISE_SETTINGS: RaiseSettingsValues = {
  raiseComplianceGate: true,
  raiseMinHoursPerWeek: 20,
  raiseConsecutiveWeeks: 3,
  raiseMinOnTimePct: 90,
  raiseCooldownDays: 90,
  requiredTrainingIds: [],
  requiredDocumentIds: [],
}

/// Ruling 4: "30 / 60 / 90 / 180 / custom days".
export const COOLDOWN_CHOICES = [30, 60, 90, 180] as const

export const RAISE_BOUNDS = {
  hours: { min: 0, max: 60 },
  weeks: { min: 1, max: 26 },
  pct: { min: 0, max: 100 },
  cooldown: { min: 1, max: 730 },
  /// A required list longer than this is a mistake, not a policy.
  required: { max: 50 },
} as const

/// The one validator — the write route and the setup form's error text both
/// come from here. Returns the first problem in words, or null. Whether each id
/// names a live training or document in THIS org is the save's check, not this
/// one's (it needs the database).
export function raiseSettingsProblem(v: RaiseSettingsValues): string | null {
  const nums = [v.raiseMinHoursPerWeek, v.raiseConsecutiveWeeks, v.raiseMinOnTimePct, v.raiseCooldownDays]
  if (!nums.every((n) => Number.isInteger(n))) return "Every number must be a whole number."
  const { hours, weeks, pct, cooldown, required } = RAISE_BOUNDS
  if (v.raiseMinHoursPerWeek < hours.min || v.raiseMinHoursPerWeek > hours.max) {
    return `Hours per week must be between ${hours.min} and ${hours.max} (0 switches it off).`
  }
  if (v.raiseConsecutiveWeeks < weeks.min || v.raiseConsecutiveWeeks > weeks.max) {
    return `Consecutive weeks must be between ${weeks.min} and ${weeks.max}.`
  }
  if (v.raiseMinOnTimePct < pct.min || v.raiseMinOnTimePct > pct.max) {
    return `On-time must be between ${pct.min} and ${pct.max}% (0 switches it off).`
  }
  if (v.raiseCooldownDays < cooldown.min || v.raiseCooldownDays > cooldown.max) {
    return `Cooldown must be between ${cooldown.min} and ${cooldown.max} days.`
  }
  if (v.requiredTrainingIds.length > required.max || v.requiredDocumentIds.length > required.max) {
    return `Choose at most ${required.max} trainings and ${required.max} documents.`
  }
  if (new Set(v.requiredTrainingIds).size !== v.requiredTrainingIds.length || new Set(v.requiredDocumentIds).size !== v.requiredDocumentIds.length) {
    return "A training or document is listed twice."
  }
  return null
}

/// F14: true when nothing but the cooldown would be judged — the setup form
/// warns, and every eligible member would read green.
export function everyCriterionOff(v: RaiseSettingsValues): boolean {
  return (
    !v.raiseComplianceGate &&
    v.raiseMinHoursPerWeek === 0 &&
    v.raiseMinOnTimePct === 0 &&
    v.requiredTrainingIds.length === 0 &&
    v.requiredDocumentIds.length === 0
  )
}
