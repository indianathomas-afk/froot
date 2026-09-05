import { actorFor, getCurrentUser } from "@/lib/auth"
import { GUIDE_ARTICLES } from "@/generated/guide"
import { helpScope, type GuideSurface, type HelpScope } from "@/lib/help-access"
import type { PermissionUser } from "@/lib/permissions"

// HELP-1a — the server-side adapter that loads a request's actor and org and
// hands them to helpScope(). Thin on purpose.
//
// WHY THIS IS A SEPARATE FILE FROM help-access.ts. The policy file has ZERO
// I/O imports — no Prisma, no Clerk, no next/*. That is deliberate and it is
// the same property src/lib/permissions.ts has (883 lines, zero imports), which
// is what makes can() callable from a route handler, a server component and a
// client component alike. Putting getCurrentUser() into help-access.ts would
// cost that, and would make the policy untestable without a database.
//
// So: policy is pure and lives there; loading is impure and lives here. Every
// consumer of the help surface goes through one of these two functions, so
// there is still exactly ONE place that decides what a reader may see.

/**
 * The help scope for a reader inside the admin shell.
 *
 * Per-request, never cached across readers: labor.access and 25 other
 * capabilities are deniable per user, so two MANAGERs in the same org with the
 * same role and the same modules can have different visible article sets. A
 * static index cannot represent that (audit §F.2).
 */
export async function appHelpScope(): Promise<HelpScope> {
  const { org, actor } = await getCurrentUser()
  return helpScope(actor, org, GUIDE_ARTICLES, { surface: "app" })
}

/**
 * The help scope for a reader inside the /my portal.
 *
 * Takes the already-loaded staff-portal user rather than calling
 * getCurrentUser() again — the /my pages resolve their own identity through
 * getActiveStaffSelf(), and re-loading here would be a second query for a fact
 * the caller already holds.
 */
export function myHelpScope(
  dbUser: Parameters<typeof actorFor>[0],
  org: { activeModules: readonly string[] }
): HelpScope {
  return helpScope(actorFor(dbUser), org, GUIDE_ARTICLES, { surface: "my" })
}

/** Build a scope for an arbitrary actor. Used by the verification scripts. */
export function scopeFor(
  actor: PermissionUser,
  org: { activeModules: readonly string[] },
  surface: GuideSurface
): HelpScope {
  return helpScope(actor, org, GUIDE_ARTICLES, { surface })
}
