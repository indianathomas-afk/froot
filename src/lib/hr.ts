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

// ─── SELF-1: the ONE self-resolution helper ──────────────────────────────────
//
// R1 (Gary, 2026-09-07): a login gets its own identity surfaces when it
// resolves to EXACTLY ONE staff member, REGARDLESS OF ROLE. Not "MANAGER or
// ADMIN". Four surfaces consume this — the /dashboard compliance banner, the
// /staff own-row pin, and the sidebar footer's name and link — and they consume
// THIS function rather than each resolving self their own way. Four callers
// each answering "which staff member am I" independently is how BUG-2 happened,
// and it is the six-derivations story TYPE-1 and hr-compliance.ts:507 both tell.
//
// WHY THIS IS NOT findStaffMemberForUser. That function answers "find me a
// plausible staff row" and is correct for what it does; this one answers R1's
// question, which is stricter in two specific ways:
//
//   (1) EXACTLY ONE IS A COUNT, NOT A findFirst. findStaffMemberForEmail
//       (:11) is `findFirst` with no orderBy over a column with no unique
//       index — StaffMember.email is `String?` and the model's only @@unique is
//       ([organizationId, squareTeamMemberId]). It returns row one of however
//       many match and calls that an answer. Today's data makes it look
//       deterministic; that is a property of the ROWS, not of the function —
//       precisely the critique the primaryStoreName comment above (:44) makes
//       of its own former self. `take: 2` plus a length test is the difference
//       between "one match" and "the first of several".
//
//   (2) AN EMAIL MATCH LINKED TO A DIFFERENT LOGIN IS SOMEBODY ELSE'S PROFILE.
//       The guard is `userId IS NULL OR userId = this login`, applied IN THE
//       QUERY so that `take: 2` is sufficient to detect ambiguity — filtering
//       in JS after a bare take would let two other-linked rows crowd out the
//       real match and report a false miss.
//
// (2) IS NOT NEW TO THIS CODEBASE, IT IS NEW TO THIS MODULE. /users has had it
// since DEBT-46 (users/page.tsx:184, "An email match linked to a different
// login is someone else's profile"), so the app has held two different answers
// to one question, and the permissive one was the one gating signing
// ceremonies. Gary's scope ruling 2026-09-07: findStaffMemberForEmail KEEPS ITS
// CURRENT SEMANTICS — the guard lives here, not there, and the divergence is
// filed as a row rather than closed by this phase.
//
// THE FK ARM NEEDS NO COUNT AND THAT ASYMMETRY IS DELIBERATE.
// StaffMember.userId is `String? @unique` (schema), so the database already
// guarantees at most one. Only the email arm is unconstrained, so only the
// email arm is defended. Stated because a future reader will otherwise "fix"
// the asymmetry by adding a redundant count to the FK arm, or delete the real
// one on the grounds that the other side manages without it.
//
// STATUS-BLIND ON PURPOSE. A terminated person is still that person, and the
// sidebar footer naming them is correct. The ACTIVE requirement belongs to the
// surfaces that make a CLAIM about ongoing obligation — getActiveStaffSelf
// (auth.ts) refuses TERMINATED for every /my/* read and for the SELF-1 banner,
// which is what keeps acceptance criterion 6 true. Do not add a status filter
// here: it would silently blank the footer for someone mid-offboarding, and it
// would put the employment-status rule in two places.
//
// ORG SCOPE IS THE CALLER'S, AND "THE ORG ID" IS THREE DIFFERENT STRINGS.
// `organizationId` here is Organization.id — the DATABASE id, which both
// User.organizationId and StaffMember.organizationId reference. It is NOT the
// Clerk `org_…` string (Organization.clerkOrgId), and it is not interchangeable
// with User.clerkUserId vs User.id either. Compounding the trap: Organization.id
// is `@default(cuid())`, but rows created before that default was settled carry
// a UUID, so the ids of two orgs in the same table can be different SHAPES —
// which means an id that "looks wrong" is not evidence you have the wrong one.
// All three get called "the org id" in conversation and the ambiguity has
// already cost one wrong query during SELF-1 planning (2026-09-07).
export type SelfStaffResolution =
  | { ok: true; via: "link" | "email"; staffMember: NonNullable<Awaited<ReturnType<typeof findStaffMemberForUser>>> }
  | { ok: false; reason: "no-email" | "no-match" | "ambiguous" }

export async function resolveSelfStaff(
  organizationId: string,
  user: { id: string; email: string | null | undefined }
): Promise<SelfStaffResolution> {
  const linked = await prisma.staffMember.findFirst({
    where: { organizationId, userId: user.id },
    include: staffSelfInclude,
  })
  if (linked) return { ok: true, via: "link", staffMember: linked }

  const needle = user.email?.trim()
  if (!needle) return { ok: false, reason: "no-email" }

  // take: 2 — the smallest read that can tell "exactly one" from "more than
  // one". The guard is in the `where`, so both rows that come back are genuine
  // candidates and a length of 2 is a real ambiguity rather than an artefact of
  // the page size.
  const candidates = await prisma.staffMember.findMany({
    where: {
      organizationId,
      email: { equals: needle, mode: "insensitive" },
      OR: [{ userId: null }, { userId: user.id }],
    },
    include: staffSelfInclude,
    orderBy: { id: "asc" },
    take: 2,
  })

  if (candidates.length === 0) return { ok: false, reason: "no-match" }
  if (candidates.length > 1) {
    // Loud, because the surfaces are silent: an unresolved login renders no
    // banner, which is the same pixel as being compliant. This log line is the
    // only trace an ambiguity leaves, and the R3 admin surface is the row filed
    // to fix that.
    console.warn(
      `[self] ambiguous email resolution for user ${user.id} in org ${organizationId}: ` +
        `${candidates.length}+ staff rows match (${candidates.map((c) => c.id).join(", ")})`
    )
    return { ok: false, reason: "ambiguous" }
  }
  return { ok: true, via: "email", staffMember: candidates[0] }
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

/**
 * The default every zone in this app falls back to. Same literal as
 * `Store.timezone` and `Organization.timezone` carry in the schema — stated
 * once here so the three cannot drift apart.
 */
export const DEFAULT_TIME_ZONE = "America/Los_Angeles"

// ─── DEBT-70b: the ruled chain, written once ─────────────────────────────────
//
// signer's primary store -> Organization.timezone -> the schema default.
//
// DEBT-70a (623acb6) established this chain and spelled it out inline at the
// single mint site. DEBT-70b needs it at twenty-two more, and twenty-two copies
// of a fallback chain is how the fallback quietly becomes three different
// chains. So it lives here, beside the resolver it wraps.
//
// THERE IS NO BARE-UTC ARM, AND THAT IS THE POINT. UTC is the wrong answer this
// row exists to remove; if it were reachable as a fallback, every site that
// failed to load a store would silently reproduce the defect while looking
// fixed. `org` is therefore required, not optional — a caller that cannot
// supply one has not loaded enough to render a date, and should say so rather
// than be handed a plausible wrong answer.
//
// `staff` IS optional, because some surfaces legitimately have none: /users
// lists Clerk identities, not StaffMembers, and there is no store to ask. Those
// enter the chain at the org step, which is the same chain, not a second one.
export function displayTimeZone(
  staff:
    | {
        isCorporate: boolean
        storeAssignments: { isPrimary: boolean; store: { timezone: string; name: string } }[]
      }
    | null
    | undefined,
  org: { timezone: string }
): string {
  return (staff ? primaryStoreTimeZone(staff) : null) ?? org.timezone ?? DEFAULT_TIME_ZONE
}
