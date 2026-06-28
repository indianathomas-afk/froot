import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: storeId } = await params
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const store = await prisma.store.findFirst({ where: { id: storeId, organizationId: org.id } })
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  const templates = await prisma.template.findMany({
    where: { organizationId: org.id, isActive: true, isArchived: false },
    include: {
      tasks: true,
      storeAssignments: true,
    },
    orderBy: { name: "asc" },
  })

  // Filter: if template has storeAssignments, only include if this store is assigned
  const applicable = templates.filter((t) =>
    t.storeAssignments.length === 0 || t.storeAssignments.some((a) => a.storeId === storeId)
  )

  // Check which ones already have a checklist started today
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const existingToday = await prisma.checklist.findMany({
    where: {
      organizationId: org.id,
      storeId,
      date: { gte: today, lt: tomorrow },
    },
    select: { id: true, templateId: true, status: true },
  })

  const existingMap = new Map(existingToday.map((c) => [c.templateId, c]))

  const result = applicable.map((t) => {
    const existing = existingMap.get(t.id)
    return {
      id: t.id,
      name: t.name,
      type: t.type,
      taskCount: t.tasks.length,
      estimatedMinutes: t.tasks.reduce((sum, task) => sum + (task.estimatedTimeMinutes ?? 0), 0),
      existingChecklistId: existing?.id ?? null,
      existingStatus: existing?.status ?? null,
    }
  })

  return NextResponse.json(result)
}
