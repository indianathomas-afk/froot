import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { canEditDisplayLayout, SURFACES, validateLayout, type Surface } from "@/lib/display-layout"

// PUT /api/display/settings — TAB-3's card picker (Gary, 2026-11-10). Writes
// ONE of Organization.dashboardLayout / .tabletLayout per call: the page's two
// tabs save independently, so neither can clobber the other.
//
// Body: { surface: "dashboard" | "tablet", layout: [{ key, enabled }] | null }.
// `null` is "Reset to defaults" and stores SQL NULL — not the default array —
// so a card Froot adds later still reaches a reset org at its default place.
//
// SHAPE COPIED FROM PUT /api/pace-alerts/settings: auth → ADMIN re-check →
// Zod → org lookup → update. ADMIN ONLY (ruling 1). The page is already gated
// on settings.access (ADMIN_ONLY); this re-checks per PERM-2 — a gate on a page
// is not a gate on an endpoint. The role test is canEditDisplayLayout(), the
// same predicate requireAdmin() applies, kept in src/lib/display-layout.ts so
// scripts/verify-tab3-layout.ts pins the exact check this route runs.
//
// Every rule beyond the body's shape — known keys only, the full list exactly
// once, at least one never-module-gated desktop card on (Sales performance,
// Monthly goal, Team messages or Shift checklist — F6 as refined by Gary,
// 2026-11-10, so "only Inventory count on" is refused), Tasks and Messages on
// in Tablet mode — is validateLayout(), which also returns the NORMALISED list
// that is stored.

const bodySchema = z
  .object({
    surface: z.enum(SURFACES as [Surface, ...Surface[]]),
    layout: z.array(z.object({ key: z.string().min(1), enabled: z.boolean() }).strict()).nullable(),
  })
  .strict()

export async function PUT(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let role: string | null | undefined
  try {
    // getCurrentUser() returns a roleless actor for a User row in another org
    // (DEBT-50/F1), so a cross-org identity is refused here like any non-ADMIN.
    role = (await getCurrentUser()).dbUser?.role
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!canEditDisplayLayout(role)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 })
  }
  const { surface, layout } = parsed.data

  const result = validateLayout(surface, layout)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId }, select: { id: true } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const value = result.layout === null ? Prisma.DbNull : (result.layout as Prisma.InputJsonValue)
  await prisma.organization.update({
    where: { id: org.id },
    data: surface === "dashboard" ? { dashboardLayout: value } : { tabletLayout: value },
  })

  return NextResponse.json({ surface, layout: result.layout })
}
