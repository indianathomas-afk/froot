import type { IngredientNutrition, Prisma } from "@prisma/client"
import { prisma, type Db } from "@/lib/prisma"
import { NUTRIENT_KEYS } from "@/lib/nutrition"
import { isDownloadOnly } from "@/lib/nutrition-files"
import { proofState, staleAt } from "@/lib/nutrition-proof"
import type { NutritionContext } from "@/lib/nutrition-access"

// ─── One ingredient's nutrition, as every /api/nutrition/ingredients/[id]*
// route returns it (N-1b) ──────────────────────────────────────────────────────
// The blob URL, pathname and hash never leave the server: the document is
// reached only through GET …/label, which authorizes and then presigns.

export const INGREDIENT_SELECT = {
  id: true,
  name: true,
  brand: true,
  kind: true,
  reportingUnit: true,
  nutritionExempt: true,
  allergens: true,
  nutrition: true,
} as const

type Loaded = Prisma.IngredientGetPayload<{ select: typeof INGREDIENT_SELECT }>

export function findOrgIngredient(orgId: string, id: string) {
  return prisma.ingredient.findFirst({ where: { id, organizationId: orgId, deletedAt: null }, select: INGREDIENT_SELECT })
}

function serializeNutrition(n: IngredientNutrition, now: Date, verifiedByName: string | null) {
  return {
    // N1D-F1: null on a proof-only record; proof is then "NONE".
    basisAmount: n.basisAmount,
    basisUnit: n.basisUnit,
    ...Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, n[k]])),
    sourceNote: n.sourceNote,
    sourceUrl: n.sourceUrl,
    status: n.status,
    proof: proofState(n, now),
    verifiedAt: n.verifiedAt,
    verifiedByName,
    staleAt: n.status === "VERIFIED" && n.verifiedAt ? staleAt(n.verifiedAt) : null,
    label: n.labelFileUrl
      ? {
          fileName: n.labelFileName,
          contentType: n.labelContentType,
          sizeBytes: n.labelSizeBytes,
          uploadedAt: n.labelUploadedAt,
          downloadOnly: isDownloadOnly(n.labelContentType),
        }
      : null,
  }
}

export async function serializeIngredient(ing: Loaded, orgId: string, now = new Date()) {
  const n = ing.nutrition
  let verifiedByName: string | null = null
  if (n?.verifiedByUserId) {
    // Org-scoped, never a bare id lookup (CLAUDE.md § Page Conventions).
    const u = await prisma.user.findFirst({
      where: { id: n.verifiedByUserId, organizationId: orgId },
      select: { name: true, email: true },
    })
    verifiedByName = u ? u.name || u.email : null
  }
  return { ...ing, nutrition: n ? serializeNutrition(n, now, verifiedByName) : null }
}

// ─── Audit (Gary, N-1b: "an audit-log entry for every
// upload/replace/remove/verify") ─────────────────────────────────────────────
// Written inside the caller's transaction (the BEV-1 F9 shape the import uses).
export type NutritionAuditAction =
  | "nutrition.label.uploaded"
  | "nutrition.label.replaced"
  | "nutrition.label.removed"
  | "nutrition.verified"
  | "nutrition.unverified"
  | "nutrition.status.reset"
  | "nutrition.record.cleared"
  // N-1c. A read that called the model / one that failed — both count toward
  // the per-org rate limit; a reuse of a result for the same file does not.
  | "nutrition.label.read"
  | "nutrition.label.read.failed"
  | "nutrition.label.read.reused"
  | "nutrition.label.applied"
  // N-1e: the label inbox (audit § F). Reads of an inbox file use the three
  // read actions above with entityType INBOX_ENTITY, so they count toward the
  // same per-org limit (label-read-run.ts).
  | "nutrition.inbox.uploaded"
  | "nutrition.inbox.fetched"
  | "nutrition.inbox.fetch.failed"
  | "nutrition.inbox.assigned"
  | "nutrition.inbox.discarded"

/** entityType of an inbox item's audit rows (N-1e). */
export const INBOX_ENTITY = "NutritionLabelInbox"
export type NutritionAuditEntity = "Ingredient" | typeof INBOX_ENTITY

export function nutritionAudit(
  tx: Db,
  ctx: Pick<NutritionContext, "org" | "dbUser">,
  action: NutritionAuditAction,
  entityId: string | null,
  metadata: Prisma.InputJsonValue,
  entityType: NutritionAuditEntity = "Ingredient"
) {
  return tx.auditLog.create({
    data: {
      organizationId: ctx.org.id,
      userId: ctx.dbUser?.clerkUserId ?? null,
      action,
      entityType,
      entityId,
      metadata,
    },
  })
}
