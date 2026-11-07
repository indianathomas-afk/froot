import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getOrganization, requireAdmin } from "@/lib/auth"
import {
  TASK_COMM_BODY_MAX,
  TASK_COMM_KIND,
  TASK_COMM_SUBJECT_MAX,
  TASK_COMM_THRESHOLD_MAX,
  TASK_COMM_THRESHOLD_MIN,
} from "@/lib/notifications/kinds/task-comm"

// PUT /api/task-comm/settings — NOTIFY-4, the Tasks and Communication card's
// settings. Upserts the org's NotificationKindSettings row for this kind (F5,
// Gary 2026-11-06: "One new table holding the switch, role boxes, threshold,
// subject and body."). Shaped on PUT /api/doc-digest/settings.
//
// GATES, IN ORDER: ADMIN (403) → org (404) → body (400). Not module-gated: the
// email reads checklists and messages, which every org has.
//
// PARTIAL: only the fields sent are written. Copy is PLAIN TEXT (F5): trimmed;
// blank or null = the default text (stored as null); subject ≤ 120 chars, body
// ≤ 1,000. "Reset to default" sends { subject: null, body: null }. thresholdPct
// is an integer 50–100 (F9), null = the default 90.
//
// THIS ROW IS NEVER DELETED BY THE SCHEDULE'S "Reset to default" — that route
// deletes NotificationSchedule only, which is why the copy lives here.

const copy = (max: number) =>
  z
    .string()
    .max(max * 2) // generous pre-trim cap; the trimmed length is checked below
    .nullable()
    .transform((s) => (s === null ? null : s.replace(/\r\n/g, "\n").trim() || null))
    .refine((s) => s === null || s.length <= max, { message: `must be ${max} characters or fewer` })

const bodySchema = z
  .object({
    enabled: z.boolean().optional(),
    sendToAdmins: z.boolean().optional(),
    sendToManagers: z.boolean().optional(),
    thresholdPct: z.number().int().min(TASK_COMM_THRESHOLD_MIN).max(TASK_COMM_THRESHOLD_MAX).nullable().optional(),
    subject: copy(TASK_COMM_SUBJECT_MAX).optional(),
    body: copy(TASK_COMM_BODY_MAX).optional(),
  })
  .strict()
  // A subject is one line.
  .refine((b) => b.subject == null || !/\n/.test(b.subject), { message: "subject must be one line", path: ["subject"] })

const SELECT = {
  enabled: true,
  sendToAdmins: true,
  sendToManagers: true,
  thresholdPct: true,
  subject: true,
  body: true,
} as const

export async function PUT(req: Request) {
  let admin: Awaited<ReturnType<typeof requireAdmin>>
  try {
    admin = await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }
  const org = await getOrganization().catch(() => null)
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json(
      { error: issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid body" },
      { status: 400 }
    )
  }
  const data = { ...parsed.data, updatedByUserId: admin.id }

  const row = await prisma.notificationKindSettings.upsert({
    where: { organizationId_kind: { organizationId: org.id, kind: TASK_COMM_KIND } },
    create: { organizationId: org.id, kind: TASK_COMM_KIND, ...data },
    update: data,
    select: SELECT,
  })
  return NextResponse.json(row)
}
