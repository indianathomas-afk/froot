import { prisma } from "@/lib/prisma"

// TAB-4 — WHO MAY SET OR RESET A STAFF MEMBER'S PIN (Gary, 2026-11-10, Q5).
//
//   ADMIN    anyone in the org.
//   MANAGER  their OWN record, and staff assigned to one of their stores —
//            EXCEPT a record that belongs to another MANAGER or an ADMIN
//            (Q5 ii: "Only an ADMIN can set or reset another MANAGER's or
//            another ADMIN's PIN").
//   others   nobody (STORE and STAFF hold no staff.manage).
//
// The capability check (staff.manage) is the route's; this is the scope rule
// on top of it. `decidePinAccess` is PURE so the fixture drives the matrix.
// Nothing here ever reads or returns pinHash (Q5 iv).

export type PinAccessViewer = { role: string; isAdmin: boolean; storeIds: string[]; selfStaffId: string | null }
export type PinAccessTarget = { id: string; storeIds: string[]; loginRole: string | null }
export type PinAccessDecision = { ok: true; by: "admin" | "manager" | "self" } | { ok: false; status: 403 | 404; error: string }

export const PIN_ADMIN_ONLY = "Only an admin can set another manager's or an admin's PIN."

export function decidePinAccess(viewer: PinAccessViewer, target: PinAccessTarget): PinAccessDecision {
  if (viewer.isAdmin) return { ok: true, by: "admin" }
  if (viewer.role !== "MANAGER") return { ok: false, status: 403, error: "Manager or Admin access required" }
  if (viewer.selfStaffId && viewer.selfStaffId === target.id) return { ok: true, by: "self" }
  // Out of the manager's stores → 404, the same answer PATCH /api/staff/[id]
  // gives, so the route does not confirm the person exists.
  if (!target.storeIds.some((s) => viewer.storeIds.includes(s))) {
    return { ok: false, status: 404, error: "Staff member not found" }
  }
  if (target.loginRole === "ADMIN" || target.loginRole === "MANAGER") {
    return { ok: false, status: 403, error: PIN_ADMIN_ONLY }
  }
  return { ok: true, by: "manager" }
}

const RANK: Record<string, number> = { ADMIN: 3, MANAGER: 2, STORE: 1, STAFF: 0 }

/** The role of the login this staff record belongs to, if any: the linked
 *  User (StaffMember.userId), else an org User sharing the record's email —
 *  the same two routes resolveSelfStaff (src/lib/hr.ts) uses to say "this
 *  record is that login's". The highest role wins, so an ADMIN's record that is
 *  linked only by email is still protected. */
export async function staffLoginRole(
  organizationId: string,
  member: { userId: string | null; email: string | null }
): Promise<string | null> {
  const roles: string[] = []
  if (member.userId) {
    const u = await prisma.user.findFirst({ where: { id: member.userId, organizationId }, select: { role: true } })
    if (u) roles.push(u.role)
  }
  const email = member.email?.trim()
  if (email) {
    const users = await prisma.user.findMany({
      where: { organizationId, email: { equals: email, mode: "insensitive" } },
      select: { role: true },
    })
    roles.push(...users.map((u) => u.role))
  }
  if (roles.length === 0) return null
  return roles.reduce((a, b) => ((RANK[b] ?? 0) > (RANK[a] ?? 0) ? b : a))
}
