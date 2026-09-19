import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { auth } from "@clerk/nextjs/server"
import { localDateStr } from "@/lib/reports"
import { DEFAULT_TIME_ZONE } from "@/lib/hr"
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
    select: { id: true, calendarEnabled: true, timezone: true },
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
    select: { id: true, name: true, timezone: true },
    orderBy: { name: "asc" },
  })

  const staff = canManage
    ? []
    : await prisma.staffMember.findMany({
        where: { organizationId: org.id, status: "ACTIVE" },
        select: { id: true, fullName: true, displayName: true },
        orderBy: { fullName: "asc" },
      })

  // ── CAL-2a — "TODAY" IS RESOLVED HERE, IN THE STORE'S ZONE ────────────────
  // The grid used to derive it with `new Date().toISOString().slice(0, 10)` in
  // the client, which is a UTC calendar date: at 18:35 PDT on 2026-09-18 the
  // marker sat on Sat 19 Sep. CLAUDE.md § Database Evidence is the same class
  // of error one layer out — a UTC instant read as a local day.
  //
  // PER STORE, NOT PER SERVER AND NOT PER BROWSER. Stores sit in different
  // zones and the calendar is store-scoped, so "today" has to mean today where
  // the work is — the /api/calendar/due cutoff (:37) and the materialise cron
  // (:256) already resolve it this way, and the shape here is forecasting's
  // (forecasting/page.tsx:53): one `today` on each store option, resolved with
  // the same localDateStr every other store-local day in this app goes through.
  //
  // BAKED AT RENDER, so a tab left open across midnight shows a stale marker
  // until it is reloaded. Harmless and deliberate — the marker is a hint, and
  // every write that depends on a date is bounded server-side per request.
  const now = new Date()
  // No bare-UTC arm anywhere in the chain (DEBT-70a's rule): a member with no
  // store in scope still needs a date for the "+ New" button's default, and it
  // comes from the org's own zone rather than from the server's.
  const orgToday = localDateStr(now, org.timezone || DEFAULT_TIME_ZONE)

  return (
    <CalendarClient
      stores={stores.map((s) => ({ id: s.id, name: s.name, today: localDateStr(now, s.timezone) }))}
      orgToday={orgToday}
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
