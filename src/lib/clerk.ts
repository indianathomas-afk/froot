import { clerkClient } from "@clerk/nextjs/server"

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
