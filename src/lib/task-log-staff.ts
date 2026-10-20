import { prisma } from "@/lib/prisma"

// CHK-15 — WHO A CHECKLIST TICK MAY NAME. Ruled by Gary 2026-10-17 as MS-4 fork
// F12: "treat the cross-company staff id as a security fix". Before this, the
// task-log route saved whatever id the request sent — including one from
// another company — and the only constraint was the FK to StaffMember. Since
// MS-4a counts NAMED tasks toward checklist milestones (F0), a bad id here is a
// bad count there.
//
// A name is accepted only if the person is (1) in this org, (2) ACTIVE, and
// (3) assigned to the checklist's store OR flagged isCorporate. "Team Member"
// arrives as "manager" and, like no name at all, saves null and is never
// refused — nobody is ever blocked from completing a task.
//
// FORWARD-ONLY (Gary, 2026-10-17: "F12 is forward-only"). This runs when a
// tick is SAVED. It never re-judges an existing TaskLog, and the route never
// calls it on an un-tick.
//
// The refusal for an id outside the org is deliberately the same sentence as
// for an id that does not exist at all: it must not reveal that the id belongs
// to someone in another company.

export const STAFF_NOT_USABLE =
  "That name can't be used on this checklist. Pick a name from the list, or choose Team Member."

export type TaskLogStaffResult = { ok: true; staffId: string | null } | { ok: false; error: string }

export async function resolveTaskLogStaff(args: {
  organizationId: string
  storeId: string
  staffId: unknown
}): Promise<TaskLogStaffResult> {
  const { organizationId, storeId, staffId } = args
  if (staffId == null || staffId === "" || staffId === "manager") return { ok: true, staffId: null }
  // A number or an object used to reach Prisma and 500. It is not a name.
  if (typeof staffId !== "string") return { ok: false, error: STAFF_NOT_USABLE }

  const member = await prisma.staffMember.findFirst({
    where: { id: staffId, organizationId },
    select: {
      id: true,
      displayName: true,
      status: true,
      isCorporate: true,
      storeAssignments: { where: { storeId }, select: { id: true }, take: 1 },
    },
  })
  if (!member) return { ok: false, error: STAFF_NOT_USABLE }

  // `!== "ACTIVE"`, not `=== "TERMINATED"` — the src/lib/auth.ts:215 precedent.
  if (member.status !== "ACTIVE") {
    return { ok: false, error: `${member.displayName} is no longer an active team member. Choose another name, or Team Member.` }
  }

  if (member.storeAssignments.length === 0 && !member.isCorporate) {
    return {
      ok: false,
      error: `${member.displayName} isn't assigned to this store. Choose Team Member, or ask an admin to add them to this store.`,
    }
  }

  return { ok: true, staffId: member.id }
}
