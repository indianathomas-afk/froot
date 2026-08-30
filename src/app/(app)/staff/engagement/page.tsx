import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { EngagementClient } from "./engagement-client"

// ─────────────────────────────────────────────────────────────────────────────
// ENG-1 — /staff/engagement. ADMIN-only view of who is actually using Froot.
//
// THE GATE HERE IS THE SECOND OF TWO, NOT THE ONLY ONE. This page renders a
// shell; every number on it comes from GET /api/staff/engagement, which asks the
// SAME capability. Gary's D2 ruling: the page must not fetch inline, because
// then engagement.view would have no consumer that can be tested by request and
// COMP-1's F3 defect would be reproduced exactly.
//
// A THIRD GATE SITS ABOVE THIS ONE AND IS EASY TO MISS: (app)/staff/layout.tsx
// redirects anyone without staff.view (MANAGE) before this file runs. The
// effective gate on this page is therefore staff.view AND engagement.view. That
// only ever SUBTRACTS — every ADMIN holds staff.view at baseline — so it changes
// nobody's access, but it does mean a MANAGER is bounced by the LAYOUT and never
// exercises the line below. Do not read a green "MANAGER cannot see the page"
// test as proof that engagement.view works; the route's 403 is that proof.
// ─────────────────────────────────────────────────────────────────────────────

export default async function EngagementPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>
}) {
  let ctx
  try {
    ctx = await getCurrentUser()
  } catch {
    redirect("/dashboard")
  }
  const { org, actor } = ctx

  if (!can(actor, "engagement.view")) redirect("/dashboard")

  const { store: storeParam } = await searchParams

  // Resolved server-side so the heading can name the store without waiting on
  // the fetch, and so a foreign id never reaches the client as if it were real.
  const store = storeParam
    ? await prisma.store.findFirst({
        where: { id: storeParam, organizationId: org.id },
        select: { id: true, name: true, storeNumber: true },
      })
    : null

  const stores = await prisma.store.findMany({
    where: { organizationId: org.id },
    select: { id: true, name: true, storeNumber: true },
    orderBy: { name: "asc" },
  })

  return <EngagementClient store={store} stores={stores} />
}
