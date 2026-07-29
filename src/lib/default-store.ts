// ─────────────────────────────────────────────────────────────────────────────
// BUILD-2 — User.defaultStoreId.
//
// The column lives on User, not on StoreUserAssignment, because ADMINs have NO
// assignment rows at all: every page scopes with
// `...(isAdmin ? {} : { id: { in: storeIds } })` (src/lib/auth.ts:137-142 and 38
// call sites), and the create form hides the store picker for ADMIN outright
// (src/app/(app)/users/user-actions.tsx:104, mirrored by the edit dialog's
// notice at :230-233). A flag on the assignment table would have no row to sit
// on for exactly the account that most needs a default — the PERM-7 device
// admin.
//
// Validated in TWO places, both load-bearing:
//
//   WRITE — a principal may only set a store it can actually see. Checked
//           against the assignment set the write WILL PRODUCE, not the one in
//           the database now, because /api/users/[id] replaces role, assignments
//           and default in one request (route.ts:136-146). Same reasoning as
//           PERM-6's primaryStoreId check at api/staff/[id]/route.ts:87-93.
//
//   READ  — re-checked every single time it is used, because assignments churn
//           AFTER a default is set and NOTHING clears the column when they do:
//             · the Clerk webhook drops every assignment on
//               organizationMembership.deleted (webhooks/clerk/route.ts:234) and
//               leaves defaultStoreId pointing at a store the user has lost;
//             · an admin edit replaces the whole assignment set
//               (api/users/[id]/route.ts:140-143).
//           The FK is to Store, so onDelete: SetNull only fires when the STORE
//           is deleted — losing access to a store that still exists does not
//           touch the column. A stale default must therefore fall back SILENTLY
//           to alphabetically-first, which is the answer every picker already
//           gives today. It must never surface an error: the user did nothing
//           wrong and has no way to act on the message.
//
// THIS MODULE DOES NOT READ THE DEFAULT ANYWHERE. UX-2 owns consumption across
// the ~20 store selectors; BUILD-2 lands the column, its validation, and the
// ways to set it. Wiring one picker here would add a twenty-first uncoordinated
// selector, which is the problem UX-2 exists to remove.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma"

/** Minimal shape the resolver needs — any store row satisfies it. */
export type StoreChoice = { id: string; name: string }

/**
 * READ-TIME resolution. Returns the store the user should land on: their chosen
 * default when it is still visible to them, otherwise the alphabetically-first
 * store they can see, otherwise null (no stores at all).
 *
 * `visibleStores` is whatever that principal is allowed to see — an ADMIN's
 * whole org, or a non-admin's assigned set. The caller already computes this for
 * every page via the isAdmin spread; pass the same list.
 *
 * Sorts internally ON PURPOSE, duplicating the `orderBy: { name: "asc" }` the
 * callers' queries already apply. That redundancy is the lesson from
 * primaryStoreName() (src/lib/hr.ts:44-49), which has no internal tie-break and
 * is correct today only because all of its callers happen to order their
 * queries. A helper whose determinism depends on caller discipline is one
 * forgetful caller away from being nondeterministic.
 *
 * Note the sort is JS `localeCompare`, not Postgres collation, so an exotic
 * name pair could order differently here than in a `ORDER BY name` query. That
 * is acceptable: this function only has to be deterministic and to agree with
 * the pickers in practice, and it is never used to reconcile two orderings.
 */
export function resolveDefaultStore<T extends StoreChoice>(
  defaultStoreId: string | null | undefined,
  visibleStores: readonly T[]
): T | null {
  if (visibleStores.length === 0) return null
  const sorted = [...visibleStores].sort((a, b) => a.name.localeCompare(b.name))
  if (defaultStoreId) {
    const chosen = sorted.find((s) => s.id === defaultStoreId)
    if (chosen) return chosen
  }
  return sorted[0] ?? null
}

/**
 * Whether a stored default is still usable by this principal. Split out from
 * resolveDefaultStore so a caller can tell "fell back" apart from "was already
 * on the first store" — the two are indistinguishable in the return value when
 * the default happens to BE the alphabetically-first store.
 *
 * UX-2 will want this to decide whether to show a "showing X instead" hint.
 */
export function isDefaultStoreStale(
  defaultStoreId: string | null | undefined,
  visibleStores: readonly StoreChoice[]
): boolean {
  if (!defaultStoreId) return false
  return !visibleStores.some((s) => s.id === defaultStoreId)
}

export type DefaultStoreValidation = { ok: true } | { ok: false; error: string }

/**
 * WRITE-TIME validation. Call before persisting defaultStoreId.
 *
 * `resultingStoreIds` must be the assignment set AFTER the write being
 * validated — for /api/users/[id] that is the incoming `storeIds`, not the rows
 * currently in the database. Validating against the current set would reject a
 * legitimate "assign store B and default to B" in one request, and would accept
 * a default on store A in a request that removes store A.
 *
 * `isAdmin` refers to the ROLE THE USER WILL HAVE after the write, for the same
 * reason. An admin may default to any store in the org, since an admin sees
 * every store and has no assignment rows to check against.
 *
 * Clearing the default (null / undefined) is always allowed — it restores the
 * alphabetically-first behaviour that predates this column.
 */
export async function validateDefaultStore(args: {
  organizationId: string
  defaultStoreId: string | null | undefined
  isAdmin: boolean
  resultingStoreIds: readonly string[]
}): Promise<DefaultStoreValidation> {
  const { organizationId, defaultStoreId, isAdmin, resultingStoreIds } = args

  if (!defaultStoreId) return { ok: true }

  // Org ownership is checked for BOTH roles. For a non-admin the membership
  // test below already implies it (the caller org-checks storeIds), but a
  // cross-tenant id must not be able to ride in on a trusted-input assumption.
  const owned = await prisma.store.count({
    where: { id: defaultStoreId, organizationId },
  })
  if (owned === 0) {
    return { ok: false, error: "That location does not belong to this organization" }
  }

  if (!isAdmin && !resultingStoreIds.includes(defaultStoreId)) {
    return {
      ok: false,
      error: "The default location must be one of the locations this user can access",
    }
  }

  return { ok: true }
}
