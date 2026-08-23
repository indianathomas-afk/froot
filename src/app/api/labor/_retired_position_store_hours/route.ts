import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireLaborContext } from "@/lib/labor-access"

// ─── RETIRED 2026-08-22 — UNMOUNTED, NOT DELETED ──────────────────────────────
//
// THE FOLDER IS UNDERSCORE-PREFIXED, WHICH IS HOW THIS ROUTE STOPS EXISTING.
// App Router treats a leading `_` as a private folder and excludes it from
// routing, so /api/labor/position-store-hours now 404s while every line of the
// handler below survives byte-for-byte. That is what "preserved and marked"
// has to mean for a route: a route left mounted is a route that still writes
// rows, so the MOUNT is what comes out, never the code.
//
// WHY (Gary, 2026-08-22, docs/DECISIONS.md): "Both the dollars and the hours at
// each store derive from the person — nothing derived is ever typed by hand." A
// per-store salaried HOURS declaration is a hand-typed derived figure.
// Replaced by /api/labor/salaried and src/lib/labor-salaried.ts.
//
// THE TABLE AND ITS MIGRATION ARE UNTOUCHED — additive-only does not tier down —
// and the SALARIED LaborPosition row must also stay, because laborPositionId
// here carries onDelete: Cascade and removing the archetype would silently
// cascade-delete every declaration row.
//
// EVERYTHING BELOW THIS LINE WAS TRUE WHEN WRITTEN AND IS UNEDITED.
//
// R7 option B — per-store salaried declarations (LaborPositionStoreHours).
// ADMIN + MANAGER, the same gate as the rest of /settings/labor's config
// endpoints (requireLaborContext({ write: true })).
//
// HOURS ONLY. There is no rate in the schema (D18), no rate in these bodies, and
// no rate in the responses. A route that cannot express a rate cannot move the
// blended hourly rate, which is the structural half of Gary's ruling.
//
// ZERO IS A DECLARATION AND `null` DELETES ONE. The two are NOT the same request:
//   weeklyHours: 0     -> "this store carries none of this archetype"
//   weeklyHours: null  -> "withdraw the declaration; inherit the org figure again"
// Anything reading these rows must test `!= null`, never truthiness.

const MAX_WEEKLY_HOURS = 168

const bodySchema = z.object({
  storeId: z.string().min(1),
  laborPositionId: z.string().min(1),
  // null = delete the declaration (revert to inherit). 0 is a legal value.
  weeklyHours: z.number().int().min(0).max(MAX_WEEKLY_HOURS).nullable(),
})

export async function GET() {
  const ctx = await requireLaborContext()
  if ("error" in ctx) return ctx.error

  const rows = await prisma.laborPositionStoreHours.findMany({
    where: { organizationId: ctx.org.id },
    select: { storeId: true, laborPositionId: true, weeklyHours: true },
  })
  return NextResponse.json(rows)
}

export async function PUT(req: Request) {
  const ctx = await requireLaborContext({ write: true })
  if ("error" in ctx) return ctx.error

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  const { storeId, laborPositionId, weeklyHours } = parsed.data

  // BOTH IDS ARE VERIFIED AGAINST THE CALLER'S ORG BEFORE ANY WRITE. Without
  // this a caller could declare hours onto another tenant's store or against
  // another tenant's position row — the unique key alone would happily accept it.
  const [store, position] = await Promise.all([
    prisma.store.findFirst({ where: { id: storeId, organizationId: ctx.org.id }, select: { id: true } }),
    prisma.laborPosition.findFirst({ where: { id: laborPositionId, organizationId: ctx.org.id }, select: { id: true, payType: true } }),
  ])
  if (!store || !position) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Only SALARIED archetypes carry a weekly-hours declaration. An hourly
  // position has no impliedWeeklyHours to inherit, so a declaration against one
  // would be a row that resolves to nothing.
  if (position.payType !== "SALARIED") {
    return NextResponse.json({ error: "Only salaried positions carry a per-store declaration" }, { status: 400 })
  }

  if (weeklyHours === null) {
    await prisma.laborPositionStoreHours.deleteMany({ where: { storeId, laborPositionId } })
    return NextResponse.json({ storeId, laborPositionId, weeklyHours: null })
  }

  // The unique key (storeId, laborPositionId) is what makes this an upsert rather
  // than a create — two rows can never describe one store's carriage of one
  // archetype, so there is no precedence rule to get wrong.
  const row = await prisma.laborPositionStoreHours.upsert({
    where: { storeId_laborPositionId: { storeId, laborPositionId } },
    create: { organizationId: ctx.org.id, storeId, laborPositionId, weeklyHours },
    update: { weeklyHours },
    select: { storeId: true, laborPositionId: true, weeklyHours: true },
  })
  return NextResponse.json(row)
}
