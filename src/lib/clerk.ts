import { clerkClient } from "@clerk/nextjs/server"
// Subpath export, not the package root — @clerk/backend exposes this only via
// "./errors" (see its package.json exports map).
import type { ClerkAPIResponseError } from "@clerk/backend/errors"

/**
 * DEBT-15. Duck-type on the PAYLOAD, not the class. The import above is
 * TYPE-ONLY, so no ClerkAPIResponseError identity reaches the bundle and it
 * cannot matter how many times Turbopack inlines that class.
 *
 * All THREE checks are load-bearing. `clerkError` is a field on the BASE
 * ClerkError, so it alone establishes nothing about shape; `errors` and a
 * numeric `status` are what the callers actually consume (errors[0].code,
 * err.status). A sibling ClerkError subclass carrying clerkError and errors but
 * no numeric status must fall through to the generic handler rather than
 * produce a wrong code.
 *
 * CHEAP HARDENING, NOT A BUG FIX. This is NOT the fix for the PERM-7 staging
 * collision failure — that had an entirely different cause (staging was running
 * a deployment that predated every PERM-7 commit). Do not let the two be
 * conflated.
 *
 * RELOCATED here 2026-08-03 from api/users/route.ts, where it was private, so
 * the staff-invite route can use the same guard. That route had grown its own
 * bare `err.message` passthrough instead — see api/staff/[id]/invite/route.ts.
 */
export function isClerkErrorPayload(err: unknown): err is ClerkAPIResponseError {
  return (
    typeof err === "object" &&
    err !== null &&
    "clerkError" in err &&
    Array.isArray((err as { errors?: unknown }).errors) &&
    typeof (err as { status?: unknown }).status === "number"
  )
}

// Trimmed + lowercased for storage and comparison; blank → null.
export function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase()
  return trimmed || null
}

// BUG-2: Clerk's membership public_user_data.identifier is NOT guaranteed to
// be an email — on username-enabled accounts it is the username. Anywhere a
// Clerk user's email is persisted it must come from the account's primary
// email address, resolved via the Backend API.
export async function getClerkPrimaryEmail(clerkUserId: string): Promise<string | null> {
  const clerk = await clerkClient()
  const user = await clerk.users.getUser(clerkUserId)
  const primary = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress
  return normalizeEmail(primary)
}

const CLERK_PAGE_SIZE = 100

/**
 * DEBT-46 Phase 3 step 1. Drain a Clerk paginated list endpoint instead of
 * taking whatever the first page happens to hold.
 *
 * CLERK'S LIST ENDPOINTS RETURN THE FIRST **10** ITEMS BY DEFAULT. That number
 * is not in any signature — it is documented only in a doc comment on
 * PaginatedResourceResponse in @clerk/backend, which is why a call that passes
 * no `limit` reads as "give me all of them" and is not. /users called
 * getOrganizationInvitationList with no limit at all, so an org with more than
 * ten pending invitations rendered ten, and the rest were invisible — which on
 * that page means UNREVOKABLE, the same harm as an orphaned PendingInvite
 * reached by a different route. Do not "simplify" this back to a bare call.
 *
 * A RAISED LIMIT IS NOT THE FIX, a loop is. `totalCount` gives a real
 * termination condition; advancing by what was RETURNED rather than by what was
 * REQUESTED keeps that correct against a server-side cap this codebase cannot
 * verify (no maximum is documented in the installed types, and encoding a
 * guessed ceiling would just move the silent truncation); and the zero-row
 * break stops the loop spinning if a page ever comes back empty while
 * totalCount still claims more.
 *
 * `warnAbove` is the count this call used to silently cap at. It fires zero
 * times against any data measured on 2026-08-03 and announces itself the first
 * time an org crosses the threshold — which is the best available signal, since
 * reproducing the bug on staging would take eleven test principals and the
 * fixed and unfixed code render identically below the threshold.
 */
export async function fetchAllClerkPages<T>(
  fetchPage: (params: { limit: number; offset: number }) => Promise<{ data: T[]; totalCount: number }>,
  { label, warnAbove }: { label: string; warnAbove: number }
): Promise<T[]> {
  const all: T[] = []
  let offset = 0
  let totalCount = 0

  for (;;) {
    const page = await fetchPage({ limit: CLERK_PAGE_SIZE, offset })
    totalCount = page.totalCount
    if (page.data.length === 0) break
    all.push(...page.data)
    offset += page.data.length
    if (all.length >= totalCount) break
  }

  if (totalCount > warnAbove) {
    console.warn(
      `[clerk] ${label}: ${totalCount} total, above the ${warnAbove} this call used to stop at — ` +
        `everything past that was silently invisible before DEBT-46. Fetched ${all.length}.`
    )
  }

  return all
}
