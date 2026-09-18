import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { auth } from "@clerk/nextjs/server"
import { CalendarClient } from "./calendar-client"

// CAL-1 — /calendar. Server guard, then the grid.
//
// THE PAGE GUARD IS NOT THE GATE and never was: every route under
// api/calendar/* enforces independently through requireCalendar(). This exists
// so a STORE login that types the URL lands somewhere sensible instead of on a
// page whose every fetch 403s (the PERM-3 precedent — "must ask the same
// capability that gates the destination"), and so the module being off is
// indistinguishable from the page not existing (ruling 9).
//
// REDIRECTS RATHER THAN 404s for the disabled case, because the person hitting
// it is a signed-in member of the org who followed a stale link or a bookmark,
// and /dashboard is where everything else in this app bounces.

export default async function CalendarPage() {
  const { orgId } = await auth()
  if (!orgId) redirect("/dashboard")

  const org = await prisma.organization.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true, calendarEnabled: true },
  })
  if (!org?.calendarEnabled) redirect("/dashboard")

  // getCurrentUser(), never a bare clerkUserId lookup — CLAUDE.md § Page
  // Conventions. clerkUserId is @unique GLOBALLY, so an identity with
  // memberships in two orgs resolves to whichever org's row created it and that
  // row's ROLE is handed to this session. Twenty existing pages still roll their
  // own (DEBT-55) and Gary ruled them latent; this one does not join them.
  const { dbUser, actor } = await getCurrentUser()
  if (!can(actor, "calendar.view")) redirect("/dashboard")

  const canManage = can(actor, "calendar.manage")
  const isAdmin = dbUser?.role === "ADMIN"
  const assignedStoreIds = dbUser?.storeAssignments.map((a) => a.storeId) ?? []

  const stores = await prisma.store.findMany({
    where: {
      organizationId: org.id,
      isActive: true,
      // ADMIN sees every store; everyone else sees theirs. The picker offers
      // only what the API would serve anyway (resolveStoreScope), so the two
      // cannot disagree about what is reachable.
      ...(isAdmin ? {} : { id: { in: assignedStoreIds } }),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  const staff = canManage
    ? []
    : await prisma.staffMember.findMany({
        where: { organizationId: org.id, status: "ACTIVE" },
        select: { id: true, fullName: true, displayName: true },
        orderBy: { fullName: "asc" },
      })

  return (
    <CalendarClient
      stores={stores}
      canManage={canManage}
      // B11 (CAL-2): the store-write bound is enforced in POST/PATCH
      // /api/calendar/events; this only decides whether the form's "All stores"
      // option says "all" or "all mine". The label follows the rule rather than
      // being the rule.
      isAdmin={isAdmin}
      // STORE/STAFF are fixed to their store; ADMIN/MANAGER pick. With exactly
      // one store in scope the picker is still rendered but has one option —
      // simpler than a second layout, and honest about what they are seeing.
      isMultiStore={stores.length > 1}
      staff={staff.map((s) => ({ id: s.id, name: s.fullName || s.displayName || "" }))}
    />
  )
}
