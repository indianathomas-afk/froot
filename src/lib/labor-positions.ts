import { prisma } from "@/lib/prisma"

// The rate legend a new org starts with (Phase 0 · F5). These mirror the
// acceptance-case seed in the Labor brief so a fresh org is immediately usable
// and reproduces the documented $182 / 18.7% example once a forecast is set.
// Rates are DOLLARS (Decimal(10,2)); see LABOR.md for the money convention.
export const DEFAULT_LABOR_POSITIONS = [
  { name: "Store Manager", payType: "SALARIED", defaultHourlyRate: "20.00", impliedWeeklyHours: 40, isSupervisory: true, sortOrder: 0 },
  { name: "Assistant Store Manager", payType: "SALARIED", defaultHourlyRate: "18.00", impliedWeeklyHours: 40, isSupervisory: true, sortOrder: 1 },
  { name: "Lead Supervisor", payType: "HOURLY", defaultHourlyRate: "15.00", impliedWeeklyHours: null, isSupervisory: true, sortOrder: 2 },
  { name: "Supervisor", payType: "HOURLY", defaultHourlyRate: "13.00", impliedWeeklyHours: null, isSupervisory: true, sortOrder: 3 },
  { name: "Team Member", payType: "HOURLY", defaultHourlyRate: "12.00", impliedWeeklyHours: null, isSupervisory: false, sortOrder: 4 },
] as const

// Idempotent: seeds the default legend only when the org has no positions yet,
// so it's safe to call on every module-enable and from the backfill script
// without ever duplicating or clobbering an operator's edits.
export async function seedDefaultLaborPositions(organizationId: string): Promise<number> {
  const existing = await prisma.laborPosition.count({ where: { organizationId } })
  if (existing > 0) return 0
  const result = await prisma.laborPosition.createMany({
    data: DEFAULT_LABOR_POSITIONS.map((p) => ({ ...p, organizationId })),
  })
  return result.count
}
