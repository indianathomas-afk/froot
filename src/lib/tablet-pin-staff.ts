import { prisma } from "@/lib/prisma"
import type { PinStaff } from "@/lib/tablet-pin-options"

// TAB-4 — EACH STORE'S PICKABLE NAMES, WITH hasPin, for the desktop screens a
// STORE login completes calendar reminders from (the due banner on /dashboard
// and /checklists, and the calendar detail). A STORE login cannot read
// GET /api/staff (staff.view is ADMIN + MANAGER), so the server pages pass
// these in — and only while PINs are required, so nothing else pays the query.
//
// The same filter as every checklist picker (store-view/checklist/[id]/page.tsx,
// dashboard/tablet-data.ts): this org, ACTIVE, assigned to the store,
// displayName ascending. `hasPin` is pinSetAt — never the hash.

export async function loadPinStaffByStore(
  organizationId: string,
  storeIds: string[]
): Promise<Record<string, PinStaff[]>> {
  if (storeIds.length === 0) return {}
  const rows = await prisma.staffMember.findMany({
    where: { organizationId, status: "ACTIVE", storeAssignments: { some: { storeId: { in: storeIds } } } },
    select: { id: true, displayName: true, pinSetAt: true, storeAssignments: { select: { storeId: true } } },
    orderBy: { displayName: "asc" },
  })
  const out: Record<string, PinStaff[]> = Object.fromEntries(storeIds.map((id) => [id, []]))
  for (const m of rows) {
    for (const a of m.storeAssignments) {
      out[a.storeId]?.push({ id: m.id, displayName: m.displayName, hasPin: m.pinSetAt !== null })
    }
  }
  return out
}

/** TAB-4 (Gary, Q7) — the /settings card's per-store readiness line, e.g.
 *  "University: 9 of 14 active staff have PINs". Information only; it never
 *  blocks switching on. Counts ACTIVE staff assigned to each active store — the
 *  people the pickers offer there. */
export type PinReadiness = { storeId: string; storeName: string; active: number; withPin: number }

export async function tabletPinReadiness(organizationId: string): Promise<PinReadiness[]> {
  const [stores, staff] = await Promise.all([
    prisma.store.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.staffMember.findMany({
      where: { organizationId, status: "ACTIVE" },
      select: { pinSetAt: true, storeAssignments: { select: { storeId: true } } },
    }),
  ])
  return stores.map((s) => {
    const here = staff.filter((m) => m.storeAssignments.some((a) => a.storeId === s.id))
    return { storeId: s.id, storeName: s.name, active: here.length, withPin: here.filter((m) => m.pinSetAt !== null).length }
  })
}

export function readinessLine(r: PinReadiness): string {
  return `${r.storeName}: ${r.withPin} of ${r.active} active staff ${r.active === 1 ? "has a PIN" : "have PINs"}`
}
