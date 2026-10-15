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
