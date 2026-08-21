import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, laborModuleAvailable, squareLaborAvailable } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { DayInspectorClient } from "./day-inspector-client"

// Labor Day Inspector (OVL-S5) — the troubleshooting surface. Pick a store and a
// day, see every person's timecards on a timeline with the scheduled shifts
// ghosted behind and the variance flags computed. It exists so that diagnosing a
// Square-vs-Froot labor variance never needs database access again (BUG-10).
//
// FIVE GATES, CLONED FROM /settings/labor's THREE AND THEN TWO MORE (S5-D1).
// Availability + per-org toggle + labor.manage are settings/labor/page.tsx's,
// verbatim in shape and in order. squareLaborAvailable() and org.squareLaborEnabled
// are the additions: every row this page renders is Square-labor-sourced, so with
// the overlay off the honest answer is that the page does not exist — not a
// timeline drawn from whatever rows predate the toggle being flipped.
//
// NOT STORE-VISIBLE (Gary, 2026-08-21). labor.manage is MANAGE-tier, which is the
// point rather than an oversight: STORE accounts are shared iPad logins, and this
// page puts a named person's whole day on screen. Wages, rates, tips and pay data
// NEVER appear here, and shift notes are never selected.

export default async function LaborInspectorPage() {
  let ctx: Awaited<ReturnType<typeof getCurrentUser>>
  try {
    ctx = await getCurrentUser()
  } catch {
    redirect("/dashboard")
  }
  const { org, dbUser, actor } = ctx

  // Gate 1 (env availability) + Gate 2 (per-org toggle).
  if (!laborModuleAvailable(org.clerkOrgId) || !org.activeModules.includes("labor")) {
    notFound()
  }
  // Gates 3 and 4 — L-2 seam (a). Order is load-bearing exactly as it is in
  // requireSquareLabor(): labor first, so square-labor-without-labor is
  // unreachable rather than merely discouraged.
  if (!squareLaborAvailable(org.clerkOrgId) || !org.squareLaborEnabled) {
    notFound()
  }
  // Gate 5. can() on `actor` rather than dbUser.role, so a PERM-5 per-user
  // override is consulted — /settings/labor's precedent (page.tsx:44) and its
  // reasoning, unchanged: labor.manage is the capability the nav already asks for
  // every manager-tier labor surface.
  if (!can(actor, "labor.manage")) {
    redirect("/dashboard")
  }

  const isAdmin = dbUser?.role === "ADMIN"

  // THE PICKER FILTERS UNLINKED STORES, AND DEBT-78 IS WHY (S5-A11). Staging holds
  // two "Las Brisas" Store rows; cmqvygque000004l7hj2me30o has squareLocationId
  // NULL and is a fossil from before the link existed. Both SquareTimecard.storeId
  // and SquareScheduledShift.storeId are resolved FROM squareLocationId at sync
  // time, so an unlinked store can hold no rows by construction — it would render
  // an empty timeline that reads exactly like a broken sync. Rendering two
  // identically-named entries and letting the reader guess is the failure mode
  // DEBT-78 names ("the next person to pick a store by name has two to choose from
  // and no way to tell which is real"), and on a DIAGNOSTIC page it is worse than
  // elsewhere: the wrong pick produces a blank day that looks like a finding.
  const stores = await prisma.store.findMany({
    where: {
      organizationId: org.id,
      isActive: true,
      squareLocationId: { not: null },
      ...(isAdmin ? {} : { id: { in: dbUser?.storeAssignments.map((a) => a.storeId) ?? [] } }),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  })

  return <DayInspectorClient stores={stores} />
}
