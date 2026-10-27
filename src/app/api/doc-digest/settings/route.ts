import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getOrganization, requireAdmin } from "@/lib/auth"
import { docDigestHrActive } from "@/lib/notifications/kinds/doc-digest"

// PUT /api/doc-digest/settings — NOTIFY-14, the org's document digest switch
// (F4, Gary 2026-10-27: "Agreed"). Writes Organization.docDigestEnabled.
// Shaped on PUT /api/milestone-alerts/settings.
//
// GATES, IN ORDER: ADMIN (403) → org (404) → HR available here AND active for
// the org (F10, 404 — the card offers no switch otherwise). Turning on email to
// every admin and manager is an org-governance action; the card on
// /settings/notifications is already behind settings.access, and this
// re-checks per PERM-2.
//
// NOTHING IS SEEDED OR CLEARED ON EITHER EDGE. On: the next due slot builds a
// fresh snapshot. Off: the runner skips the org, and a queued digest expires at
// its next dispatch (the kind's enabled()).

const bodySchema = z.object({ enabled: z.boolean() })

export async function PUT(req: Request) {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }
  const org = await getOrganization().catch(() => null)
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })
  if (!docDigestHrActive(org)) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const updated = await prisma.organization.update({
    where: { id: org.id },
    data: { docDigestEnabled: parsed.data.enabled },
    select: { docDigestEnabled: true },
  })
  return NextResponse.json({ enabled: updated.docDigestEnabled })
}
