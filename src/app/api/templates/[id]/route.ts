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

  const { tasks, storeIds, appliesTo, ...templateData } = body

  await prisma.task.deleteMany({ where: { templateId: id } })
  await prisma.templateStoreAssignment.deleteMany({ where: { templateId: id } })

  const updated = await prisma.template.update({
    where: { id },
    data: {
      ...templateData,
      appliesTo: appliesTo ?? "all",
      tasks: {
        create: (tasks ?? []).map((t: {
          sectionName: string; description: string; estimatedTimeMinutes?: number;
          requiresPhoto?: boolean; requiresTemp?: boolean; isCritical?: boolean; orderIndex?: number; excludedStoreIds?: string[];
        }) => ({
          sectionName: t.sectionName,
          description: t.description,
          estimatedTimeMinutes: t.estimatedTimeMinutes ?? null,
          requiresPhoto: t.requiresPhoto ?? false,
          requiresTemp: t.requiresTemp ?? false,
          isCritical: t.isCritical ?? false,
          orderIndex: t.orderIndex ?? 0,
          excludedStoreIds: t.excludedStoreIds ?? [],
        })),
      },
      storeAssignments: storeIds?.length
        ? { create: (storeIds as string[]).map((sid: string) => ({ storeId: sid })) }
        : undefined,
    },
    include: { tasks: true, storeAssignments: true },
  })

  return NextResponse.json(updated)
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
