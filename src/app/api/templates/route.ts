import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { denyUnlessTemplatesManage } from "./access"
import { resolveTemplateType } from "./template-type"
import { NextResponse } from "next/server"
import { OPERATIONAL_PHASES, isOperationalPhase, normalizePhase } from "@/lib/phases"

export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const denied = await denyUnlessTemplatesManage()
  if (denied) return denied

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const templates = await prisma.template.findMany({
    where: { organizationId: org.id },
    include: {
      tasks: { include: { attachment: true }, orderBy: { orderIndex: "asc" } },
      // TPL-1b: the badge reads its colour from the joined row rather than from
      // a hardcoded map. Joined per-template rather than resolved client-side
      // against /api/template-types, so it is authoritative for the row, does
      // not depend on fetch ordering, and survives a type being made inactive
      // (which that endpoint filters out). A null here — a CSV import from the
      // TPL-1a window — falls back to the legacy string in neutral grey.
      templateType: { select: { id: true, name: true, colorKey: true } },
    },
    orderBy: { createdAt: "asc" },
  })

  return NextResponse.json(templates)
}

export async function PATCH(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const denied = await denyUnlessTemplatesManage()
  if (denied) return denied

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

  const denied = await denyUnlessTemplatesManage()
  if (denied) return denied

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const body = await req.json()
  const { tasks, storeIds, ...templateData } = body

  // DEBT-2b: sectionName is DELIBERATELY free text — no enum, no canonical
  // list (docs/DEBT-2_AUDIT.md §6; this is where DEBT-2 parts company with
  // DEBT-1 and src/lib/phases.ts). The column is NOT NULL, so blank is the only
  // thing to reject. Checked here because this route is one of the two choke
  // points every client-side writer funnels through.
  const incomingTasks = (tasks ?? []) as { sectionName?: string }[]
  if (incomingTasks.some((t) => !(t.sectionName ?? "").trim())) {
    return NextResponse.json({ error: "Every task needs a non-empty sectionName" }, { status: 400 })
  }

  // DEBT-1b: the canonical phase is enforced at every entry point. The one
  // known legacy value is corrected; anything else is rejected by name.
  const operationalPhase = normalizePhase(templateData.operationalPhase)
  if (!isOperationalPhase(operationalPhase)) {
    return NextResponse.json(
      { error: `operationalPhase must be one of: ${OPERATIONAL_PHASES.join(", ")}` },
      { status: 400 }
    )
  }

  // TPL-1a: was `type: templateData.type || "Mid-Shift"`. The default is GONE —
  // it is what stamped "Mid-Shift" on every template the Create form made, and
  // removing it without the form's Type select would have turned creation into
  // a NOT NULL violation, which is why the two ship together.
  const resolved = await resolveTemplateType(org.id, templateData.typeId)
  if (!resolved.ok) return resolved.response

  const template = await prisma.template.create({
    data: {
      organizationId: org.id,
      name: templateData.name,
      description: templateData.description || null,
      // Both columns, always — the legacy string is what the six read sites and
      // the CSV export still read. Written from the resolved row's name, never
      // from the client's `type`, so the two cannot disagree.
      typeId: resolved.type.id,
      type: resolved.type.name,
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
          sectionName: t.sectionName.trim(),
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
