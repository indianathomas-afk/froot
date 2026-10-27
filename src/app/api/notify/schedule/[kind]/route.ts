import { NextResponse } from "next/server"
import { getOrganization, hrModuleAvailable, requireAdmin } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getKind } from "@/lib/notifications/registry"
import { MILESTONE_KIND } from "@/lib/notifications/kinds/milestone"
import { DOC_DIGEST_KIND } from "@/lib/notifications/kinds/doc-digest"
import { loadScheduleView, parseScheduleBody } from "@/lib/notifications/schedule-settings"

// PUT    /api/notify/schedule/[kind] — NOTIFY-SCHED, save one scheduled kind's
//        send schedule (upsert on organizationId + kind).
// DELETE /api/notify/schedule/[kind] — "Reset to default": DELETES the row
//        (F15, Gary 2026-10-24: "reset deletes the row"). No row = today's
//        behaviour (F6).
//
// ADMIN only (F9), re-checked here per PERM-2 — the page's settings.access gate
// is not a gate on this endpoint. Shaped on /api/notify/recipients/[kind]:
// admin (403) → org (404) → kind. A kind with no `schedule` in the registry is
// 404 (an event kind has nothing to schedule), and so is milestone.reached
// where HR does not exist, the gate its card already sits behind. Validation is
// parseScheduleBody → scheduleProblem, the hourly runner's own check: pace
// hours 5–20 (F10), pace daily/weekly/monthly, milestones daily/weekly (F12),
// weekly exactly one day (F16), an org-scoped kind needs a valid zone (F3).

type Ctx = { params: Promise<{ kind: string }> }

async function gate(ctx: Ctx) {
  let admin: Awaited<ReturnType<typeof requireAdmin>>
  try {
    admin = await requireAdmin()
  } catch {
    return { error: NextResponse.json({ error: "Admin access required" }, { status: 403 }) }
  }
  const org = await getOrganization().catch(() => null)
  if (!org) return { error: NextResponse.json({ error: "Org not found" }, { status: 404 }) }
  const { kind } = await ctx.params
  const spec = getKind(kind)?.schedule
  // NOTIFY-14 (F10): the document digest is HR's, gated exactly as milestones.
  if (!spec || ((kind === MILESTONE_KIND || kind === DOC_DIGEST_KIND) && !hrModuleAvailable(org.clerkOrgId))) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) }
  }
  return { admin, org, kind, spec }
}

export async function PUT(req: Request, ctx: Ctx) {
  const g = await gate(ctx)
  if ("error" in g) return g.error
  const v = parseScheduleBody(g.spec, await req.json().catch(() => null))
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })

  const data = { ...v.row, updatedByUserId: g.admin.id }
  await prisma.notificationSchedule.upsert({
    where: { organizationId_kind: { organizationId: g.org.id, kind: g.kind } },
    create: { organizationId: g.org.id, kind: g.kind, ...data },
    update: data,
  })
  // Return what was SAVED, read back, so the editor shows the database's row.
  return NextResponse.json(await loadScheduleView(g.org.id, g.kind))
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const g = await gate(ctx)
  if ("error" in g) return g.error
  await prisma.notificationSchedule.deleteMany({ where: { organizationId: g.org.id, kind: g.kind } })
  return NextResponse.json({ success: true })
}
