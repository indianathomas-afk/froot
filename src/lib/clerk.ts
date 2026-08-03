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
