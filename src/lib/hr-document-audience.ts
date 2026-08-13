import { GRANTEE_STAFF, GRANTEE_STORE } from "@/lib/hr-documents-access"

// DOC-1 B — the audience WRITE algorithm, as a pure function.
//
// This lives outside the route for one reason: a Next route file may only
// export handlers, so anything inside it can be exercised only by standing up
// the framework and holding a Clerk session. The delta is the load-bearing part
// of the whole phase — get it wrong and an unrelated save silently revokes
// somebody's access — so it is here, where a verification script can call the
// SHIPPED function instead of a re-typed copy of it. Testing a copy of a write
// algorithm proves the copy.
//
// NOT the reach count, which stays in the route as a call to grantedToStaff
// itself: that one must not become a second expression of a policy rule
// (lib/hr-documents-access.ts's header explains why). This is not policy — it
// is bookkeeping about rows.

export type ExistingGrant = {
  id: string
  granteeType: string
  storeId: string | null
  staffMemberId: string | null
}

export type AudienceDelta = {
  removeIds: string[]
  createStoreIds: string[]
  createStaffMemberIds: string[]
}

// A DELTA, NOT A REPLACE (ruling (c), Gary 2026-08-12). Rows that survive an
// edit are not rewritten, so createdAt/createdById keep saying who granted this
// audience and when — provenance that a delete-all/insert-all would reset on
// every unrelated save.
export function computeAudienceDelta(
  existing: ExistingGrant[],
  storeIds: string[],
  staffMemberIds: string[]
): AudienceDelta {
  const wantStores = new Set(storeIds)
  const wantStaff = new Set(staffMemberIds)
  const haveStores = new Set(
    existing.filter((g) => g.granteeType === GRANTEE_STORE && g.storeId).map((g) => g.storeId!)
  )
  const haveStaff = new Set(
    existing
      .filter((g) => g.granteeType === GRANTEE_STAFF && g.staffMemberId)
      .map((g) => g.staffMemberId!)
  )

  return {
    // The `false` fall-through leaves a row of any unrecognised granteeType
    // alone rather than sweeping it. The hrdoc_grant_shape CHECK makes such a
    // row impossible today; quietly deleting the impossible is how a future
    // third grantee type would lose its rows on the first unrelated save.
    removeIds: existing
      .filter((g) =>
        g.granteeType === GRANTEE_STORE
          ? !wantStores.has(g.storeId ?? "")
          : g.granteeType === GRANTEE_STAFF
            ? !wantStaff.has(g.staffMemberId ?? "")
            : false
      )
      .map((g) => g.id),
    createStoreIds: storeIds.filter((id) => !haveStores.has(id)),
    createStaffMemberIds: staffMemberIds.filter((id) => !haveStaff.has(id)),
  }
}
