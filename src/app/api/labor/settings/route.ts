import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireLaborContext } from "@/lib/labor-access"

// Org-default LaborSettings (storeId = null). Per-store override rows are a
// later phase; Phase 0 manages the single org default. Money is DOLLARS
// (Decimal); we serialize Decimals to numbers for the client and let Prisma
// coerce numbers back to Decimal on write. Read + write are ADMIN + MANAGER.

// Schema-mirrored defaults returned when no row exists yet, so the settings
// form always has values to render (matching the @default()s in schema.prisma).
const DEFAULTS = {
  laborTargetPct: 20,
  roundingIncrement: 1000,
  denominator: "TOTAL_WITH_DELIVERY" as const,
  plannedBlendedRate: null as number | null,
}

const putSchema = z.object({
  laborTargetPct: z.number().positive().max(100),
  roundingIncrement: z.number().positive().max(99999999),
  denominator: z.enum(["IN_STORE", "TOTAL_WITH_DELIVERY"]),
  plannedBlendedRate: z.number().positive().max(99999999).nullable(),
})

export async function GET() {
  const ctx = await requireLaborContext()
  if ("error" in ctx) return ctx.error

  const row = await prisma.laborSettings.findFirst({
    where: { organizationId: ctx.org.id, storeId: null },
  })
  if (!row) return NextResponse.json({ ...DEFAULTS, exists: false })

  return NextResponse.json({
    laborTargetPct: Number(row.laborTargetPct),
    roundingIncrement: Number(row.roundingIncrement),
    denominator: row.denominator,
    plannedBlendedRate: row.plannedBlendedRate === null ? null : Number(row.plannedBlendedRate),
    exists: true,
  })
}

export async function PUT(req: Request) {
  const ctx = await requireLaborContext({ write: true })
  if ("error" in ctx) return ctx.error

  const parsed = putSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  const data = parsed.data

  // Find-then-update/create rather than upsert: the org-default row keys on a
  // nullable storeId, which Prisma won't accept in a compound-unique upsert.
  // The partial unique index in the migration guarantees at most one default.
  const existing = await prisma.laborSettings.findFirst({
    where: { organizationId: ctx.org.id, storeId: null },
    select: { id: true },
  })

  const row = existing
    ? await prisma.laborSettings.update({ where: { id: existing.id }, data })
    : await prisma.laborSettings.create({
        data: { ...data, organizationId: ctx.org.id, storeId: null },
      })

  return NextResponse.json({
    laborTargetPct: Number(row.laborTargetPct),
    roundingIncrement: Number(row.roundingIncrement),
    denominator: row.denominator,
    plannedBlendedRate: row.plannedBlendedRate === null ? null : Number(row.plannedBlendedRate),
    exists: true,
  })
}
