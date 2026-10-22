import { prisma } from "@/lib/prisma"
import { writeAuditLog } from "@/lib/audit"

// ─────────────────────────────────────────────────────────────────────────────
// MS-6 — THE ONE WRITE OF StaffMember.milestoneEligible (Gary, 2026-10-21).
//
// R1: one flag per PERSON, so a person on several store rosters shows the same
// value on each and flipping it on one store's roster changes it everywhere
// (R6) — there is nothing per-store to keep in step. R3: HIDE, NOT DELETE —
// this touches the one column and nothing else; wage, raise, schedule and
// attendance rows keep being written exactly as before.
//
// The route (PUT /api/staff/[id]/milestone-eligibility) owns the gates; this
// function owns the org-scoped lookup, the write and the AuditLog row, so the
// fixture can drive the write without a session.
// ─────────────────────────────────────────────────────────────────────────────

export const MILESTONE_ELIGIBILITY_AUDIT_ACTION = "staff.milestone_eligibility.update"

export async function setMilestoneEligible(args: {
  organizationId: string
  staffMemberId: string
  milestoneEligible: boolean
  /// Clerk user id — the AuditLog.userId convention (src/lib/audit.ts).
  actorUserId: string | null
}): Promise<{ ok: true; milestoneEligible: boolean } | { ok: false }> {
  // By id AND org: another org's id is a 404, never a cross-tenant write.
  const member = await prisma.staffMember.findFirst({
    where: { id: args.staffMemberId, organizationId: args.organizationId },
    select: { id: true, displayName: true, milestoneEligible: true },
  })
  if (!member) return { ok: false }

  // A no-op is still a success, but it writes no audit row: the log records
  // changes, and a double-click is not one.
  if (member.milestoneEligible === args.milestoneEligible) return { ok: true, milestoneEligible: member.milestoneEligible }

  const updated = await prisma.staffMember.update({
    where: { id: member.id },
    data: { milestoneEligible: args.milestoneEligible },
    select: { milestoneEligible: true },
  })
  await writeAuditLog({
    organizationId: args.organizationId,
    userId: args.actorUserId,
    action: MILESTONE_ELIGIBILITY_AUDIT_ACTION,
    entityType: "StaffMember",
    entityId: member.id,
    metadata: { staffName: member.displayName, before: member.milestoneEligible, after: updated.milestoneEligible },
  })
  return { ok: true, milestoneEligible: updated.milestoneEligible }
}
