import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { convert } from "@/lib/units"
import { getCurrentUser, requireModule } from "@/lib/auth"
import { auth } from "@clerk/nextjs/server"

// ─── Shared helpers for the adjustments API (Phase I-6) ──────────────────────
// InventoryAdjustment.quantity is the SIGNED stock effect: users always enter
// positive quantities; these helpers apply the sign per type.

export const ADJUSTMENT_TYPES = [
  "WASTE",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "COMP",
  "CORRECTION",
  "PREP_CONSUME",
  "PREP_PRODUCE",
] as const
export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number]

export const ADJUSTMENT_SIGN: Record<AdjustmentType, 1 | -1> = {
  WASTE: -1,
  COMP: -1,
  TRANSFER_OUT: -1,
  PREP_CONSUME: -1,
  TRANSFER_IN: 1,
  PREP_PRODUCE: 1,
  CORRECTION: 1, // corrections keep the sign the caller provides
}

// Converts a user-entered quantity to the ingredient's reporting unit.
// null = dimension mismatch — surface it, never fall back to 0.
export function qtyInReportingUnits(
  ingredient: { reportingUnit: string },
  quantity: number,
  unit: string | undefined
): number | null {
  if (!unit || unit === ingredient.reportingUnit) return quantity
  return convert(quantity, unit, ingredient.reportingUnit)
}

export type AdjustmentRowInput = {
  organizationId: string
  storeId: string
  ingredient: { id: string; name: string; reportingUnit: string; costPerReportingUnit: number }
  type: AdjustmentType
  /** already in reporting units, positive (except CORRECTION which may be signed) */
  quantity: number
  reason?: string | null
  lossReasonId?: string | null
  groupId?: string | null
  occurredAt: Date
  createdByUserId: string
}

export function buildAdjustmentRow(input: AdjustmentRowInput) {
  const signed = input.type === "CORRECTION" ? input.quantity : Math.abs(input.quantity) * ADJUSTMENT_SIGN[input.type]
  return {
    organizationId: input.organizationId,
    storeId: input.storeId,
    ingredientId: input.ingredient.id,
    ingredientName: input.ingredient.name,
    type: input.type,
    quantity: signed,
    costPerReportingUnit: input.ingredient.costPerReportingUnit,
    value: signed * input.ingredient.costPerReportingUnit,
    reason: input.reason ?? null,
    lossReasonId: input.lossReasonId ?? null,
    groupId: input.groupId ?? null,
    occurredAt: input.occurredAt,
    createdByUserId: input.createdByUserId,
  }
}

// Shared route preamble: auth → org → module → store scope. Returns a
// NextResponse on failure, context on success.
export async function adjustmentRouteContext() {
  const { orgId } = await auth()
  if (!orgId) return { fail: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return { fail: NextResponse.json({ error: "Org not found" }, { status: 404 }) }

  try {
    await requireModule("inventory")
  } catch {
    return { fail: NextResponse.json({ error: "MODULE_NOT_ACTIVE" }, { status: 403 }) }
  }

  const { dbUser } = await getCurrentUser()
  if (!dbUser) return { fail: NextResponse.json({ error: "User not found" }, { status: 404 }) }
  const scope = {
    isAdmin: dbUser.role === "ADMIN",
    isManagerOrAdmin: dbUser.role === "ADMIN" || dbUser.role === "MANAGER",
    storeIds: dbUser.storeAssignments.map((a) => a.storeId),
  }
  return { org, scope, dbUser }
}

export function canAccessStore(scope: { isAdmin: boolean; storeIds: string[] }, storeId: string): boolean {
  return scope.isAdmin || scope.storeIds.includes(storeId)
}

export const DEFAULT_LOSS_REASONS = ["Spoilage", "Breakage", "Comp", "Theft/Unknown"]

// Idempotent per org — seeds the four defaults on first read.
export async function ensureDefaultLossReasons(organizationId: string) {
  const count = await prisma.lossReason.count({ where: { organizationId } })
  if (count > 0) return
  await prisma.lossReason.createMany({
    data: DEFAULT_LOSS_REASONS.map((label, i) => ({ organizationId, label, isDefault: true, sortOrder: i })),
    skipDuplicates: true,
  })
}
