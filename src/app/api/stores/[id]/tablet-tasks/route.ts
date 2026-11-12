import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { getUserStoreScope } from "@/lib/auth"
import { readTabletTasksFor } from "./read"

// GET /api/stores/[id]/tablet-tasks — TAB-8. READ-ONLY.
//
// The tablet Tasks panel's server half for ONE store: the store's day, header
// date and picker names, and today's checklists with their items and ticks.
// Until TAB-8 the tablet re-read this with router.refresh() of /dashboard, and
// a failed RSC refresh makes Next fall back to a full browser navigation — on
// an unattended counter iPad with the wifi down, Safari's error page stays up
// until someone touches it. A failed fetch of this route just keeps what is
// showing (src/lib/tablet-tasks-refresh.ts).
//
// The gates and the read are in ./read.ts (orgId 401, org 404, store in org
// 404, store scope 403 — task-log's order). Nothing here or there writes: a new
// day's checklist is never created by reading it; rows come from Start
// (POST /api/checklists) and the calendar materialise cron.
//
// The only caller is the tablet home (src/app/(app)/dashboard/tablet-home.tsx).
// TAB-14, 2026-11-11 — appended; the line above is spent, kept. The tablet
// Checklists page (src/app/(app)/checklists/checklists-tablet.tsx) re-reads
// through it too, on the same refresh cycle (TAB-14 RN-6, Gary).

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  const { id: storeId } = await params
  const result = await readTabletTasksFor(orgId, storeId, getUserStoreScope)
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  })
}
