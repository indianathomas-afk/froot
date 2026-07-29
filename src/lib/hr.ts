// HR, Training & Compliance helpers — staff identity resolution. The
// compliance rollup (HR-8) lives in src/lib/hr-compliance.ts.

import { prisma } from "@/lib/prisma"

// Clerk identities (User) and StaffMember rows are separate populations —
// most staff never get a login, and StaffMember deliberately has no userId
// FK. The self-serve signing flow (HR-4) maps the session to a staff profile
// by org-scoped, case-insensitive email match; a manager fixes a miss by
// setting the staff member's email in the directory.
export async function findStaffMemberForEmail(organizationId: string, email: string | null | undefined) {
  const needle = email?.trim()
  if (!needle) return null
  return prisma.staffMember.findFirst({
    where: { organizationId, email: { equals: needle, mode: "insensitive" } },
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
// store, falling back to their alphabetically-first assignment.
//
// Orders INTERNALLY rather than trusting the caller's query. This was
// `.find((a) => a.isPrimary) ?? storeAssignments[0]`, which is deterministic
// only because every caller happens to select with
// `orderBy: [{ isPrimary: "desc" }, { store: { name: "asc" } }]` — hr.ts:23,
// api/hr/forms/shared.ts:48, api/hr/documents/[id]/acknowledgments/route.ts:99.
// That is a property of the callers, not of this function, and the value it
// returns is FROZEN into a legal record: HrDocumentAcknowledgment.storeName,
// FormSubmission.storeName, and the certificate line on the signed PDF
// (hr-signed-pdf.ts:615, :426, :670). One future caller forgetting the orderBy
// would make a signed document's store name depend on row order.
//
// BUILD-2 audit (2026-07-29) confirmed this is a NO-OP against both current
// callers: given an array already sorted isPrimary-desc-then-name-asc, the first
// `isPrimary` row IS index 0, so `.find()` and `sorted[0]` return the same
// element — with one primary, with none, and with duplicates. The behaviour
// change is only for a caller that does not order, which is the point.
//
// Note this does NOT fix DEBT-9: a staff member with no primary still resolves
// to an arbitrary-but-stable store. It makes that stability a guarantee here
// rather than a coincidence.
export function primaryStoreName(
  staff: { storeAssignments: { isPrimary: boolean; store: { name: string } }[] }
): string | null {
  const [best] = [...staff.storeAssignments].sort(
    (a, b) =>
      Number(b.isPrimary) - Number(a.isPrimary) || a.store.name.localeCompare(b.store.name)
  )
  return best?.store.name ?? null
}
