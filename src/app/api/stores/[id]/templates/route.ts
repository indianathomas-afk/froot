import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { businessDayWindow } from "@/lib/reports"
import { NextResponse } from "next/server"

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: storeId } = await params
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const store = await prisma.store.findFirst({ where: { id: storeId, organizationId: org.id } })
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  const { isAdmin, storeIds } = await getUserStoreScope()
  if (!isAdmin && !storeIds.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const templates = await prisma.template.findMany({
    where: { organizationId: org.id, isActive: true, isArchived: false },
    include: {
      tasks: true,
      storeAssignments: true,
    },
    orderBy: { name: "asc" },
  })

  // Filter: "all" → show for every store; "selected" → only if this store is in storeAssignments
  const applicable = templates.filter((t) => {
    if (t.appliesTo === "selected") {
      return t.storeAssignments.some((a) => a.storeId === storeId)
    }
    return true // "all" or legacy rows with no appliesTo set
  })

  // Check which ones already have a checklist started today — "today" is the
  // store's local business day, not the server (UTC) day.
  const w = businessDayWindow(new Date(), store.timezone)

  const existingToday = await prisma.checklist.findMany({
    where: {
      organizationId: org.id,
      storeId,
      date: { gte: w.gte, lt: w.lt },
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
