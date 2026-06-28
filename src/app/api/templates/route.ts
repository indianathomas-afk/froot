import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"

export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const templates = await prisma.template.findMany({
    where: { organizationId: org.id },
    include: { tasks: { orderBy: { orderIndex: "asc" } } },
    orderBy: { createdAt: "asc" },
  })

  return NextResponse.json(templates)
}

export async function PATCH(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const { ids, isActive, isArchived } = await req.json()
  if (!Array.isArray(ids)) return NextResponse.json({ error: "ids required" }, { status: 400 })

  const data: { isActive?: boolean; isArchived?: boolean } = {}
  if (isActive !== undefined) data.isActive = isActive
  if (isArchived !== undefined) data.isArchived = isArchived

  await prisma.template.updateMany({
    where: { id: { in: ids }, organizationId: org.id },
    data,
  })

  return NextResponse.json({ ok: true })
}

export async function POST(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const body = await req.json()
  const { tasks, storeIds, ...templateData } = body

  const template = await prisma.template.create({
    data: {
      organizationId: org.id,
      name: templateData.name,
      description: templateData.description || null,
      type: templateData.type || "Mid-Shift",
      frequency: templateData.frequency || "Daily",
      availabilityType: templateData.availabilityType || "StoreHours",
      operationalPhase: templateData.operationalPhase || null,
      startOffsetHours: templateData.startOffsetHours ?? null,
      endOffsetHours: templateData.endOffsetHours ?? null,
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

  return NextResponse.json(template, { status: 201 })
}
