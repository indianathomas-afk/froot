import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { notFound } from "next/navigation"
import { ChecklistExecutionClient } from "./checklist-execution-client"

export default async function ChecklistExecutionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { orgId } = await auth()
  if (!orgId) return notFound()

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return notFound()

  const checklist = await prisma.checklist.findFirst({
    where: { id, organizationId: org.id },
    include: {
      store: true,
      template: {
        include: {
          // CHK-1: the section join, so the client groups on the entity rather
          // than on the free-text string. Passed through to
          // ChecklistExecutionClient's Task shape alongside `sectionsSnapshot`
          // below — src/lib/sections.ts decides which one wins.
          tasks: {
            include: { attachment: true, section: { select: { name: true, sortOrder: true } } },
            orderBy: { orderIndex: "asc" },
          },
          // TPL-2 step (2): joined row is the truth for the execution header.
          // The second of the two sites reached through `checklist.template`,
          // and the only one where the render lives in a client component — so
          // ChecklistExecutionClient's Props declares it too.
          templateType: { select: { name: true } },
        },
      },
      taskLogs: true,
    },
  })

  if (!checklist) return notFound()

  const { isAdmin, storeIds } = await getUserStoreScope()
  // Non-admins can never view a checklist for a store they aren't assigned to,
  // even by guessing the checklist ID directly.
  if (!isAdmin && !storeIds.includes(checklist.storeId)) return notFound()

  // The "Who completed this task?" picker. CHK-15: ACTIVE only — the task-log
  // route refuses a terminated name (src/lib/task-log-staff.ts), so listing one
  // would offer a choice that is always rejected.
  const staff = await prisma.staffMember.findMany({
    where: {
      organizationId: org.id,
      status: "ACTIVE",
      storeAssignments: { some: { storeId: checklist.storeId } },
    },
    select: { id: true, displayName: true },
    orderBy: { displayName: "asc" },
  })

  // CHK-15 — NAMES FOR TICKS ALREADY SAVED, display only. The picker list above
  // no longer contains someone terminated (or moved) since they did the work,
  // so their "completed by" line would go blank on reopen. History keeps its
  // credit (F12 is forward-only); this resolves those names, org-scoped.
  const loggedStaffIds = [
    ...new Set(checklist.taskLogs.map((l) => l.completedByStaffId).filter((s): s is string => s != null)),
  ]
  const staffNames = loggedStaffIds.length
    ? await prisma.staffMember.findMany({
        where: { organizationId: org.id, id: { in: loggedStaffIds } },
        select: { id: true, displayName: true },
      })
    : []

  // Handoff note targets (I-14): every active checklist available to this
  // store — the "Post to…" picker in the next-shift composer.
  const handoffTargets = await prisma.template.findMany({
    where: {
      organizationId: org.id,
      isActive: true,
      isArchived: false,
      OR: [{ appliesTo: "all" }, { storeAssignments: { some: { storeId: checklist.storeId } } }],
    },
    select: { id: true, name: true, operationalPhase: true },
    orderBy: { name: "asc" },
  })

  return (
    <ChecklistExecutionClient checklist={checklist} staff={staff} staffNames={staffNames} handoffTargets={handoffTargets} />
  )
}
