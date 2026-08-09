import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { NextResponse } from "next/server"

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const checklist = await prisma.checklist.findFirst({ where: { id, organizationId: org.id } })
  if (!checklist) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Store-level users must still be able to execute their own checklists —
  // only scope by store assignment, never block completion outright.
  const { isAdmin, storeIds } = await getUserStoreScope()
  if (!isAdmin && !storeIds.includes(checklist.storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { taskId, photoUrl, temperatureValue, notes, completedByStaffId } = await req.json()

  // Update checklist to In Progress if Pending
  if (checklist.status === "Pending") {
    // CHK-1 — THE AS-EXECUTED FREEZE. DEBT-36's whole complaint is that a
    // section rename retroactively rewrites the headings on every historical
    // checklist; this is the write that ends it.
    //
    // FROZEN HERE — at the FIRST TASK LOG — and never rewritten (Gary,
    // 2026-08-09; plan §2.4). Not at completion and not at day close: a
    // checklist completed at 10am, renamed at 2pm and closed at 11pm would
    // otherwise snapshot the 2pm name, which is the same defect with a step in
    // front of it. The headings a checklist was executed under are the headings
    // it STARTED under.
    //
    // NAMES ONLY. Task descriptions and task additions still resolve live at
    // print time — knowingly out of scope, filed as its own row, and stated on
    // Checklist.sectionsSnapshot in prisma/schema.prisma.
    //
    // The `sectionsSnapshot == null` guard is what makes "once" true rather
    // than intended: a row that somehow returns to Pending keeps the snapshot
    // it already has. Reading it back is src/lib/sections.ts's job.
    const sections = await prisma.section.findMany({
      where: { templateId: checklist.templateId },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, sortOrder: true },
    })
    await prisma.checklist.update({
      where: { id },
      data: {
        status: "In Progress",
        startedAt: new Date(),
        ...(checklist.sectionsSnapshot === null
          ? { sectionsSnapshot: sections.map((s) => ({ sectionId: s.id, name: s.name, sortOrder: s.sortOrder })) }
          : {}),
      },
    })
  }

  // Find user record
  const user = userId
    ? await prisma.user.findFirst({ where: { clerkUserId: userId, organizationId: org.id } })
    : null

  // Upsert task log (toggle: delete if exists, create if not)
  const existing = await prisma.taskLog.findFirst({ where: { checklistId: id, taskId } })
  if (existing) {
    await prisma.taskLog.delete({ where: { id: existing.id } })
    return NextResponse.json({ action: "uncompleted" })
  }

  // completedByStaffId may be "manager" (generic label) — only store real DB IDs
  const staffId = completedByStaffId && completedByStaffId !== "manager" ? completedByStaffId : null

  // CHK-1: stamp the section the task belongs to. An ID, not a name — the name
  // is in the snapshot above, in one place (DEBT-26's discipline; see the
  // TaskLog comment in prisma/schema.prisma). Deliberately a lookup and NOT a
  // validation: this route has never checked that `taskId` belongs to this
  // checklist's template, and adding that refusal is not CHK-1's business.
  const loggedTask = await prisma.task.findUnique({ where: { id: taskId }, select: { sectionId: true } })

  await prisma.taskLog.create({
    data: {
      checklistId: id,
      taskId,
      sectionId: loggedTask?.sectionId ?? null,
      completedByUserId: user?.id ?? null,
      completedByStaffId: staffId,
      photoUrl: photoUrl ?? null,
      temperatureValue: temperatureValue ?? null,
      notes: notes ?? null,
    },
  })

  return NextResponse.json({ action: "completed" })
}
