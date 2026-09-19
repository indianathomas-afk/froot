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
    // CAL-2: the occurrence joins so this route can both REFUSE on it (R3) and
    // PROPAGATE to it below. One load, one round trip.
    include: {
      template: { include: { tasks: true } },
      taskLogs: true,
      calendarOccurrence: { select: { id: true, status: true } },
    },
  })
  if (!checklist) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Store-level users must still be able to submit their own checklists —
  // only scope by store assignment, never block completion outright.
  // CAL-2: `dbUser` joins the destructure — it is the R2 attribution for a
  // template-backed occurrence below. One call, not two.
  const { isAdmin, storeIds, dbUser } = await getUserStoreScope()
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

  // ── CAL-2, R3 (Gary, 2026-09-18) — A COMPLETED OCCURRENCE IS A CLOSED FACT,
  // THE SAME WAY A CLOSED DAY IS ───────────────────────────────────────────────
  // THE DEFECT THIS PREVENTS, stated plainly because it is reachable by an
  // ordinary operator action and not by any edge case: this route RECOMPUTES
  // status on every call and can move a checklist OUT of Completed — the block
  // below says so in its own words ("un-toggling a task drops the row out of
  // Completed"). Without this guard the sequence is:
  //
  //   submit → Completed → occurrence Completed → the hourly cron materialises
  //   the NEXT occurrence → somebody un-ticks one task → submit again →
  //   checklist is In Progress behind a Completed occurrence, with a second
  //   occurrence already open.
  //
  // That breaks ruling 3's "one open occurrence per event per store at a time"
  // by hand, silently, with no error anywhere. So the occurrence's completion
  // is ONE-WAY, and this is where that is enforced.
  //
  // THE SHAPE IS THE CLOSED-DAY GUARD'S, ON PURPOSE — same 409, same "this is a
  // fact about the row, not about you" framing, and a surface that already
  // knows how to render that refusal.
  if (checklist.calendarOccurrence?.status === "Completed") {
    return NextResponse.json(
      { error: "This scheduled checklist has already been submitted." },
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

  // ── CAL-2, RULING 3 — COMPLETION OF THE OCCURRENCE *IS* THE CHECKLIST'S
  // SUBMIT ─────────────────────────────────────────────────────────────────────
  // There is no separate tick anywhere: the calendar's Complete control opens
  // this checklist instead, and POST /api/calendar/occurrences/[id]/complete
  // refuses a template-backed row outright. So this statement is the ONLY way a
  // template-backed occurrence is ever marked Completed by a person.
  //
  // THE ACTOR COMES FROM THIS SESSION (Gary, R2 2026-09-18). Checklist has no
  // completedBy column of any kind — attribution lives on TaskLog rows — so
  // there is nothing on the source row to copy, and the person who pressed
  // Submit is both the honest answer and the same one the reminder path writes
  // (api/calendar/occurrences/[id]/complete). `completedByStaffId` stays null:
  // submit has no staff-selection surface, and inventing one here would be a
  // product decision this phase was not asked to make.
  //
  // ONLY "Completed" PROPAGATES. Non-Compliant and In Progress leave the
  // occurrence Open, and day close decides it — which is ruling 4, and which is
  // what makes a partially-done scheduled checklist a MISS rather than a
  // half-completion the calendar would have to invent a state for.
  //
  // updateMany FILTERED ON status: "Open" is the race-proof half; the 409 above
  // is the friendly one. Two submits in the same second both pass the read and
  // exactly one writes.
  if (status === "Completed" && checklist.calendarOccurrenceId) {
    await prisma.calendarOccurrence.updateMany({
      where: { id: checklist.calendarOccurrenceId, status: "Open" },
      data: {
        status: "Completed",
        // The SAME instant written to Checklist.completedAt above, not a second
        // `new Date()` — one event, one time, no drift between two records of it.
        completedAt,
        completedByUserId: dbUser?.id ?? null,
      },
    })
  }

  return NextResponse.json({ status, completionRate, completedLate })
}
