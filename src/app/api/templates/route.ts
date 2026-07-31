import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth"
import { OPERATIONAL_PHASES, isOperationalPhase, normalizePhase } from "@/lib/phases"

export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try { await requireAdmin() } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }) }

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const templates = await prisma.template.findMany({
    where: { organizationId: org.id },
    include: { tasks: { include: { attachment: true }, orderBy: { orderIndex: "asc" } } },
    orderBy: { createdAt: "asc" },
  })

  return NextResponse.json(templates)
}

export async function PATCH(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try { await requireAdmin() } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }) }

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

  try { await requireAdmin() } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }) }

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const body = await req.json()
  const { tasks, storeIds, ...templateData } = body

  // DEBT-1b: the canonical phase is enforced at every entry point. The one
  // known legacy value is corrected; anything else is rejected by name.
  const operationalPhase = normalizePhase(templateData.operationalPhase)
  if (!isOperationalPhase(operationalPhase)) {
    return NextResponse.json(
      { error: `operationalPhase must be one of: ${OPERATIONAL_PHASES.join(", ")}` },
      { status: 400 }
    )
  }

  const template = await prisma.template.create({
    data: {
      organizationId: org.id,
      name: templateData.name,
      description: templateData.description || null,
      type: templateData.type || "Mid-Shift",
      frequency: templateData.frequency || "Daily",
      availabilityType: templateData.availabilityType || "StoreHours",
      operationalPhase,
      startOffsetHours: templateData.startOffsetHours ?? null,
      endOffsetHours: templateData.endOffsetHours ?? null,
      appliesTo: storeIds?.length ? "selected" : (templateData.appliesTo ?? "all"),
      tasks: {
        create: (tasks ?? []).map((t: {
          sectionName: string; description: string; estimatedTimeMinutes?: number;
          requiresPhoto?: boolean; requiresTemp?: boolean; isCritical?: boolean; orderIndex?: number; excludedStoreIds?: string[]; videoUrl?: string;
        }) => ({
          sectionName: t.sectionName,
          description: t.description,
          estimatedTimeMinutes: t.estimatedTimeMinutes ?? null,
          requiresPhoto: t.requiresPhoto ?? false,
          requiresTemp: t.requiresTemp ?? false,
          isCritical: t.isCritical ?? false,
          orderIndex: t.orderIndex ?? 0,
          excludedStoreIds: t.excludedStoreIds ?? [],
          videoUrl: t.videoUrl || null,
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
