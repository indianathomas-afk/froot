// HR, Training & Compliance helpers. HR-1 ships read-only surfaces, so the
// compliance rollup below is a stub: pct stays null until real requirements
// exist, and the UI renders it as "—" (never 0%, which reads as failure).

import { prisma } from "@/lib/prisma"

// Clerk identities (User) and StaffMember rows are separate populations —
// most staff never get a login, and StaffMember deliberately has no userId
// FK. The self-serve signing flow (HR-4) maps the session to a staff profile
// by org-scoped, case-insensitive email match; a manager fixes a miss by
// setting the staff member's email in the directory.
export async function findStaffMemberForEmail(organizationId: string, email: string | null | undefined) {
  if (!email) return null
  return prisma.staffMember.findFirst({
    where: { organizationId, email: { equals: email, mode: "insensitive" } },
    include: staffSelfInclude,
  })
}

const staffSelfInclude = {
  storeAssignments: {
    include: { store: true },
    orderBy: [{ isPrimary: "desc" as const }, { store: { name: "asc" as const } }],
  },
}

// HR-7: the invite webhook links User ⇄ StaffMember explicitly, so self
// resolution prefers that link and falls back to the HR-4 email match for
// staff who never got a login-linked profile.
export async function findStaffMemberForUser(
  organizationId: string,
  user: { id: string; email: string }
) {
  const linked = await prisma.staffMember.findFirst({
    where: { organizationId, userId: user.id },
    include: staffSelfInclude,
  })
  if (linked) return linked
  return findStaffMemberForEmail(organizationId, user.email)
}

// The store recorded on signing-time snapshots: the staff member's primary
// store, falling back to their first assignment.
export function primaryStoreName(
  staff: { storeAssignments: { isPrimary: boolean; store: { name: string } }[] }
): string | null {
  const primary = staff.storeAssignments.find((a) => a.isPrimary) ?? staff.storeAssignments[0]
  return primary?.store.name ?? null
}

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
