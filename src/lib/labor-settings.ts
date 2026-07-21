import { prisma } from "@/lib/prisma"

// Resolved labor settings for a store (Phase 3, per-store): the store's own
// LaborSettings row wins field-by-field over the org default (storeId null),
// which falls back to the schema defaults. Money is dollars.

export type ResolvedLaborSettings = {
  laborTargetPct: number
  roundingIncrement: number
  plannedBlendedRate: number | null
  gmOnFloorStartMinutes: number | null // null = derive open→14:00 from StoreHours
  gmOnFloorEndMinutes: number | null
  source: "store" | "org" | "default"
}

const DEFAULTS = { laborTargetPct: 20, roundingIncrement: 1000 }

export async function resolveLaborSettings(organizationId: string, storeId: string): Promise<ResolvedLaborSettings> {
  const [storeRow, orgRow] = await Promise.all([
    prisma.laborSettings.findFirst({ where: { organizationId, storeId } }),
    prisma.laborSettings.findFirst({ where: { organizationId, storeId: null } }),
  ])
  const row = storeRow ?? orgRow
  return {
    laborTargetPct: row ? Number(row.laborTargetPct) : DEFAULTS.laborTargetPct,
    roundingIncrement: row ? Number(row.roundingIncrement) : DEFAULTS.roundingIncrement,
    plannedBlendedRate: row?.plannedBlendedRate == null ? null : Number(row.plannedBlendedRate),
    gmOnFloorStartMinutes: row?.gmOnFloorStartMinutes ?? null,
    gmOnFloorEndMinutes: row?.gmOnFloorEndMinutes ?? null,
    source: storeRow ? "store" : orgRow ? "org" : "default",
  }
}
