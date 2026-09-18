import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"

const bodySchema = z.object({ enabled: z.boolean() })

// POST /api/calendar/toggle — flips Organization.calendarEnabled.
//
// ADMIN-ONLY, on the api/labor/toggle pattern: turning a module on is an
// org-governance action, and /settings' own comment records that MODULE
// GOVERNANCE OWNS THESE ROUTES rather than the page that renders them. So the
// inline requireAdmin() stays here even though settings.access already gated
// the page.
//
// DELIBERATELY DOES NOT USE requireCalendar(). That helper refuses when the
// calendar is disabled — which is precisely the state an admin is in when they
// come here to enable it. A toggle guarded by the thing it toggles can only
// ever be turned off.
//
// NO AVAILABILITY GATE. Unlike labor/toggle there is no
// CALENDAR_MODULE_AVAILABLE 404 in front of this: R2 made the calendar a plain
// per-org column rather than a staged rollout, so the column IS the only gate.
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
    data: { calendarEnabled: parsed.data.enabled },
  })

  // NOTHING IS DELETED ON DISABLE. Events and occurrences stay exactly as they
  // are and simply stop being served — an admin who turns the calendar off for
  // a week and back on finds their reminders where they left them. The cron
  // skips the org while it is off (counted as skippedDisabled), so no
  // occurrence is materialised for the dark period.
  return NextResponse.json({ enabled: updated.calendarEnabled })
}
