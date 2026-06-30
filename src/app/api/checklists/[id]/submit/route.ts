import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { NextResponse } from "next/server"

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const checklist = await prisma.checklist.findFirst({
    where: { id, organizationId: org.id },
    include: { template: { include: { tasks: true } }, taskLogs: true },
  })
  if (!checklist) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Store-level users must still be able to submit their own checklists —
  // only scope by store assignment, never block completion outright.
  const { isAdmin, storeIds } = await getUserStoreScope()
  if (!isAdmin && !storeIds.includes(checklist.storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const totalTasks = checklist.template.tasks.length
  const completedTasks = checklist.taskLogs.length
  const completionRate = totalTasks > 0 ? completedTasks / totalTasks : 0

  const criticalTasks = checklist.template.tasks.filter((t) => t.isCritical)
  const allCriticalDone = criticalTasks.every((t) => checklist.taskLogs.some((l) => l.taskId === t.id))

  const status = completionRate === 1
    ? "Completed"
    : !allCriticalDone && completionRate < 1
    ? "Non-Compliant"
    : "In Progress"

  await prisma.checklist.update({
    where: { id },
    data: {
      status,
      completionRate,
      completedAt: status === "Completed" ? new Date() : null,
    },
  })

  return NextResponse.json({ status, completionRate })
}
