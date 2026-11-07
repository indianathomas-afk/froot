import { prisma } from "@/lib/prisma"

// ─────────────────────────────────────────────────────────────────────────────
// DEBT-129 — keeping User.name in step with Clerk.
//
// RULE A (Gary, 2026-11-06): a User's name is Clerk's first + last name,
// trimmed and joined by one space. Empty → null. NEVER the username, never the
// email, never anything containing "@". FROOT NEVER INVENTS A NAME: when Clerk
// has none, the column stays null and the display fallbacks
// (authorName() in src/lib/messages.ts, the email's "Team member") apply.
//
// ONE FUNCTION, EVERY WRITER. clerkDisplayName() is the only place the rule
// lives; the webhook, the /users auto-sync and the usage-beacon lazy fill all
// go through it, so the rule cannot drift between writers.
//
// THE ONE NAME FROOT ITSELF SETS IS A DEVICE NAME, and it is protected
// (Ruling 4, PERM-7): a STORE invite with exactly one store is named for its
// store at membership creation (api/webhooks/clerk/route.ts), overriding what
// a human typed into Clerk. Both sync paths below therefore SKIP role STORE —
// a device name stays create-only (Gary, DEBT-129 Ruling 1, 2026-11-06). The
// test is role STORE rather than isDeviceLogin()'s role + one-assignment,
// because the role is on the row and the assignment count is not; a STORE row
// that is not a device keeps whatever name it was born with, which is the safe
// direction.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rule A. Takes first and last name ONLY — there is deliberately no username
 * or email parameter, so neither can leak in.
 */
export function clerkDisplayName(
  firstName: string | null | undefined,
  lastName: string | null | undefined
): string | null {
  const joined = [firstName, lastName]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" ")
  if (!joined) return null
  if (joined.includes("@")) return null
  return joined
}

/**
 * Webhook path (user.updated). Writes Clerk's name onto every non-STORE row for
 * this Clerk user. A null name writes NOTHING — Clerk losing a name never blanks
 * one Froot already has. Returns the number of rows written.
 */
export async function syncUserNameFromClerk(
  clerkUserId: string,
  firstName: string | null | undefined,
  lastName: string | null | undefined
): Promise<number> {
  const name = clerkDisplayName(firstName, lastName)
  if (!name) return 0
  const { count } = await prisma.user.updateMany({
    where: { clerkUserId, role: { not: "STORE" } },
    data: { name },
  })
  return count
}

/**
 * Lazy backfill (usage beacon, inside its 15-minute throttle). Fills a NULL name
 * from Clerk, once. Does not call the loader at all when the row already has a
 * name or is a STORE row, so a named user costs no Clerk call. The write
 * re-checks `name: null` in the WHERE, so a row named in the meantime (by the
 * webhook, or a concurrent beacon) is never overwritten.
 *
 * NEVER THROWS. A Clerk or database failure is logged and returns 0 — a broken
 * name fill must never break the beacon (Gary, Ruling 2).
 */
export async function fillMissingUserName(
  user: { id: string; name: string | null; role: string },
  loadClerkName: () => Promise<{ firstName: string | null; lastName: string | null }>
): Promise<number> {
  if (user.name !== null || user.role === "STORE") return 0
  try {
    const { firstName, lastName } = await loadClerkName()
    const name = clerkDisplayName(firstName, lastName)
    if (!name) return 0
    const { count } = await prisma.user.updateMany({
      where: { id: user.id, name: null, role: { not: "STORE" } },
      data: { name },
    })
    return count
  } catch (e) {
    console.error("[user-name] lazy name fill failed:", e instanceof Error ? e.message : e)
    return 0
  }
}
