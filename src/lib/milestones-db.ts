// MS-1 — tenure milestone WRITES, extracted from the routes so the duplicate
// rule is one function that both the routes and scripts/verify-ms1.ts run.
//
// NO TWO NON-ARCHIVED MILESTONES IN AN ORG SHARE A dayCount (Gary, 2026-10-15:
// "duplicate day counts blocked in code"). Not an index — see the
// TenureMilestone schema note. Check and write share one transaction.
//
// THE CALLER HAS ALREADY PASSED requireMilestones("milestones.manage") and
// resolved organizationId from the session. These functions are not a gate.

import { prisma } from "@/lib/prisma"
import { localDateStr } from "@/lib/reports"

type Fields = { dayCount: number; title: string; recognition: string; employeeMessage: string }

export async function createTenureMilestone(organizationId: string, data: Fields) {
  return prisma.$transaction(async (tx) => {
    const clash = await tx.tenureMilestone.findFirst({
      where: { organizationId, isArchived: false, dayCount: data.dayCount },
      select: { id: true },
    })
    if (clash) return "clash" as const
    return tx.tenureMilestone.create({ data: { organizationId, ...data } })
  })
}

export async function updateTenureMilestone(
  organizationId: string,
  id: string,
  data: Partial<Fields> & { isArchived?: boolean }
) {
  return prisma.$transaction(async (tx) => {
    // Org-scoped lookup: a foreign id is not-found, never a cross-tenant write.
    const current = await tx.tenureMilestone.findFirst({ where: { id, organizationId } })
    if (!current) return "not-found" as const

    // The rule applies to the row's RESULTING state: a dayCount edit on an
    // active row, and an UNARCHIVE of a row whose dayCount another active row
    // has taken since, are both refused. Archiving can never clash.
    const nextArchived = data.isArchived ?? current.isArchived
    const nextDayCount = data.dayCount ?? current.dayCount
    if (!nextArchived) {
      const clash = await tx.tenureMilestone.findFirst({
        where: { organizationId, isArchived: false, dayCount: nextDayCount, id: { not: id } },
        select: { id: true },
      })
      if (clash) return "clash" as const
    }
    // archivedAt DATES the archive (Gary, 2026-10-15: past achievements stay on
    // record). Stamped only on the transition into archived, so re-saving an
    // archived row never moves the date; cleared on restore.
    const archivedAt =
      data.isArchived === true && !current.isArchived
        ? { archivedAt: new Date() }
        : data.isArchived === false
          ? { archivedAt: null }
          : {}
    return tx.tenureMilestone.update({ where: { id }, data: { ...data, ...archivedAt } })
  })
}

// ─── MS-4a — CHECKLIST MILESTONES ────────────────────────────────────────────
// The same duplicate rule as tenure, on taskCount: no two NON-ARCHIVED checklist
// milestones in an org share one. Check and write share one transaction. The
// tenure functions above are not generalised over both models on purpose — two
// Prisma delegates do not share a type, and a cast would hide a wrong-table
// write from the compiler.

type ChecklistFields = { taskCount: number; title: string; recognition: string; employeeMessage: string }

export async function createChecklistMilestone(organizationId: string, data: ChecklistFields) {
  return prisma.$transaction(async (tx) => {
    const clash = await tx.checklistMilestone.findFirst({
      where: { organizationId, isArchived: false, taskCount: data.taskCount },
      select: { id: true },
    })
    if (clash) return "clash" as const
    return tx.checklistMilestone.create({ data: { organizationId, ...data } })
  })
}

export async function updateChecklistMilestone(
  organizationId: string,
  id: string,
  data: Partial<ChecklistFields> & { isArchived?: boolean }
) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.checklistMilestone.findFirst({ where: { id, organizationId } })
    if (!current) return "not-found" as const

    // Judged on the RESULTING state, as updateTenureMilestone does.
    const nextArchived = data.isArchived ?? current.isArchived
    const nextTaskCount = data.taskCount ?? current.taskCount
    if (!nextArchived) {
      const clash = await tx.checklistMilestone.findFirst({
        where: { organizationId, isArchived: false, taskCount: nextTaskCount, id: { not: id } },
        select: { id: true },
      })
      if (clash) return "clash" as const
    }
    const archivedAt =
      data.isArchived === true && !current.isArchived
        ? { archivedAt: new Date() }
        : data.isArchived === false
          ? { archivedAt: null }
          : {}
    return tx.checklistMilestone.update({ where: { id }, data: { ...data, ...archivedAt } })
  })
}

/** F13 (Gary, 2026-10-17) — the "Checklist milestones" switch. No settings row
 *  = OFF, the column's default. Only meaningful once milestonesActive() passes;
 *  this is not the module gate. */
export async function checklistMilestonesEnabled(organizationId: string): Promise<boolean> {
  const row = await prisma.milestoneSettings.findUnique({
    where: { organizationId },
    select: { checklistMilestonesEnabled: true },
  })
  return row?.checklistMilestonesEnabled ?? false
}

/** First save creates the settings row with every other column at its default
 *  (A7, the MS-2 pattern); an existing row keeps its other values. */
export async function setChecklistMilestonesEnabled(organizationId: string, enabled: boolean) {
  await prisma.milestoneSettings.upsert({
    where: { organizationId },
    create: { organizationId, checklistMilestonesEnabled: enabled },
    update: { checklistMilestonesEnabled: enabled },
  })
}

/**
 * F0 — the store-local date of every task naming this member, oldest first.
 * ORG-SCOPED THROUGH THE CHECKLIST: a TaskLog has no organizationId, and the
 * FK alone only proves the StaffMember exists somewhere (the CHK-15 finding).
 * Ties on completedAt break by id so the Nth task is stable between renders.
 * Unnamed ("Team Member") ticks have a null staff id and never match.
 */
export async function namedTaskDates(args: {
  organizationId: string
  staffMemberId: string
  zone: string
}): Promise<string[]> {
  const rows = await prisma.taskLog.findMany({
    where: { completedByStaffId: args.staffMemberId, checklist: { organizationId: args.organizationId } },
    orderBy: [{ completedAt: "asc" }, { id: "asc" }],
    select: { completedAt: true },
  })
  return rows.map((r) => localDateStr(r.completedAt, args.zone))
}
