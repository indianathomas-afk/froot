import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"

const bodySchema = z.object({ enabled: z.boolean() })

// POST /api/pace-alerts/toggle — flips Organization.paceAlertsEnabled (F-5b).
//
// ADMIN-ONLY, on the api/calendar/toggle pattern: turning org-wide email on is
// an org-governance action, and /settings' own comment records that MODULE
// GOVERNANCE OWNS THESE ROUTES rather than the page that renders them. So the
// inline requireAdmin() stays here even though settings.access already gated
// the page (PERM-2: a gate on a page is not a gate on an endpoint). Same gate
// as HR-16's PUT /api/hr/settings.
//
// NO AVAILABILITY GATE, unlike hr/toggle and labor/toggle. There is no
// PACE_ALERTS_MODULE_AVAILABLE env var: F-5 shipped 2026-07-10 to every org and
// was never a staged rollout, so — as with calendarEnabled — the column IS the
// only gate.
export async function POST(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const updated = await prisma.organization.update({
    where: { id: org.id },
    data: { paceAlertsEnabled: parsed.data.enabled },
  })

  // NO PaceAlertLog ROW IS TOUCHED IN EITHER DIRECTION, and that is deliberate
  // in both. Turning alerts OFF leaves this month's already-sent rows alone, so
  // re-enabling mid-month does not re-send an alert the managers already got —
  // the one-alert-per-store-per-month promise is kept across a toggle. Turning
  // them ON writes nothing either: the next 15:00 UTC run evaluates the org's
  // stores from scratch, which may or may not alert on the numbers as they are
  // that day.
  return NextResponse.json({ enabled: updated.paceAlertsEnabled })
}
