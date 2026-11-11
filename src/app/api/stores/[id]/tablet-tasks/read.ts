import { prisma } from "@/lib/prisma"
import { pinGateApplies } from "@/lib/tablet-pin-gate"
import { stripTileKeys } from "@/lib/display-layout"
import { loadTabletData, type TabletChecklist, type TabletStore } from "@/app/(app)/dashboard/tablet-data"

// TAB-8 — the body of GET /api/stores/[id]/tablet-tasks, apart from Clerk, so
// scripts/verify-tab8.ts runs THIS code against dev rows (the
// api/templates/task-sync.ts pattern). READ-ONLY: no create, update, upsert,
// delete, raw SQL or AuditLog here or in loadTabletData; the fixture checks
// the source.
//
// GATES, in task-log's order (POST /api/checklists/[id]/task-log), with the
// store standing where task-log has the checklist — the exact gates of
// GET /api/stores/[id]/templates, which the same panel already calls:
//   1. no orgId                          → 401
//   2. no Organization row               → 404
//   3. store not in this org, or inactive → 404 (the page lists active stores only)
//   4. store outside the caller's scope   → 403 (getUserStoreScope, asked only now)
// No capability is asked: /dashboard's dashboard.view is granted to every role
// and is not enforceable (page.tsx). DEBT-107 stays open.
//
// TAB-8 fix, 2026-11-11 (Gary: "Add pinRequired and stripTiles to the
// tablet-tasks answer"). Two more props of TabletHome that router.refresh()
// used to bring back every cycle, computed EXACTLY as page.tsx computes them:
//   pinRequired  pinGateApplies(org, role) — the org's Shared Tablets switch
//                AND a STORE login (TAB-4 Q2a). Without it a switch flipped
//                mid-day blocked ticking until a reload, both ways.
//   stripTiles   stripTileKeys(org.tabletLayout) — the ADMIN's tile choice
//                and order (TAB-3).
// role, the rail and the store list stay frozen until a reload (Gary, same
// ruling).

export type StoreScope = { isAdmin: boolean; storeIds: string[]; role: string | null }

export type TabletTasksResult =
  | { status: 200; body: { store: TabletStore; checklists: TabletChecklist[]; pinRequired: boolean; stripTiles: string[] } }
  | { status: 401 | 403 | 404; body: { error: string } }

export async function readTabletTasksFor(
  clerkOrgId: string | null | undefined,
  storeId: string,
  scope: () => Promise<StoreScope>
): Promise<TabletTasksResult> {
  if (!clerkOrgId) return { status: 401, body: { error: "Unauthorized" } }

  const org = await prisma.organization.findUnique({
    where: { clerkOrgId },
    select: { id: true, tabletPinRequired: true, tabletLayout: true },
  })
  if (!org) return { status: 404, body: { error: "Org not found" } }

  const store = await prisma.store.findFirst({
    where: { id: storeId, organizationId: org.id, isActive: true },
    select: { id: true, name: true, timezone: true },
  })
  if (!store) return { status: 404, body: { error: "Store not found" } }

  const { isAdmin, storeIds, role } = await scope()
  if (!isAdmin && !storeIds.includes(store.id)) return { status: 403, body: { error: "Forbidden" } }

  // THE PAYLOAD IS loadTabletData()'s, BY CONSTRUCTION: the function
  // /dashboard renders the tablet with, for this one store — the same
  // tasksForChecklist (TPL-3 R1), excludedStoreIds and section-snapshot
  // filters, the same store-local "today", the same picker names with hasPin.
  const { stores, checklists } = await loadTabletData(org.id, [store])
  return {
    status: 200,
    body: { store: stores[0], checklists, pinRequired: pinGateApplies(org, role), stripTiles: stripTileKeys(org.tabletLayout) },
  }
}
