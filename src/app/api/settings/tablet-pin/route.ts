import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { writeAuditLog } from "@/lib/audit"
import { pinEnv } from "@/lib/tablet-pin"

// TAB-4 (Gary, 2026-11-10, Q1) — "Require a PIN on shared tablets", the
// /settings switch. The Calendar toggle's shape (api/calendar/toggle), behind
// settings.access (ADMIN_ONLY, not grantable).
//
// REFUSES TO TURN ON while TABLET_PIN_PEPPER or TABLET_TOKEN_SECRET is missing
// (Q4). Turning OFF is always allowed — it can only make things more
// permissive, and an admin must be able to get a store ticking again when a
// secret goes missing. The per-store readiness line is information only and
// never blocks this (Q7).

const bodySchema = z.object({ enabled: z.boolean() })

export async function POST(req: Request) {
  const { orgId, userId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { actor } = await getUserStoreScope()
  if (!can(actor, "settings.access")) return NextResponse.json({ error: "Admin access required" }, { status: 403 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const org = await prisma.organization.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true, tabletPinRequired: true },
  })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  if (parsed.data.enabled && !pinEnv().ok) {
    return NextResponse.json(
      { error: "PINs aren't configured in this environment yet, so this can't be switched on." },
      { status: 409 }
    )
  }

  const updated = await prisma.organization.update({
    where: { id: org.id },
    data: { tabletPinRequired: parsed.data.enabled },
    select: { tabletPinRequired: true },
  })

  if (updated.tabletPinRequired !== org.tabletPinRequired) {
    await writeAuditLog({
      organizationId: org.id,
      userId: userId ?? null,
      action: "org.tablet_pin_required",
      entityType: "Organization",
      entityId: org.id,
      metadata: { before: org.tabletPinRequired, after: updated.tabletPinRequired },
    })
  }

  return NextResponse.json({ enabled: updated.tabletPinRequired })
}
