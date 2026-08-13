// ── DOC-1 Phase A: who a document is FOR ─────────────────────────────────────
//
// The document library moved from "every document is visible to every org
// member" to "a document is visible to its assigned audience". This module is
// the whole rule. It follows lib/training.ts exactly, and for the same reason
// that file gives: a policy FUNCTION rather than a role test copied into ten
// files, so that when the input to this rule changes it changes here, once,
// with a name.
//
// TWO EXPRESSIONS OF ONE RULE, KEPT ADJACENT SO THEY CANNOT DRIFT — the
// HR-24/HR-25 pattern. The `...Where` fragments narrow a list query; the
// predicates are asked per document. List surfaces do BOTH: narrow, then
// re-filter through the predicate, so if the fragment and the function ever
// disagree the stricter answer ships.
//
// TWO QUESTIONS, DELIBERATELY SEPARATE, AND THIS IS THE LOAD-BEARING DECISION
// OF THE PHASE:
//
//   canReadHrDocument(doc, viewer) — may this VIEWER read it? The viewer may be
//     a STORE login on a shared iPad with no StaffMember at all, so this cannot
//     be expressed in terms of a staff member.
//
//   grantedToStaff(doc, staff)     — does this document apply to this STAFF
//     MEMBER? The obligation question (ruling 7: for an Acknowledgment,
//     assignment IS the obligation to sign).
//
// The manager-attest path is why they are two functions and not one with a
// flag. /hr/acknowledge/[id]?staff=X asks the SECOND question about X — never
// the first about the manager (ruling 4, Gary 2026-08-12). The pre-DOC-1 code
// asked neither: it checked only whether the manager's stores overlapped the
// staff member's, which answers "may this manager act for this person" and says
// nothing about whether the document reaches them. A single function with a
// boolean would eventually be passed the wrong subject at one of ten call
// sites; two names cannot be.
//
// STANDING GRANTS, NOT SNAPSHOTS (ruling 1). Everything below resolves through
// the roster at READ time. A new hire or a transfer picks up the correct
// documents on their next page load with no assignment sweep, and nothing here
// is ever materialized.
//
// SIGNED RECORDS ARE UNTOUCHED BY ANY OF THIS (ruling 4). Revoking a grant
// stops serving a document; it never invalidates a signature already given, and
// no function here is consulted when reading an executed record —
// canReadHrSignedRecord (lib/hr-files.ts) still governs those, unchanged.

import { findStaffMemberForUser } from "@/lib/hr"

// HrDocument.appliesTo = "all" IS the company-wide grant and needs no row.
// Anything else means the grant rows are the whole audience — and zero rows
// therefore reaches ADMIN only, which is the deliberate default for a newly
// uploaded document until Phase B's assign dialog gives it one.
export const COMPANY_WIDE = "all"

export const GRANTEE_STORE = "STORE"
export const GRANTEE_STAFF = "STAFF"

export type DocumentGrant = {
  granteeType: string
  storeId: string | null
  staffMemberId: string | null
}

// `appliesTo` and `grants` are REQUIRED rather than optional, which is the
// training.ts rule (ReadableTrainingModule, :97-100) and matters more here: an
// optional `grants` would let a caller that forgot to `include` them get a
// confident "not granted" for a document whose audience simply was not
// selected. Missing is a type error instead.
export type AudienceDocument = {
  organizationId: string
  kind: string
  appliesTo: string
  grants: DocumentGrant[]
}

// The roster side. `isCorporate` is required for the reason R3 was ruled: Square
// expands corporate staff to a StoreStaffAssignment for EVERY store
// (StaffMember schema comment), so a store-grant test that does not exclude
// them sweeps every corporate member into every store grant — silently, with
// correct-looking data at every step.
export type GrantedStaff = {
  id: string
  isCorporate: boolean
  storeAssignments: { storeId: string }[]
}

// THE TWO STORE-ASSIGNMENT TABLES ARE NOT INTERCHANGEABLE AND BOTH APPEAR HERE.
//   userStoreIds — StoreUserAssignment, the LOGIN's stores. What a STORE iPad
//                  account has. ADMINs deliberately have no rows at all.
//   staff        — the viewer's own StaffMember, whose storeAssignments are
//                  StoreStaffAssignment, the ROSTER.
// A STORE login has the first and not the second; most staff have the second
// and not the first. Resolving a store grant from the wrong one is the failure
// this type exists to make impossible.
export type DocumentViewer = {
  orgDbId: string
  role: string | null
  userStoreIds: string[]
  staff: GrantedStaff | null
}

// ── The obligation question ──────────────────────────────────────────────────
// Does this document reach this staff member? Used by every staff-facing
// surface, by both signing surfaces, and — the point of ruling 4 — by both
// signing WRITE routes before a signature is accepted. "Can't see it but can
// still sign it" is a hole the moment audiences exist.
export function grantedToStaff(doc: AudienceDocument, staff: GrantedStaff): boolean {
  if (doc.appliesTo === COMPANY_WIDE) return true

  if (doc.grants.some((g) => g.granteeType === GRANTEE_STAFF && g.staffMemberId === staff.id)) {
    return true
  }

  // R3 (Gary, 2026-08-12), the training bulk-assign rule in spirit
  // (api/hr/training/assignments/bulk/route.ts:187): corporate staff have no
  // store home base, so a STORE grant never reaches them however many
  // StoreStaffAssignment rows Square gave them. COMPANY grants cover them
  // (above), and an individual STAFF grant is always available.
  if (staff.isCorporate) return false

  const storeIds = new Set(staff.storeAssignments.map((a) => a.storeId))
  return doc.grants.some(
    (g) => g.granteeType === GRANTEE_STORE && g.storeId !== null && storeIds.has(g.storeId)
  )
}

// ── The read question ────────────────────────────────────────────────────────
// Keyed on kind first, exactly as the pre-DOC-1 canReadHrDocument was — the
// audience layer is added on top of that switch, it does not replace it.
export function canReadHrDocument(doc: AudienceDocument, viewer: DocumentViewer): boolean {
  if (doc.organizationId !== viewer.orgDbId) return false

  // Document configuration is already ADMIN territory (HR-2), and an admin who
  // cannot read a document cannot assign it in Phase B either.
  if (viewer.role === "ADMIN") return true

  switch (doc.kind) {
    case "Reference":
    case "Acknowledgment":
      return reachesViewer(doc, viewer)
    case "FillableForm":
      // UNCHANGED FROM THE PRE-DOC-1 POLICY, DELIBERATELY. FillableForm is the
      // template DEFINITION (no source file — forms render natively); it is
      // managed by ADMIN and executed by ADMIN/MANAGER on the supervisor's
      // device, and every /hr/forms surface already gates on exactly this pair.
      // Gary ruled those sites out of Phase A (R1), so the audience layer is
      // deliberately NOT applied here — widening or narrowing it would be an
      // out-of-scope behaviour change smuggled in through a shared function.
      return viewer.role === "MANAGER"
    default:
      return false
  }
}

// The audience test for a VIEWER, as distinct from a staff member. A person can
// satisfy it two ways at once — a manager who is also on the roster is reached
// both by their own grants and by their login's stores — so this is a union,
// not a precedence chain.
function reachesViewer(doc: AudienceDocument, viewer: DocumentViewer): boolean {
  if (doc.appliesTo === COMPANY_WIDE) return true
  if (viewer.staff && grantedToStaff(doc, viewer.staff)) return true

  // Ruling 5: a STORE login is a shared device, not a person. It displays
  // store- and company-granted documents; the signing act stays in the
  // per-person flows, which is enforced at the signing surfaces rather than
  // here (this function answers read, not sign).
  //
  // MANAGER IS INCLUDED ON THE SAME BRANCH AND THAT IS A DECISION, NOT AN
  // OVERSIGHT. Managers frequently have no StaffMember row, and without this
  // they would lose read access they hold today while still being able to
  // attest for their team — an incoherent pair. Store-scoped rather than
  // org-wide is HR-26's precedent for exactly this question (lib/training.ts,
  // "MANAGER IS NARROWER THAN STORE, DELIBERATELY"), and it keeps org-wide
  // reach as ADMIN's alone. This does NOT affect the attest path, which asks
  // grantedToStaff about the STAFF MEMBER and never asks this function.
  if (viewer.role === "STORE" || viewer.role === "MANAGER") {
    const loginStores = new Set(viewer.userStoreIds)
    return doc.grants.some(
      (g) => g.granteeType === GRANTEE_STORE && g.storeId !== null && loginStores.has(g.storeId)
    )
  }

  return false
}

// Ruling 5, second half: a STORE login may DISPLAY an Acknowledgment document
// but may not sign it — the signing act stays in the per-person flows. Read
// access is canReadHrDocument's answer; this is the affordance question that
// sits on top of it, named so the surfaces cannot each invent it.
export function canSignHrDocument(viewer: DocumentViewer): boolean {
  return viewer.role !== "STORE"
}

// ── Query-shaped twins ───────────────────────────────────────────────────────
// The `grants` relation is the Prisma field on HrDocument; the physical table
// is still HrDocumentStoreAssignment (@@map), which is why a raw SQL reader
// sees the old name.

// Documents that reach this STAFF MEMBER. The twin of grantedToStaff, and the
// direct replacement for the hand-written
//   OR: [{ appliesTo: "all" }, { storeAssignments: { some: … } }]
// clause that four call sites carried before DOC-1 — with the corporate
// exclusion those four never had, because until now no grant row existed for it
// to matter.
export function staffAudienceWhere(staff: GrantedStaff) {
  const storeIds = staff.storeAssignments.map((a) => a.storeId)
  return {
    OR: [
      { appliesTo: COMPANY_WIDE },
      { grants: { some: { granteeType: GRANTEE_STAFF, staffMemberId: staff.id } } },
      // Corporate staff are never reached by a STORE grant (R3) — the disjunct
      // is omitted entirely rather than passed an empty list, so the query says
      // what the rule says.
      ...(staff.isCorporate
        ? []
        : [{ grants: { some: { granteeType: GRANTEE_STORE, storeId: { in: storeIds } } } }]),
    ],
  }
}

// Documents that reach this VIEWER. ADMIN gets an empty fragment (no
// narrowing); everyone else gets the union described in reachesViewer.
export function viewerAudienceWhere(viewer: DocumentViewer) {
  if (viewer.role === "ADMIN") return {}

  const or: Record<string, unknown>[] = [{ appliesTo: COMPANY_WIDE }]

  if (viewer.staff) {
    or.push({ grants: { some: { granteeType: GRANTEE_STAFF, staffMemberId: viewer.staff.id } } })
    if (!viewer.staff.isCorporate) {
      const rosterStoreIds = viewer.staff.storeAssignments.map((a) => a.storeId)
      or.push({ grants: { some: { granteeType: GRANTEE_STORE, storeId: { in: rosterStoreIds } } } })
    }
  }

  if (viewer.role === "STORE" || viewer.role === "MANAGER") {
    or.push({ grants: { some: { granteeType: GRANTEE_STORE, storeId: { in: viewer.userStoreIds } } } })
  }

  return { OR: or }
}

// The `include` every call site needs to be able to ask these questions. Named
// so that a surface cannot half-load the audience and get a confident wrong
// answer — the shape the predicates require is the shape this selects.
export const AUDIENCE_INCLUDE = {
  grants: { select: { granteeType: true, storeId: true, staffMemberId: true } },
} as const

// ── The one loader ───────────────────────────────────────────────────────────
// Resolves a session into the DocumentViewer shape, once per request. The
// alternative — each surface assembling the three inputs itself — is how the
// two store-assignment tables get mixed up, so it is not offered.
//
// `dbUser` is whatever getCurrentUser()/getActiveStaffSelf() already returned;
// its storeAssignments are the LOGIN's (StoreUserAssignment). The roster side
// is fetched here only when the caller does not already hold the staff member.
export async function resolveDocumentViewer(
  orgDbId: string,
  dbUser: { id: string; email: string; role: string; storeAssignments: { storeId: string }[] } | null,
  knownStaff?: GrantedStaff | null
): Promise<DocumentViewer> {
  if (!dbUser) {
    return { orgDbId, role: null, userStoreIds: [], staff: null }
  }

  let staff: GrantedStaff | null = knownStaff ?? null
  if (knownStaff === undefined) {
    const found = await findStaffMemberForUser(orgDbId, dbUser)
    staff = found
      ? {
          id: found.id,
          isCorporate: found.isCorporate,
          storeAssignments: found.storeAssignments.map((a) => ({ storeId: a.storeId })),
        }
      : null
  }

  return {
    orgDbId,
    role: dbUser.role,
    userStoreIds: dbUser.storeAssignments.map((a) => a.storeId),
    staff,
  }
}
