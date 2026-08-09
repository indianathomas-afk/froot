import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { denyUnlessTemplatesManage } from "../access"
import { resolveTemplateType } from "../template-type"
import { SectionConflict, pruneEmptySections, sectionsFromTasks, syncTemplateSections, type IncomingSection } from "../sections"
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
  //
  // TPL-2 step (1) MADE THIS DESTRUCTURE MORE LOAD-BEARING, NOT LESS. It is now
  // the only thing standing between a client-supplied `type` and the column,
  // because the explicit write below it is gone — so removing `type:
  // _clientType` would not merely restore the old behaviour, it would hand the
  // legacy string to whatever the caller sent.
  const { tasks, sections, storeIds, appliesTo, type: _clientType, typeId, ...templateData } = body
  void _clientType
  const incomingTasks: IncomingTask[] = Array.isArray(tasks) ? tasks : []

  // CHK-1. `sections` carries the SECTION IDS, and that is what makes a rename
  // a rename rather than a create-plus-strand: an entry with an id updates that
  // row's name, so every Task and every TaskLog pointing at it follows without
  // moving. See api/templates/sections.ts.
  //
  // Absent — an older client, or any caller that only knows about task strings
  // — the list is recovered from the tasks by MIN(orderIndex), the migration's
  // rule. Renames are then indistinguishable from "a new section with this
  // name", which is the pre-CHK-1 behaviour and is why the form sends the list.
  const incomingSections: IncomingSection[] = Array.isArray(sections) && sections.length
    ? (sections as IncomingSection[])
    : sectionsFromTasks(incomingTasks)

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

    // CHK-1: `sectionId` alongside `sectionName` on every task write. The
    // string is the legacy mirror and stays written (TPL-1a's shape); the id is
    // what the read sites join on.
    const taskData = (t: IncomingTask, byName: Map<string, string>) => {
      const sectionName = t.sectionName.trim()
      return {
        sectionName,
        sectionId: byName.get(sectionName) ?? null,
        description: t.description,
        estimatedTimeMinutes: t.estimatedTimeMinutes ?? null,
        requiresPhoto: t.requiresPhoto ?? false,
        requiresTemp: t.requiresTemp ?? false,
        isCritical: t.isCritical ?? false,
        orderIndex: t.orderIndex ?? 0,
        excludedStoreIds: t.excludedStoreIds ?? [],
        videoUrl: t.videoUrl || null,
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Sections FIRST: renames must land before any task is stamped, or a
      // renamed section resolves to nothing and every task in it goes null.
      const synced = await syncTemplateSections(tx, id, incomingSections)
      if (!synced.ok) throw new SectionConflict(synced.error)

      if (safeToDelete.length) {
        await tx.task.deleteMany({ where: { id: { in: safeToDelete } } })
      }
      for (const t of toUpdate) {
        await tx.task.update({ where: { id: t.id! }, data: taskData(t, synced.byName) })
      }
      await tx.templateStoreAssignment.deleteMany({ where: { templateId: id } })

      await tx.template.update({
        where: { id },
        data: {
          ...templateData,
          // After the spread, so a stray key in templateData cannot win.
          //
          // TPL-2 step (1): `type: resolved.type.name` STOOD HERE AND IS GONE.
          // Changing a template's type now moves typeId alone, so this row's
          // legacy string keeps whatever name it had at insert. Nothing reads
          // it — every site resolves through templateType and falls back to the
          // string only when typeId is null, which cannot be the case on a row
          // this handler just resolved a type for.
          typeId: resolved.type.id,
          appliesTo: appliesTo ?? "all",
          tasks: toCreate.length ? { create: toCreate.map((t) => taskData(t, synced.byName)) } : undefined,
          storeAssignments: storeIds?.length
            ? { create: (storeIds as string[]).map((sid: string) => ({ storeId: sid })) }
            : undefined,
        },
      })

      // LAST, and after every task write: a section is only empty once the
      // tasks have moved off it. See api/templates/sections.ts.
      await pruneEmptySections(tx, id)

      return tx.template.findUniqueOrThrow({
        where: { id },
        // CHK-1: `orderBy` is NEW. The form maps pending attachments onto
        // `response.tasks[idx]` by position (template-form.tsx handleSave) and
        // this include had no ordering at all, so that mapping held by luck.
        include: {
          tasks: { include: { attachment: true }, orderBy: { orderIndex: "asc" } },
          sections: { orderBy: { sortOrder: "asc" } },
          storeAssignments: true,
        },
      })
    })

    return NextResponse.json(updated)
  } catch (err) {
    if (err instanceof SectionConflict) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
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
