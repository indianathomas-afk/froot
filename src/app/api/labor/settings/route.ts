import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireLaborContext, requireLaborStore } from "@/lib/labor-access"
import { resolveLaborSettings } from "@/lib/labor-settings"

// LaborSettings — org default (storeId null) or a per-store override (Phase 3).
// GET/PUT ?storeId= targets a store; omit it for the org default. Money is
// dollars. `denominator` is deprecated (total sales only) and no longer in IO.
// Read + write are ADMIN + MANAGER.

const DEFAULTS = { laborTargetPct: 20, roundingIncrement: 1000 }

const putSchema = z.object({
  storeId: z.string().min(1).nullable().optional(),
  laborTargetPct: z.number().positive().max(100),
  roundingIncrement: z.number().positive().max(99999999),
  plannedBlendedRate: z.number().positive().max(99999999).nullable(),
  gmOnFloorStartMinutes: z.number().int().min(0).max(1440).nullable(),
  gmOnFloorEndMinutes: z.number().int().min(0).max(1440).nullable(),
  dailySplitPolicy: z.enum(["FLOOR_FIRST", "SALES_WEIGHTED"]),
})

export async function GET(req: Request) {
  const ctx = await requireLaborContext()
  if ("error" in ctx) return ctx.error
  const storeId = new URL(req.url).searchParams.get("storeId")

  if (storeId) {
    const store = await requireLaborStore(ctx, storeId)
    if ("error" in store) return store.error
    const [storeRow, resolved] = await Promise.all([
      prisma.laborSettings.findFirst({ where: { organizationId: ctx.org.id, storeId } }),
      resolveLaborSettings(ctx.org.id, storeId),
    ])
    // Effective values (store override else inherited org default) + whether a
    // store-specific override exists.
    return NextResponse.json({ scope: "store", hasOverride: !!storeRow, ...resolved })
  }

  const row = await prisma.laborSettings.findFirst({ where: { organizationId: ctx.org.id, storeId: null } })
  return NextResponse.json({
    scope: "org",
    hasOverride: !!row,
    laborTargetPct: row ? Number(row.laborTargetPct) : DEFAULTS.laborTargetPct,
    roundingIncrement: row ? Number(row.roundingIncrement) : DEFAULTS.roundingIncrement,
    plannedBlendedRate: row?.plannedBlendedRate == null ? null : Number(row.plannedBlendedRate),
    gmOnFloorStartMinutes: row?.gmOnFloorStartMinutes ?? null,
    gmOnFloorEndMinutes: row?.gmOnFloorEndMinutes ?? null,
    dailySplitPolicy: row?.dailySplitPolicy ?? "FLOOR_FIRST",
    source: "org",
  })
}

export async function PUT(req: Request) {
  const ctx = await requireLaborContext({ write: true })
  if ("error" in ctx) return ctx.error
  const parsed = putSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  const { storeId, ...fields } = parsed.data

  if (storeId) {
    const store = await requireLaborStore(ctx, storeId)
    if ("error" in store) return store.error
  }

  const existing = await prisma.laborSettings.findFirst({
    where: { organizationId: ctx.org.id, storeId: storeId ?? null },
    select: { id: true },
  })
  if (existing) {
    await prisma.laborSettings.update({ where: { id: existing.id }, data: fields })
  } else {
    await prisma.laborSettings.create({ data: { ...fields, organizationId: ctx.org.id, storeId: storeId ?? null } })
  }
  return NextResponse.json({ ok: true })
}

// DELETE ?storeId= — remove a per-store override (revert to the org default).
export async function DELETE(req: Request) {
  const ctx = await requireLaborContext({ write: true })
  if ("error" in ctx) return ctx.error
  const storeId = new URL(req.url).searchParams.get("storeId")
  if (!storeId) return NextResponse.json({ error: "storeId required" }, { status: 400 })
  const store = await requireLaborStore(ctx, storeId)
  if ("error" in store) return store.error
  await prisma.laborSettings.deleteMany({ where: { organizationId: ctx.org.id, storeId } })
  return NextResponse.json({ ok: true })
}
