// HR, Training & Compliance helpers. HR-1 ships read-only surfaces, so the
// compliance rollup below is a stub: pct stays null until real requirements
// exist, and the UI renders it as "—" (never 0%, which reads as failure).

export type StaffComplianceSummary = {
  requiredTotal: number
  completed: number
  pct: number | null
}

// HR-8: replace with batched query rolling up required-vs-completed across
// document acknowledgments, form submissions, and training assignments.
export function getStaffComplianceSummary(staffId: string): StaffComplianceSummary {
  void staffId
  return { requiredTotal: 0, completed: 0, pct: null }
}
