import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getOrganization, requireAdmin } from "@/lib/auth"
import { HELP_REQUEST_KIND } from "@/lib/help-request-shared"

// PUT /api/notify/help-request — TAB-16 C1, the "Help request emails" section
// on /settings/notifications. R7 (Gary): "Only Admins can change Help request
// emails. It ships switched off on production; I'll turn it on."
//
// Upserts the org's NotificationKindSettings row for "help.request" — the
// NOTIFY-4 table (no row = off). Shaped on PUT /api/task-comm/settings.
// GATES, IN ORDER: ADMIN (403; a MANAGER is refused here independently of the
// page, PERM-2) → org (404) → body (400). PARTIAL: only the fields sent are
// written, so the two switches cannot clobber each other.
//
// The default contacts are the kind's "Also send to" picks and are saved by
// PUT /api/notify/recipients/help.request (NOTIFY-12), not here. The subject is
// fixed by R8 and read-only on the card, so there is no copy field.

const bodySchema = z
  .object({
    enabled: z.boolean().optional(),
    tabletAddContacts: z.boolean().optional(),
  })
  .strict()

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
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  const data = { ...parsed.data, updatedByUserId: admin.id }

  const row = await prisma.notificationKindSettings.upsert({
    where: { organizationId_kind: { organizationId: org.id, kind: HELP_REQUEST_KIND } },
    create: { organizationId: org.id, kind: HELP_REQUEST_KIND, ...data },
    update: data,
    select: { enabled: true, tabletAddContacts: true },
  })
  return NextResponse.json(row)
}
