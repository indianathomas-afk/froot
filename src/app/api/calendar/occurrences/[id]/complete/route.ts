import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { calendarDenialBody, calendarDenialStatus, requireCalendar } from "@/lib/calendar-access"

// CAL-1 — COMPLETING AN OCCURRENCE.
//
// ── R1 (Gary, 2026-09-17): THIS ROUTE ASKS NO CAPABILITY, DELIBERATELY ───────
//
// Ruling 5's first half: "Anyone who can complete a checklist at a store can
// complete a reminder at that store." So this mirrors
// api/checklists/[id]/task-log/route.ts EXACTLY — and what that route enforces
// is STORE SCOPE AND NOTHING ELSE. It contains no can() call and does not
// import src/lib/permissions.
//
// `checklists.execute` EXISTS in the registry (permissions.ts, baseline ALL) and
// has ZERO call sites anywhere in this codebase. R1 ruled that it stays that
// way: CAL-1 does not change checklist semantics, and adding the first-ever
// enforcement point for a capability nobody has ruled on is not this phase's to
// do. THE GAP IS FILED as its own roadmap row (the TPL-1 pattern — the control
// exists, the consumer is missing); the PERM track decides.
//
// SO DO NOT "FIX" THIS INTO EXISTENCE. A future reader adding
// can(actor, "checklists.execute") here would be doing the idiomatic thing on
// this page and the wrong thing for this route: it would silently diverge the
// reminder gate from the checklist gate that ruling 5 binds it to.
//
// The MODULE gate still applies — requireCalendar() with no capability argument
// is exactly that, and nothing else.
//
// ── CAL-2: THIS ROUTE IS NOW REMINDERS ONLY ─────────────────────────────────
// A TEMPLATE-BACKED occurrence is refused below (ruling 3) — its completion is
// the checklist's submit, and api/checklists/[id]/submit is the only writer of
// that row's Completed state. Everything above still describes this route
// exactly, for the reminders it still serves.

const bodySchema = z.object({
  notes: z.string().trim().max(2000).nullish(),
  photoUrl: z.string().trim().url().max(2000).nullish(),
  completedByStaffId: z.string().nullish(),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireCalendar()
  if (!access.ok) return NextResponse.json(calendarDenialBody(access.reason), { status: calendarDenialStatus(access.reason) })

  const { id } = await params
  const occurrence = await prisma.calendarOccurrence.findFirst({
    where: { id, organizationId: access.org.id },
    select: {
      id: true,
      storeId: true,
      status: true,
      // CAL-2: what makes this a scheduled checklist rather than a reminder,
      // and where to send the person instead.
      event: { select: { templateId: true } },
      checklist: { select: { id: true } },
    },
  })
  if (!occurrence) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // ── CAL-2, RULING 3 — A TEMPLATE-BACKED OCCURRENCE IS NOT TICKED HERE ───────
  // "Completion of the occurrence IS the checklist's submit; there is no
  // separate tick, and the calendar's Complete control opens the checklist
  // instead." So this route refuses, and the checklist's submit route is the
  // single writer of that occurrence's Completed state.
  //
  // WHY THIS SITS BEFORE THE STORE-SCOPE CHECK: it is a fact about the ROW, not
  // about the actor. Someone with every permission in the product still cannot
  // complete a scheduled checklist here, and telling them "Forbidden" first
  // would send them looking for a capability that was never involved.
  //
  // `checklistId` RIDES IN THE BODY so a client that reached this route anyway
  // — an older tab, a bookmarked request — can send the person somewhere useful
  // rather than just refusing them.
  if (occurrence.event.templateId) {
    return NextResponse.json(
      {
        error: "This is a scheduled checklist. Open the checklist to complete it.",
        checklistId: occurrence.checklist?.id ?? null,
      },
      { status: 409 }
    )
  }

  // THE TASK-LOG GATE, VERBATIM (task-log/route.ts:23-26). Store-level users
  // must still be able to complete their own store's work; an admin is
  // unrestricted.
  const { isAdmin, storeIds, dbUser } = await getUserStoreScope()
  if (!isAdmin && !storeIds.includes(occurrence.storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // 409 ON AN ALREADY-COMPLETED OCCURRENCE. Not 200-and-ignore: two people on
  // the floor tapping Complete within the same minute is the ordinary case, and
  // the second one has to be told the work is already done rather than silently
  // overwriting the first person's attribution and timestamp.
  if (occurrence.status === "Completed") {
    return NextResponse.json({ error: "This reminder has already been completed." }, { status: 409 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.issues }, { status: 400 })
  }
  const body = parsed.data

  // A staff attribution must belong to this org. Never trusted from the client
  // without that check — it is the one id in this body that names a person.
  let completedByStaffId: string | null = null
  if (body.completedByStaffId) {
    const staff = await prisma.staffMember.findFirst({
      where: { id: body.completedByStaffId, organizationId: access.org.id },
      select: { id: true },
    })
    if (!staff) return NextResponse.json({ error: "That staff member is not in this organization" }, { status: 400 })
    completedByStaffId = staff.id
  }

  // updateMany FILTERED ON status: "Open" — the 409 above is the friendly
  // answer, this is the RACE-PROOF one. Two simultaneous requests both pass the
  // read, and exactly one of them updates a row; the loser gets count 0 and the
  // same 409. The CHK-3 idempotence shape: guard in the write, not in the gap
  // between read and write.
  const result = await prisma.calendarOccurrence.updateMany({
    where: { id, organizationId: access.org.id, status: "Open" },
    data: {
      status: "Completed",
      completedAt: new Date(),
      completedByUserId: dbUser?.id ?? null,
      completedByStaffId,
      notes: body.notes ?? null,
      photoUrl: body.photoUrl ?? null,
    },
  })
  if (result.count === 0) {
    return NextResponse.json({ error: "This reminder has already been completed." }, { status: 409 })
  }

  const updated = await prisma.calendarOccurrence.findUnique({ where: { id } })

  // THE NEXT OCCURRENCE IS NOT CREATED HERE (ruling 3). The cron materialises
  // it on its next run, from nextDueDate() against this row's dueDate — one
  // author for every occurrence write, so "one open occurrence per event per
  // store" has one place to be enforced.
  return NextResponse.json(updated)
}
