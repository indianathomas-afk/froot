import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const template = await prisma.template.findFirst({ where: { id, organizationId: org.id } })
  if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await req.json()

  // Quick status-only update (archive / activate)
  if ("isActive" in body && !("tasks" in body)) {
    const updated = await prisma.template.update({ where: { id }, data: { isActive: body.isActive } })
    return NextResponse.json(updated)
  }
  if ("isArchived" in body && !("tasks" in body)) {
    const updated = await prisma.template.update({ where: { id }, data: { isArchived: body.isArchived } })
    return NextResponse.json(updated)
  }

  type IncomingTask = {
    id?: string; sectionName: string; description: string; estimatedTimeMinutes?: number | null;
    requiresPhoto?: boolean; requiresTemp?: boolean; isCritical?: boolean; orderIndex?: number; excludedStoreIds?: string[]; videoUrl?: string | null;
  }
  const { tasks, storeIds, appliesTo, ...templateData } = body
  const incomingTasks: IncomingTask[] = Array.isArray(tasks) ? tasks : []

  try {
    const existingTaskIds = new Set(
      (await prisma.task.findMany({ where: { templateId: id }, select: { id: true } })).map((t) => t.id)
    )
    const incomingIds = new Set(incomingTasks.map((t) => t.id).filter((tid): tid is string => !!tid && existingTaskIds.has(tid)))
    const idsToDelete = [...existingTaskIds].filter((tid) => !incomingIds.has(tid))

    // Tasks with completion history (TaskLog) can't be deleted (RESTRICT FK) — leave them in place.
    const blockedIds = new Set(
      idsToDelete.length
        ? (await prisma.taskLog.findMany({ where: { taskId: { in: idsToDelete } }, select: { taskId: true }, distinct: ["taskId"] })).map((l) => l.taskId)
        : []
    )
    const safeToDelete = idsToDelete.filter((tid) => !blockedIds.has(tid))

    const toUpdate = incomingTasks.filter((t) => t.id && existingTaskIds.has(t.id))
    const toCreate = incomingTasks.filter((t) => !t.id || !existingTaskIds.has(t.id))

    const taskData = (t: IncomingTask) => ({
      sectionName: t.sectionName,
      description: t.description,
      estimatedTimeMinutes: t.estimatedTimeMinutes != null ? Math.round(t.estimatedTimeMinutes) : null,
      requiresPhoto: t.requiresPhoto ?? false,
      requiresTemp: t.requiresTemp ?? false,
      isCritical: t.isCritical ?? false,
      orderIndex: t.orderIndex ?? 0,
      excludedStoreIds: t.excludedStoreIds ?? [],
      videoUrl: t.videoUrl || null,
    })

    const updated = await prisma.$transaction(async (tx) => {
      if (safeToDelete.length) {
        await tx.task.deleteMany({ where: { id: { in: safeToDelete } } })
      }
      for (const t of toUpdate) {
        await tx.task.update({ where: { id: t.id! }, data: taskData(t) })
      }
      await tx.templateStoreAssignment.deleteMany({ where: { templateId: id } })

      return tx.template.update({
        where: { id },
        data: {
          ...templateData,
          appliesTo: appliesTo ?? "all",
          tasks: toCreate.length ? { create: toCreate.map(taskData) } : undefined,
          storeAssignments: storeIds?.length
            ? { create: (storeIds as string[]).map((sid: string) => ({ storeId: sid })) }
            : undefined,
        },
        include: { tasks: true, storeAssignments: true },
      })
    })

    return NextResponse.json(updated)
  } catch (err) {
    console.error("Failed to update template", err)
    return NextResponse.json({ error: "Failed to save template" }, { status: 500 })
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const template = await prisma.template.findFirst({ where: { id, organizationId: org.id } })
  if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.template.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
