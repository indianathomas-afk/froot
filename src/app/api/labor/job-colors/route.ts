import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireLaborContext } from "@/lib/labor-access"
import { BADGE_PRESET_KEYS, isBadgePresetKey } from "@/lib/badge-presets"
import { deterministicJobColor, resolveJobTitles } from "@/lib/labor-schedule"

// OVL-S3 — the position-colour editor's data. GET lists the jobs DISCOVERED in
// synced shifts with their current colour; PUT writes one override.
//
// AUTO-DISCOVERY, NOT A CATALOGUE. Square exposes no job list — GET
// /v2/labor/jobs 404s (S1b § 3) — so the set of jobs is whatever appears on
// synced scheduled shifts. A job stops being listed when it stops being
// scheduled; its override row survives, so re-adding the shift restores the
// chosen colour rather than re-rolling it.
//
// LIST = ADMIN + MANAGER, not any role. Unlike the dayparts list beside it this
// is a CONFIG surface rather than a card input — the overlay itself reads colours
// through /api/labor/coverage, which is where the STORE-visible path lives.

const bodySchema = z.object({
  squareJobId: z.string().trim().min(1).max(191),
  colorKey: z.string().refine(isBadgePresetKey, { message: "unknown colour key" }),
})

export async function GET() {
  const ctx = await requireLaborContext()
  if ("error" in ctx) return ctx.error

  // Distinct job ids across every non-tombstoned shift this org has synced. The
  // effective column is the one the overlay draws from, so the editor lists
  // exactly the jobs a manager can actually see on the card.
  const [shifts, overrides] = await Promise.all([
    prisma.squareScheduledShift.findMany({
      where: { organizationId: ctx.org.id, effectiveIsDeleted: false },
      select: { effectiveJobId: true },
      distinct: ["effectiveJobId"],
    }),
    prisma.squareJobColor.findMany({
      where: { organizationId: ctx.org.id },
      select: { squareJobId: true, colorKey: true },
    }),
  ])

  const jobIds = [...new Set(shifts.map((s) => s.effectiveJobId))].sort()
  const overrideOf = new Map(overrides.map((o) => [o.squareJobId, o.colorKey]))
  const titles = await resolveJobTitles(ctx.org.id, jobIds)

  return NextResponse.json({
    palette: BADGE_PRESET_KEYS,
    jobs: jobIds.map((squareJobId) => {
      const stored = overrideOf.get(squareJobId)
      return {
        squareJobId,
        title: titles.get(squareJobId) ?? null,
        colorKey: isBadgePresetKey(stored) ? stored : deterministicJobColor(squareJobId),
        // Whether this colour is a CHOICE or the default. The editor says so, so
        // "reset to default" is a visible state rather than a guess.
        isOverride: isBadgePresetKey(stored),
      }
    }),
  })
}

export async function PUT(req: Request) {
  const ctx = await requireLaborContext({ write: true })
  if ("error" in ctx) return ctx.error

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  const { squareJobId, colorKey } = parsed.data

  await prisma.squareJobColor.upsert({
    where: { organizationId_squareJobId: { organizationId: ctx.org.id, squareJobId } },
    create: { organizationId: ctx.org.id, squareJobId, colorKey },
    update: { colorKey },
  })
  return NextResponse.json({ ok: true, squareJobId, colorKey })
}

// Removing the override returns the job to its deterministic default — the row's
// ABSENCE is the default, so a delete is the reset and no sentinel is needed.
export async function DELETE(req: Request) {
  const ctx = await requireLaborContext({ write: true })
  if ("error" in ctx) return ctx.error

  const squareJobId = new URL(req.url).searchParams.get("squareJobId") ?? ""
  if (!squareJobId) return NextResponse.json({ error: "squareJobId required" }, { status: 400 })

  await prisma.squareJobColor
    .delete({ where: { organizationId_squareJobId: { organizationId: ctx.org.id, squareJobId } } })
    .catch(() => null)
  return NextResponse.json({ ok: true, squareJobId, colorKey: deterministicJobColor(squareJobId) })
}
