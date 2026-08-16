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
// api/hr/forms/shared.ts:48, api/hr/documents/[id]/acknowledgments/route.ts:99,
// hr-signed-pdf.ts:765. That is a property of the callers, not of this
// function, and the value it returns is FROZEN into a legal record:
// HrDocumentAcknowledgment.storeName, FormSubmission.storeName, and four
// stamped lines on the signed PDFs — hr-signed-pdf.ts:427 (Certificate of
// Acknowledgment), :616 and :671 (form header and Certificate of Execution),
// :813 (Certificate of Training). One future caller forgetting the orderBy
// would make a signed document's store name depend on row order.
//
// BUILD-2 audit (2026-07-29) confirmed this is a NO-OP against both current
// callers: given an array already sorted isPrimary-desc-then-name-asc, the first
// `isPrimary` row IS index 0, so `.find()` and `sorted[0]` return the same
// element — with one primary, with none, and with duplicates. The behaviour
// change is only for a caller that does not order, which is the point.
//
// DEBT-9 (2026-08-02) adds the corporate branch, and it is the half BUILD-2
// could not reach. BUILD-2 made a no-primary staff member resolve to an
// arbitrary-but-STABLE store; stable is not the same as true. Gary Thomas and
// Kelton Thomas are corporate — available at every location, homed at none —
// so Square reports assigned_locations.assignment_type =
// ALL_CURRENT_AND_FUTURE_LOCATIONS with no location list at all, and the sync
// expands that into one StoreStaffAssignment per store with nothing to derive a
// primary from (square.ts:265-268). SQUARE HAS NO CONCEPT OF A PRIMARY OR
// MASTER LOCATION, so there is no upstream value to import and no hand-set
// primary that would be true — setting one would freeze "Carson", the
// alphabetical winner, onto a legal record.
//
// So the designation lives on StaffMember.isCorporate, NOT on a synthetic
// "Corporate" Store row (Gary, 2026-08-02): Store rows are Square-linked, and a
// fake one leaks into every store picker, forecast, coverage calculation,
// checklist scope, roster and the /staff grouping.
//
// DO NOT "SIMPLIFY" THIS BACK. The corporate branch returning a constant rather
// than a store name is the entire point; the sort below cannot express "no
// store is correct here" no matter how it is ordered.
//
// Warn, don't throw (ruling 6, same date): this must never throw on the
// ambiguous case. Failing mid-signing-ceremony for someone who cannot fix it is
// worse than a wrong-but-stable value, so the guard is a warning on
// /staff/[id], where an admin is already looking — not an exception here.
export const CORPORATE_STORE_LABEL = "Corporate"

export function primaryStoreName(
  staff: {
    isCorporate: boolean
    storeAssignments: { isPrimary: boolean; store: { name: string } }[]
  }
): string | null {
  if (staff.isCorporate) return CORPORATE_STORE_LABEL
  const [best] = [...staff.storeAssignments].sort(
    (a, b) =>
      Number(b.isPrimary) - Number(a.isPrimary) || a.store.name.localeCompare(b.store.name)
  )
  return best?.store.name ?? null
}

// ─── DEBT-70a: the same rule, answering for the ZONE instead of the name ─────
//
// Gary, 2026-08-16. An inline `Date:` stamp on a minted PDF must name the day
// the signer was actually working, and "which day was it" is a question only a
// timezone can answer. `Store.timezone` is the app's settled answer to that
// (checklists, forecasting, labor and reports all read it) and this row does not
// get to invent a second one.
//
// DELIBERATELY A SIBLING OF primaryStoreName RATHER THAN A SECOND SORT. The
// paragraph above that function explains why the ordering lives INSIDE it: the
// value is frozen into a legal record, and one caller forgetting the `orderBy`
// would make a signed document depend on row order. Everything in that argument
// is true of the zone too — it decides a DATE on the same document — so it gets
// the same internal sort rather than a copy of the rule at the call site. The
// two functions must always pick the SAME assignment; that is why they are here
// together, sorted identically, and why neither should be reimplemented inline.
//
// NULL FOR CORPORATE, NOT A CONSTANT — and that is the one place the two
// functions legitimately diverge. primaryStoreName returns CORPORATE_STORE_LABEL
// because "Corporate" is a true and printable answer to "where do they work".
// There is no equivalent for a zone: a corporate member is homed at no location
// (DEBT-9), so there is no store zone to report, and inventing one here would
// bury the fallback inside a function whose callers cannot see it. Null hands
// the question up to Organization.timezone, which is exactly where Gary ruled it
// belongs.
export function primaryStoreTimeZone(
  staff: {
    isCorporate: boolean
    storeAssignments: { isPrimary: boolean; store: { timezone: string; name: string } }[]
  }
): string | null {
  if (staff.isCorporate) return null
  const [best] = [...staff.storeAssignments].sort(
    (a, b) =>
      Number(b.isPrimary) - Number(a.isPrimary) || a.store.name.localeCompare(b.store.name)
  )
  return best?.store.timezone ?? null
}
