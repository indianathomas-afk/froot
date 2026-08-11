import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// HR-22 shared pieces for the bulk-assign pair (POST bulk, GET bulk/recipients).
// Both routes resolve the SAME module and apply the SAME applicability rule —
// a picker that offers a recipient the write would refuse is the defect this
// phase exists to avoid, so the predicate lives in one place.

export type RecipientMember = {
  id: string
  displayName: string
  status: string
  isCorporate: boolean
  userId: string | null
  storeAssignments: { storeId: string }[]
}

// One select shape, so the picker and the write see identical facts about a
// person. `status` and `isCorporate` are carried even where a query has already
// filtered on them: the classifier reads them, it does not infer them.
export const RECIPIENT_SELECT = {
  id: true,
  displayName: true,
  status: true,
  isCorporate: true,
  userId: true,
  storeAssignments: { select: { storeId: true } },
} as const

export type AssignableModule = {
  id: string
  title: string
  appliesTo: string
  storeAssignments: { storeId: string }[]
}

// 404 for unknown-or-foreign — the findManageableStaffMember discipline
// (access.ts:80-81): a foreign id reads as nonexistent, never as forbidden.
// 409 for a module that exists but cannot be assigned.
//
// isActive and isArchived REFUSE here rather than silently dropping the id, so
// they never enter the recipient arithmetic. The single-assign path drops such
// ids without a word (assignments/route.ts:35-38) — audit findings #2/#3, ruled
// 2026-08-11 to HR-23 rather than absorbed here, because tightening acceptance
// without also fixing that path's response shape (finding #4) trades loud
// over-acceptance for silent dropping.
export async function loadAssignableModule(moduleId: string, orgDbId: string) {
  const fail = (error: string, status: number) =>
    ({ ok: false as const, response: NextResponse.json({ error }, { status }) })

  const trainingModule = await prisma.trainingModule.findFirst({
    where: { id: moduleId, organizationId: orgDbId },
    select: {
      id: true,
      title: true,
      appliesTo: true,
      isActive: true,
      isArchived: true,
      storeAssignments: { select: { storeId: true } },
    },
  })

  if (!trainingModule) return fail("Training module not found", 404)
  if (trainingModule.isArchived) {
    return fail("This module is archived and can no longer be assigned", 409)
  }
  if (!trainingModule.isActive) {
    return fail("Activate this module before assigning it", 409)
  }

  return { ok: true as const, trainingModule }
}

// The rule the /staff/[id] offer list already applies (staff page.tsx:394-399)
// and the assign API never has. `appliesTo: "selected"` with no store
// assignments applies to nobody, which is the correct reading of the data.
//
// Corporate staff carry a StoreStaffAssignment for every store (Square's
// ALL_CURRENT_AND_FUTURE expansion, StaffMember schema comment), so a
// selected-scope module is always applicable to them — the corporate rule below
// is what governs whether they are reached, not this one.
export function applicabilityCheck(module: AssignableModule) {
  if (module.appliesTo === "all") return () => true
  const moduleStoreIds = new Set(module.storeAssignments.map((a) => a.storeId))
  return (member: { storeAssignments: { storeId: string }[] }) =>
    member.storeAssignments.some((a) => moduleStoreIds.has(a.storeId))
}
