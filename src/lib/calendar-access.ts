// ─────────────────────────────────────────────────────────────────────────────
// CAL-1 — THE ONE GATE every calendar route and page asks first.
//
// Ruling 9: "The calendar is a module: an admin toggle on /settings. Off = nav,
// page, API, banner and cron all inert."
//
// OFF MEANS THE API DOES NOT EXIST — 404, NOT 403. That is the shape
// api/labor/toggle/route.ts:21-23 uses for an unavailable module, and the
// distinction is real: a 403 says "this exists and you may not have it", which
// tells an unauthorised caller that an org has the calendar. A 404 says
// nothing. Ruling 9's word is "inert".
//
// NO AVAILABILITY ENV VAR, unlike HR and Labor. R2 (Gary, 2026-09-17) made the
// calendar a plain per-org column rather than a billable add-on behind a
// staged rollout, so there is no `CALENDAR_MODULE_AVAILABLE` and there is no
// second gate to forget. It ships to production off by default and an admin
// turns it on. If a future phase needs the staged shape, copy
// laborModuleAvailable() — do not bolt a second meaning onto this column.
// ─────────────────────────────────────────────────────────────────────────────

import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { can, type Capability, type PermissionUser } from "@/lib/permissions"

export type CalendarAccessDenied = "unauthenticated" | "no-org" | "disabled" | "forbidden"

export type CalendarAccess =
  | {
      ok: true
      org: { id: string; clerkOrgId: string; calendarEnabled: boolean }
      actor: PermissionUser
      isAdmin: boolean
      /** The actor's assigned store ids. EMPTY FOR AN ADMIN — `isAdmin` is the
       *  unrestricted flag and callers must test it, exactly as
       *  getUserStoreScope()'s consumers do. */
      storeIds: string[]
      dbUserId: string | null
    }
  | { ok: false; reason: CalendarAccessDenied }

/**
 * Resolve the caller for a calendar surface: session → org → module toggle →
 * (optionally) a capability.
 *
 * ORDER MATTERS AND IS THE SAME EVERYWHERE: auth, org, MODULE, capability. The
 * module gate sits ahead of the capability check so that a disabled org answers
 * 404 to everyone including an ADMIN, rather than 403 to some and 404 to
 * others — two different answers about the same disabled feature is how a
 * reader learns the feature exists.
 */
export async function requireCalendar(capability?: Capability): Promise<CalendarAccess> {
  const { orgId } = await auth()
  if (!orgId) return { ok: false, reason: "unauthenticated" }

  const org = await prisma.organization.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true, clerkOrgId: true, calendarEnabled: true },
  })
  if (!org) return { ok: false, reason: "no-org" }
  if (!org.calendarEnabled) return { ok: false, reason: "disabled" }

  // getCurrentUser() rather than a bare clerkUserId lookup — CLAUDE.md § Page
  // Conventions: clerkUserId is @unique GLOBALLY, so an identity with
  // memberships in two orgs resolves to whichever org's row it was created in,
  // and that row's ROLE is then handed to this session. DEBT-53/F1 guarded this
  // centrally and a surface that rolls its own lookup opts back out of it.
  const { dbUser, actor } = await getCurrentUser()
  if (capability && !can(actor, capability)) return { ok: false, reason: "forbidden" }

  return {
    ok: true,
    org,
    actor,
    isAdmin: dbUser?.role === "ADMIN",
    storeIds: dbUser?.storeAssignments.map((a) => a.storeId) ?? [],
    dbUserId: dbUser?.id ?? null,
  }
}

/** The HTTP status each refusal earns. `disabled` is 404 by ruling 9 (see the
 *  header); everything else follows the app's existing vocabulary. */
export function calendarDenialStatus(reason: CalendarAccessDenied): number {
  switch (reason) {
    case "unauthenticated":
      return 401
    case "no-org":
      return 404
    case "disabled":
      return 404
    case "forbidden":
      return 403
  }
}

export function calendarDenialBody(reason: CalendarAccessDenied): { error: string } {
  switch (reason) {
    case "unauthenticated":
      return { error: "Unauthorized" }
    case "no-org":
      return { error: "Org not found" }
    case "disabled":
      return { error: "Not found" }
    case "forbidden":
      return { error: "Forbidden" }
  }
}

/**
 * The store ids a calendar read may cover, given an optional requested store.
 *
 * NEVER TRUSTS THE URL. A non-admin's request for a store outside their
 * assignments returns [] rather than that store — the getUserStoreScope()
 * contract ("the authoritative allow-list, sourced from StoreUserAssignment —
 * never from URL params"), applied here so every calendar read expresses it the
 * same way.
 */
export function resolveStoreScope(
  access: Extract<CalendarAccess, { ok: true }>,
  requestedStoreId: string | null,
  allOrgStoreIds: string[]
): string[] {
  const allowed = access.isAdmin ? allOrgStoreIds : access.storeIds.filter((id) => allOrgStoreIds.includes(id))
  if (!requestedStoreId) return allowed
  return allowed.includes(requestedStoreId) ? [requestedStoreId] : []
}

/**
 * The store set an event may be WRITTEN with — B11 (Gary, 2026-09-18).
 *
 * ── THE RULING, AND IT IS A NARROWING RATHER THAN A WIDENING ─────────────────
 * "For non-ADMIN actors, POST and PATCH /api/calendar/events scope stores to
 * the actor's assignments; 'All stores' resolves to the actor's stores; ADMIN
 * is org-wide as today. Applies to reminders and template-backed events alike —
 * one rule."
 *
 * WHY IT WAS RULED. CAL-1 shipped these two routes scoping stores to the ORG,
 * so a MANAGER holding the `calendar.manage` grant could create a reminder for
 * every store in the org. Harmless while an occurrence was only a tick. CAL-2
 * makes an occurrence CREATE A CHECKLIST — and `checklists.create` refuses a
 * store outside the actor's assignments (api/checklists/route.ts), while
 * `checklists.create.bulk` is ADMIN_ONLY. So without this the grant would have
 * reached, through the calendar, a consequence two capabilities are shaped to
 * deny. Gary chose to BOUND the write rather than accept the reach.
 *
 * ONE RULE FOR BOTH ENTITY TYPES. The bound is applied before anything asks
 * whether the event carries a templateId, so a reminder and a scheduled
 * template are scoped identically. Two entity types on one calendar answering
 * two different scoping rules is the kind of split that stops being remembered.
 *
 * ── "ALL STORES" IS RESOLVED AT WRITE TIME, NOT FILTERED AT READ TIME ────────
 * THIS IS THE LOAD-BEARING PART. The materialise cron fans `appliesTo: "all"`
 * out to every active store in the org on every run. An event STORED as "all"
 * by a MANAGER would therefore reach stores this ruling excludes on some later
 * run, even though the form that created it was bounded — and nothing would
 * ever look wrong. So a non-ADMIN's "All stores" is written as
 * `appliesTo: "specific"` with their assigned store ids ENUMERATED. The bound
 * becomes a property of the ROW rather than of the session that made it, and it
 * survives every later read by anyone.
 *
 * Returns null when the actor asked for a store they do not hold — the caller
 * answers 403. An empty result for a non-admin with no assignments is also
 * null: an event scoped to no stores would generate nothing, forever, silently.
 */
export function resolveEventStoreWrite(
  access: Extract<CalendarAccess, { ok: true }>,
  appliesTo: string,
  requestedStoreIds: string[],
  allOrgStoreIds: string[]
): { appliesTo: string; storeIds: string[] } | null {
  if (access.isAdmin) {
    if (appliesTo === "all") return { appliesTo: "all", storeIds: [] }
    const owned = requestedStoreIds.filter((id) => allOrgStoreIds.includes(id))
    if (owned.length !== requestedStoreIds.length) return null
    return { appliesTo, storeIds: owned }
  }

  const mine = access.storeIds.filter((id) => allOrgStoreIds.includes(id))
  if (mine.length === 0) return null

  if (appliesTo === "all") return { appliesTo: "specific", storeIds: mine }

  // Every requested store must be one of theirs. A partial match is refused
  // rather than silently trimmed: quietly dropping a store the operator picked
  // would make the saved event disagree with the form they just submitted.
  if (requestedStoreIds.length === 0) return null
  if (!requestedStoreIds.every((id) => mine.includes(id))) return null
  return { appliesTo: "specific", storeIds: requestedStoreIds }
}
