import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { isLateCompletion } from "@/lib/checklist-lifecycle"
import { NextResponse } from "next/server"

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const checklist = await prisma.checklist.findFirst({
    where: { id, organizationId: org.id },
    include: { template: { include: { tasks: true } }, taskLogs: true },
  })
  if (!checklist) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Store-level users must still be able to submit their own checklists —
  // only scope by store assignment, never block completion outright.
  const { isAdmin, storeIds } = await getUserStoreScope()
  if (!isAdmin && !storeIds.includes(checklist.storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // CHK-3. 409 ON A CLOSED CHECKLIST — the only new refusal this phase adds, and
  // the first date-sensitive gate this route has ever had. Day close makes
  // Missed a CLOSED FACT (Gary's R1): "closed, not actionable". `closedAt` is
  // only ever set on a row the cron did not find Completed, so this cannot
  // refuse a completed checklist.
  if (checklist.closedAt != null && checklist.status !== "Completed") {
    return NextResponse.json(
      { error: "This checklist's day has closed and it was recorded as missed. It can no longer be submitted." },
      { status: 409 }
    )
  }

  // CHK-3 — THE COUNTING FIX (the S1 integrity finding, parked on the CHK-3 row
  // and fixed here because this is the line that was wrong).
  //
  // This WAS `completedTasks = checklist.taskLogs.length` — RAW LOG ROWS,
  // counted against `template.tasks.length`. Paired with a task-log route that
  // never checked `taskId` belongs to this checklist's template, logging task
  // ids from ANOTHER template inflated completionRate and could flip a checklist
  // to Completed without any of its own tasks being done. Not reachable through
  // the UI — it needed a hand-crafted request — but it is an integrity hole in
  // the exact record CHK-1 exists to protect.
  //
  // Now: DISTINCT task ids, and only ones belonging to this template. Distinct
  // matters independently of the other half — the toggle in task-log is a
  // delete-or-create, so a duplicate row is not reachable today either, and
  // counting a set costs nothing and stops depending on that.
  // The other end of the fix is the ownership check in
  // api/checklists/[id]/task-log/route.ts; the day-close job counts the same way.
  const templateTaskIds = new Set(checklist.template.tasks.map((t) => t.id))
  const doneTaskIds = new Set(
    checklist.taskLogs.filter((l) => templateTaskIds.has(l.taskId)).map((l) => l.taskId)
  )
  const totalTasks = templateTaskIds.size
  const completedTasks = doneTaskIds.size
  const completionRate = totalTasks > 0 ? completedTasks / totalTasks : 0

  const criticalTasks = checklist.template.tasks.filter((t) => t.isCritical)
  const allCriticalDone = criticalTasks.every((t) => doneTaskIds.has(t.id))

  const status = completionRate === 1
    ? "Completed"
    : !allCriticalDone && completionRate < 1
    ? "Non-Compliant"
    : "In Progress"

  // CHK-3. COMPLETED-LATE IS WRITTEN, not derived — R1's "closed fact" half,
  // and submit is its only writer. Judged against the window FROZEN ON THIS ROW
  // at create, never against the template's offsets as they stand now, so
  // editing an offset tomorrow cannot make today's late completion look
  // on-time. A row with no `expectedEndAt` recorded no expectation and is never
  // late; the predicate is isLateCompletion() in src/lib/checklist-lifecycle.ts.
  //
  // Written on every submit rather than once, so the flag and the status cannot
  // disagree: un-toggling a task drops the row out of Completed, and it must
  // drop out of completed-late with it.
  const completedAt = status === "Completed" ? new Date() : null
  const completedLate = completedAt != null && isLateCompletion(checklist.expectedEndAt, completedAt)

  await prisma.checklist.update({
    where: { id },
    data: {
      status,
      completionRate,
      completedAt,
      completedLate,
    },
  })

  return NextResponse.json({ status, completionRate, completedLate })
}
