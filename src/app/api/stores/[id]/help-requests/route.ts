import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, getUserStoreScope } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { sendHelpEmail } from "@/lib/help-request-send"
import {
  HELP_MESSAGE_TYPE,
  HELP_NOTE_MAX,
  HELP_REASON_KEYS,
  defaultContactIds,
  helpEmailAllSent,
  helpEmailLabel,
  helpEmailMissedAll,
  loadHelpSettings,
  parseHelpEmail,
  recentHelpRequest,
  storeManagers,
  type HelpEmail,
} from "@/lib/help-requests"

// POST /api/stores/[id]/help-requests — TAB-16 "Ask a manager".
// Rulings: docs/DECISIONS.md 2026-11-12 TAB-16 R1–R10 (Gary).
//
// GATES, IN ORDER — every one on the server, whatever the sheet showed:
//   session (401) → messages.use (403) → body (400) → store is this org's and
//   active (404) → store in the login's scope (403) → checklist is this org's
//   and this store's (404) → task is on that checklist (404) → the asker is an
//   ACTIVE staff member assigned to this store, or null for R4's "Not listed"
//   (400) → with emails on: every ticked contact is an ACTIVE contact of this
//   org, and only a default contact when "Team members can add more contacts"
//   is off (400); at least one recipient (400).
// A tablet can therefore never email an address that is not a manager of this
// store or an active contact (prompt guardrail). Manager addresses are resolved
// here and in the kind, never sent by the client (R3).
//
// THEN: R5 under a per-(store, task) advisory lock — an undeleted help request
// for this task at this store in the last 15 minutes is returned as a
// duplicate, with nothing written and no email. Otherwise the TeamMessage is
// created (R1: it always posts), and with emails on the intent is enqueued and
// dispatched INLINE. Whatever the dispatch did, the message stands (R9); the
// outcome is written to helpEmail and the intent is never left dispatchable
// (R9: never retried). R10: only what really left is called emailed.
//
// "Tablet mode only" is a UI fact: the view mode is a device cookie the server
// cannot trust, so this route gates on what the login may do, like
// POST /api/messages. The TAB-4 PIN gate does not apply to messages (TAB-4 Q11).

const bodySchema = z
  .object({
    checklistId: z.string().min(1),
    taskId: z.string().min(1),
    /** null = R4's "Not listed". Required, so a forgotten field is not read as "Not listed". */
    askerStaffId: z.string().min(1).nullable(),
    reason: z.enum(HELP_REASON_KEYS).nullable().optional(),
    note: z
      .string()
      .max(HELP_NOTE_MAX * 2)
      .optional()
      .transform((s) => (s ?? "").replace(/\r\n/g, "\n").trim())
      .refine((s) => s.length <= HELP_NOTE_MAX, { message: `The note must be ${HELP_NOTE_MAX} characters or fewer.` }),
    contactIds: z.array(z.string().min(1)).max(100).default([]),
  })
  .strict()

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let ctx: Awaited<ReturnType<typeof getCurrentUser>>
  try {
    ctx = await getCurrentUser()
  } catch {
    return bad("Unauthorized", 401)
  }
  const { org, dbUser, actor } = ctx
  if (!can(actor, "messages.use")) return bad("Forbidden", 403)

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "Invalid request")
  const data = parsed.data
  const { id: storeId } = await params

  const store = await prisma.store.findFirst({
    where: { id: storeId, organizationId: org.id, isActive: true },
    select: { id: true, name: true },
  })
  if (!store) return bad("Store not found", 404)
  const { isAdmin, storeIds } = await getUserStoreScope()
  if (!isAdmin && !storeIds.includes(store.id)) return bad("Forbidden", 403)

  const checklist = await prisma.checklist.findFirst({
    where: { id: data.checklistId, organizationId: org.id, storeId: store.id },
    select: { id: true, templateId: true },
  })
  if (!checklist) return bad("Checklist not found", 404)

  // On the checklist = on its template, not excluded at this store, and live —
  // or retired with a tick on this checklist (TPL-3 R1's rule for history).
  const task = await prisma.task.findFirst({
    where: { id: data.taskId, templateId: checklist.templateId },
    select: {
      id: true,
      retiredAt: true,
      excludedStoreIds: true,
      taskLogs: { where: { checklistId: checklist.id }, select: { id: true }, take: 1 },
    },
  })
  if (!task || task.excludedStoreIds.includes(store.id) || (task.retiredAt && task.taskLogs.length === 0)) {
    return bad("Task not found", 404)
  }

  // R4: the store's staff list exactly (TabletStore.staff) — ACTIVE, assigned here.
  let askerStaffId: string | null = null
  if (data.askerStaffId) {
    const staff = await prisma.staffMember.findFirst({
      where: { id: data.askerStaffId, organizationId: org.id, status: "ACTIVE", storeAssignments: { some: { storeId: store.id } } },
      select: { id: true },
    })
    if (!staff) return bad("That name isn't on this store's list. Pick a name, or choose Not listed.")
    askerStaffId = staff.id
  }

  const settings = await loadHelpSettings(org.id)
  const managers = settings.enabled ? await storeManagers(org.id, store.id) : []
  let contactIds: string[] = []
  if (settings.enabled) {
    contactIds = [...new Set(data.contactIds)]
    if (contactIds.length > 0) {
      const found = await prisma.notificationContact.count({
        where: { id: { in: contactIds }, organizationId: org.id, archivedAt: null },
      })
      if (found !== contactIds.length) return bad("A contact you picked is no longer available. Close this and try again.")
      if (!settings.tabletAddContacts) {
        const defaults = new Set(await defaultContactIds(org.id))
        if (contactIds.some((id) => !defaults.has(id))) return bad("Only the default contacts can be picked here.")
      }
    }
    // R3: managers always; with none, the ticked contacts must carry it.
    if (managers.length === 0 && contactIds.length === 0) return bad("Pick at least one person to email.")
  }
  // Emails off (R1): the sheet showed no Send to list; anything sent is ignored.

  const now = new Date()
  type Created = { kind: "created"; id: string; createdAt: Date }
  type Duplicate = { kind: "duplicate"; createdAt: Date; helpEmail: unknown; askerName: string }
  const outcome: Created | Duplicate = await prisma.$transaction(async (tx) => {
    // R5 under a lock, so two taps at once cannot both post.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tab16:${store.id}:${task.id}`}))`
    const first = await recentHelpRequest(tx, store.id, task.id, now)
    if (first) {
      return {
        kind: "duplicate",
        createdAt: first.createdAt,
        helpEmail: first.helpEmail,
        askerName: first.authorStaff?.displayName ?? "Team member",
      } satisfies Duplicate
    }
    const m = await tx.teamMessage.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        authorUserId: dbUser?.id ?? null,
        authorStaffId: askerStaffId,
        type: HELP_MESSAGE_TYPE,
        body: data.note,
        sourceChecklistId: checklist.id,
        taskId: task.id,
        helpReason: data.reason ?? null,
        helpEmail: { state: "off" },
        // The author has obviously read their own post (POST /api/messages).
        ...(dbUser ? { reads: { create: { userId: dbUser.id } } } : {}),
      },
      select: { id: true, createdAt: true },
    })
    return { kind: "created", id: m.id, createdAt: m.createdAt } satisfies Created
  })

  if (outcome.kind === "duplicate") {
    return NextResponse.json({
      duplicate: true,
      createdAt: outcome.createdAt.toISOString(),
      askerName: outcome.askerName,
      label: helpEmailLabel(parseHelpEmail(outcome.helpEmail)),
      allSent: helpEmailAllSent(parseHelpEmail(outcome.helpEmail)),
    })
  }

  let helpEmail: HelpEmail = { state: "off" }
  if (settings.enabled) {
    helpEmail = await sendHelpEmail({
      organizationId: org.id,
      storeId: store.id,
      storeName: store.name,
      messageId: outcome.id,
      contactIds,
      managerEmails: managers.map((m) => m.email.trim().toLowerCase()),
      eventAt: outcome.createdAt,
    })
    await prisma.teamMessage.update({ where: { id: outcome.id }, data: { helpEmail } })
  }

  return NextResponse.json(
    {
      duplicate: false,
      id: outcome.id,
      createdAt: outcome.createdAt.toISOString(),
      label: helpEmailLabel(helpEmail),
      missedAll: helpEmailMissedAll(helpEmail),
      // True when everyone it was meant for really got it (or emails are off):
      // the sheet then just closes. Anything less stays on screen (R9, R10).
      allSent: helpEmailAllSent(helpEmail),
    },
    { status: 201 }
  )
}
