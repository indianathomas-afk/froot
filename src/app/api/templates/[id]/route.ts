import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { denyUnlessTemplatesManage } from "../access"
import { resolveTemplateType } from "../template-type"
import { NextResponse } from "next/server"
import { OPERATIONAL_PHASES, isOperationalPhase, normalizePhase } from "@/lib/phases"

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const denied = await denyUnlessTemplatesManage()
  if (denied) return denied

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
  // TPL-1a: `type` and `typeId` are pulled OUT of templateData deliberately, so
  // the wholesale spread below cannot carry either of them to the DB. They are
  // written back explicitly from the resolved row. Before this row the spread
  // wrote `type` unvalidated and with no default — a body carrying `type: ""`
  // put an empty string in a NOT NULL column, and after this row an unresolved
  // typeId would have been a cross-tenant write. See
  // docs/prompts/TYPE-1_AUDIT.md §2.2 and api/templates/template-type.ts.
  const { tasks, storeIds, appliesTo, type: _clientType, typeId, ...templateData } = body
  void _clientType
  const incomingTasks: IncomingTask[] = Array.isArray(tasks) ? tasks : []

  // DEBT-2b: sectionName is DELIBERATELY free text — no enum, no canonical
  // list (docs/DEBT-2_AUDIT.md §6). The column is NOT NULL, so blank is the
  // only thing to reject. This is the second of the two choke points.
  if (incomingTasks.some((t) => !(t.sectionName ?? "").trim())) {
    return NextResponse.json({ error: "Every task needs a non-empty sectionName" }, { status: 400 })
  }

  // DEBT-1b: templateData is spread wholesale into the update below, so the
  // phase is validated here or not at all. The one known legacy value is
  // corrected; anything else is rejected by name.
  //
  // DEBT-29: the same spread carries startOffsetHours and endOffsetHours to the
  // DB on every template edit, unvalidated — and because this route never names
  // them, a repo-wide grep for either field does not return this file. Any audit
  // of the write paths for those columns will miss this one unless it reads the
  // spread. POST /api/templates is the only write site the grep does find.
  if ("operationalPhase" in templateData) {
    const phase = normalizePhase(templateData.operationalPhase)
    if (!isOperationalPhase(phase)) {
      return NextResponse.json(
        { error: `operationalPhase must be one of: ${OPERATIONAL_PHASES.join(", ")}` },
        { status: 400 }
      )
    }
    templateData.operationalPhase = phase
  }

  // TPL-1a: resolved BEFORE the transaction and before the spread, org-scoped.
  // Same 400 shape as the phase rejection above — no silent default on this
  // path either.
  const resolved = await resolveTemplateType(org.id, typeId)
  if (!resolved.ok) return resolved.response

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
      sectionName: t.sectionName.trim(),
      description: t.description,
      estimatedTimeMinutes: t.estimatedTimeMinutes ?? null,
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
          // After the spread, so a stray key in templateData cannot win.
          typeId: resolved.type.id,
          type: resolved.type.name,
          appliesTo: appliesTo ?? "all",
          tasks: toCreate.length ? { create: toCreate.map(taskData) } : undefined,
          storeAssignments: storeIds?.length
            ? { create: (storeIds as string[]).map((sid: string) => ({ storeId: sid })) }
            : undefined,
        },
        include: { tasks: { include: { attachment: true } }, storeAssignments: true },
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

  const denied = await denyUnlessTemplatesManage()
  if (denied) return denied

  const { id } = await params
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const template = await prisma.template.findFirst({ where: { id, organizationId: org.id } })
  if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.template.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
