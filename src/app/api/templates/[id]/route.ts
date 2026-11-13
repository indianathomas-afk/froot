import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { denyUnlessTemplatesManage } from "../access"
import { archiveCalendarEventsForTemplates } from "../archive-cascade"
import { TEMPLATE_HAS_HISTORY_MESSAGE, deleteTemplateUnlessHistory } from "../history"
import { resolveTemplateType } from "../template-type"
import { SectionConflict, pruneEmptySections, sectionsFromTasks, syncTemplateSections, type IncomingSection } from "../sections"
import { syncTemplateTasks } from "../task-sync"
import { NextResponse } from "next/server"
import { OPERATIONAL_PHASES, isOperationalPhase, normalizePhase } from "@/lib/phases"
import { storedTaskVideoUrl, taskVideoUrlRefusal } from "@/lib/task-video-url"

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
  //
  // ── CAL-2, R4: DEACTIVATE IS THE REVERSIBLE HALF AND WRITES ONE COLUMN ──────
  // Nothing is archived and nothing is deleted. The calendar's materialise cron
  // checks the template's isActive on every run and skips its events, counting
  // `skippedInactiveTemplate`; REACTIVATING RESUMES GENERATION on the next run
  // with the event, its schedule and its completion history all intact. This
  // branch is deliberately untouched by CAL-2 — the whole behaviour lives in
  // the reader, so there is nothing here to keep in sync.
  if ("isActive" in body && !("tasks" in body)) {
    const updated = await prisma.template.update({ where: { id }, data: { isActive: body.isActive } })
    return NextResponse.json(updated)
  }
  if ("isArchived" in body && !("tasks" in body)) {
    // ── CAL-2, RULING 6 AS REWORDED BY R4 (Gary, 2026-09-18) — ARCHIVE IS THE
    // TERMINAL HALF, AND IT CASCADES ONTO THE CALENDAR ──────────────────────
    // Archiving a template ARCHIVES ITS EVENTS and deletes their Open
    // occurrences. Deactivating one does NOT come through here at all — that is
    // the `isActive` branch above, it is REVERSIBLE, and the materialise cron
    // simply skips an inactive template's events and reports
    // `skippedInactiveTemplate`. Two controls, two behaviours, and the
    // difference is deliberate.
    //
    // ASYMMETRIC ON PURPOSE, IN BOTH DIRECTIONS:
    //  - Archiving a template-backed EVENT never archives the template. An
    //    operator deciding "stop scheduling this" has not decided "retire this
    //    template", and the calendar must not make that decision for them.
    //  - UN-ARCHIVING A TEMPLATE DOES NOT UN-ARCHIVE ITS EVENTS. The Open
    //    occurrences are already gone and cannot be un-deleted, so restoring
    //    the events would restore a schedule with a hole in it. The archive was
    //    a decision; reversing it is re-adding the template to the calendar.
    //
    // COMPLETED OCCURRENCES ARE NEVER TOUCHED, and neither are the Checklists
    // any of them created — the same rule DELETE /api/calendar/events/[id]
    // already follows. They record work that happened, and archiving a
    // definition cannot unmake it.
    //
    // CAL-2b: the cascade now READS before it deletes (it has to ask whether
    // each Open occurrence's checklist was started), so this is an interactive
    // transaction rather than an array of promises. The counts come back so the
    // caller — and a staging run — can see what the archive actually did.
    if (body.isArchived === true) {
      const { updated, cascade } = await prisma.$transaction(async (tx) => {
        const row = await tx.template.update({ where: { id }, data: { isArchived: true } })
        return { updated: row, cascade: await archiveCalendarEventsForTemplates(tx, org.id, [id]) }
      })
      return NextResponse.json({ ...updated, cascade })
    }

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

  // CHK-20: the second choke point for the training-video rule — see the same
  // check in POST /api/templates. A task loaded with a bad value saved before
  // CHK-20 is refused here too until it is fixed; the editor names it first.
  const videoRefusal = taskVideoUrlRefusal(incomingTasks)
  if (videoRefusal) {
    return NextResponse.json({ error: videoRefusal }, { status: 400 })
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
    // TPL-3: the delete / retire / update / create diff lives in
    // api/templates/task-sync.ts, where scripts/verify-tpl3.ts can run it. It
    // replaced a silent skip — see that file's header.
    //
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
        // CHK-20: checked above; a bare www. address is stored with https://.
        videoUrl: storedTaskVideoUrl(t.videoUrl),
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Sections FIRST: renames must land before any task is stamped, or a
      // renamed section resolves to nothing and every task in it goes null.
      const synced = await syncTemplateSections(tx, id, incomingSections)
      if (!synced.ok) throw new SectionConflict(synced.error)

      const { retired, deleted } = await syncTemplateTasks(tx, id, incomingTasks, (t) => taskData(t, synced.byName))
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
          // TPL-3: new tasks are created by syncTemplateTasks above.
          storeAssignments: storeIds?.length
            ? { create: (storeIds as string[]).map((sid: string) => ({ storeId: sid })) }
            : undefined,
        },
      })

      // LAST, and after every task write: a section is only empty once the
      // tasks have moved off it. See api/templates/sections.ts.
      await pruneEmptySections(tx, id)

      const row = await tx.template.findUniqueOrThrow({
        where: { id },
        // CHK-1: `orderBy` is NEW. The form maps pending attachments onto
        // `response.tasks[idx]` by position (template-form.tsx handleSave) and
        // this include had no ordering at all, so that mapping held by luck.
        //
        // TPL-3: and LIVE ONLY. The previously-skipped tasks kept their old
        // orderIndex and sorted into the middle of this list, shifting every
        // position after them. The form now matches by orderIndex as well.
        include: {
          tasks: { where: { retiredAt: null }, include: { attachment: true }, orderBy: { orderIndex: "asc" } },
          sections: { orderBy: { sortOrder: "asc" } },
          storeAssignments: true,
        },
      })
      return { row, retired, deleted }
    })

    return NextResponse.json({ ...updated.row, retiredCount: updated.retired, deletedCount: updated.deleted })
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

  // BUG-23 (R3, R4): no history → hard delete, as before. History → 409 with
  // the archive instruction; the form shows `error` verbatim. The FK-violation
  // catch (P2003, or the adapter's raw 23001 — see history.ts) lives in
  // deleteTemplateUnlessHistory(), so a missed FK is a 409, never a 500. Anything else is still a 500, logged.
  try {
    const result = await deleteTemplateUnlessHistory(id)
    if (!result.ok) return NextResponse.json({ error: TEMPLATE_HAS_HISTORY_MESSAGE }, { status: 409 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("Failed to delete template", err)
    return NextResponse.json({ error: "Failed to delete template" }, { status: 500 })
  }
}
