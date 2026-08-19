import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { requireSquareLabor } from "@/lib/labor-access"
import { canSeeWages } from "@/lib/labor-dashboard"

// AL-3 — THE TWO FROOT-OWNED FIELDS ON A SQUARE ROSTER ROW.
// PATCH /api/square/labor/roster/[squareTeamMemberId]
//
// WK HRS and SUP only. Vision item 10: "WK HRS and SUP stay Froot-adjustable"
// — they are Froot concepts and Square has no opinion about either, which is
// also why the roster sync's ON CONFLICT DO UPDATE deliberately omits both
// columns (src/lib/labor-roster.ts, writeRoster).
//
// NOTHING SQUARE OWNS IS WRITABLE HERE, and that is the point rather than an
// omission. Froot is read-only toward Square (Gary, 2026-08-18): a pay rate is
// corrected in Square and arrives on the next sync. This route cannot change a
// wage, a job title or a location even if a caller asks it to — the schema below
// admits exactly two keys.
//
// KNOWN AND LABELLED: NOTHING READS THESE VALUES YET. Seam (b) holds — the
// weekly budget still runs entirely on LaborPosition, and no core labor engine
// gained a Square-sourced input in this phase. Gary ruled to build the editors
// anyway (Q9, 2026-08-19) because item 10 asks for them and because they are the
// storage a later salaried-allocation phase needs; the card says so on its face
// so their inertness is visible rather than discovered.

const patchSchema = z
  .object({
    // 168 = hours in a week. Null clears the override and falls back to Square's
    // own weekly_hours, which is present for salaried members and absent for
    // hourly ones.
    weeklyHoursOverride: z.number().int().positive().max(168).nullable(),
    isSupervisory: z.boolean().nullable(),
  })
  .partial()

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireSquareLabor()
  if ("error" in ctx) return ctx.error

  // THE SAME GATE THE CARD RENDERS BEHIND. A viewer who may not see a wage may
  // not edit the row that carries one — otherwise a denied MANAGER could still
  // probe which team members exist, and their pay type, through 200s and 404s.
  const { actor } = await getUserStoreScope()
  if (!canSeeWages(ctx.org, actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  // Org-scoped by the composite key rather than by a bare id: the same real
  // Square employee can be mirrored by more than one tenant, so a global lookup
  // would be cross-tenant reachable.
  const existing = await prisma.squareTeamMemberWage.findUnique({
    where: { organizationId_squareTeamMemberId: { organizationId: ctx.org.id, squareTeamMemberId: id } },
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const updated = await prisma.squareTeamMemberWage.update({
    where: { id: existing.id },
    data: parsed.data,
    select: { squareTeamMemberId: true, weeklyHoursOverride: true, isSupervisory: true },
  })
  // NO WAGE IN THE RESPONSE. The caller already has what it may see; echoing a
  // pay rate back from a write route is how a field ends up on a surface nobody
  // reviewed.
  return NextResponse.json(updated)
}
