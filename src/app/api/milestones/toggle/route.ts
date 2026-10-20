import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { hrModuleAvailable, requireAdmin } from "@/lib/auth"

const bodySchema = z.object({ enabled: z.boolean() })

// POST /api/milestones/toggle — flips Organization.milestonesEnabled.
//
// A COPY OF api/calendar/toggle/route.ts, and every reason in that header
// holds here: ADMIN-only inline (ruling 1 — module governance owns the toggle,
// not the page that renders it), and it deliberately does NOT call
// requireMilestones(), which refuses while disabled — a toggle guarded by the
// thing it toggles could only ever be turned off.
//
// ONE DIFFERENCE, AND IT IS F5 (Gary, 2026-10-15): "Milestones is part of HR;
// HR off means Milestones off everywhere." Where HR does not exist here or is
// off for this org, this route answers 404 like every other milestone surface,
// and the /settings card is not rendered. Without it the column could be set
// in an org where nothing can ever read it.
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
  if (!hrModuleAvailable(org.clerkOrgId) || !org.activeModules.includes("hr")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const updated = await prisma.organization.update({
    where: { id: org.id },
    data: { milestonesEnabled: parsed.data.enabled },
  })

  // NOTHING IS DELETED ON DISABLE. Tenure milestones and start dates stay as
  // they are and simply stop being served; turning it back on restores them.
  return NextResponse.json({ enabled: updated.milestonesEnabled })
}
