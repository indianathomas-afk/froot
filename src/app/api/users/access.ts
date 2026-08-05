import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { can } from "@/lib/permissions"

// PERM-5C. Shared guard for every /api/users handler — the same shape as
// api/templates/access.ts and api/stores/access.ts, with one difference: two
// callers need the acting User row itself (the self-edit and self-removal
// refusals compare against caller.id / caller.clerkUserId), so this returns the
// row rather than just allowing or denying.
//
// users.manage is ADMIN_ONLY, matching the requireAdmin() this replaces.
//
// COARSE BY RULING (Gary, 2026-08-04). users.manage covers seeing the member
// list, inviting, changing roles and stores, removing a member, and revoking a
// pending invitation. There is no view tier: /users IS the management surface
// and GET /api/users is its own data source, serving nothing else in the app,
// so a read-only tier would grant "look at the roster and do nothing", which
// nobody has asked for. The honest reading of the toggle is "denying Users
// removes all of it". Splitting later is cheap now that the page and all five
// handlers already sit on can().
export async function requireUsersManage(): Promise<
  { ok: true; caller: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>["dbUser"]> } | { ok: false; response: NextResponse }
> {
  const deny = { ok: false as const, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  try {
    const { dbUser, actor } = await getCurrentUser()
    if (!dbUser || !can(actor, "users.manage")) return deny
    return { ok: true, caller: dbUser }
  } catch {
    return deny
  }
}
