import type { Allergen, Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import type { NutrientValues } from "@/lib/nutrition"
import { resolveServing, type ItemOverride, type ServingSpec } from "@/lib/nutrition-label"
import { itemVerification, type ItemVerification } from "@/lib/nutrition-proof"
import { computeRecipeNutrition, loadNutritionGraph } from "@/lib/recipe-nutrition"

// ─── N-2 serving settings, loaded ─────────────────────────────────────────────
// The database half of src/lib/nutrition-label.ts's resolveServing: the org's
// drink serving size, its size table and the per-item overrides. Resolution
// itself stays pure.

export type ServingSettings = {
  /** null = DEFAULT_SERVING_FL_OZ */
  orgServingFlOz: number | null
  /** exact Square variation name → fl oz (F3, F6) */
  sizeTable: Map<string, number>
}

// `db` lets scripts/verify-n2-label.ts read inside its rolled-back transaction.
export async function loadServingSettings(organizationId: string, db: Prisma.TransactionClient = prisma): Promise<ServingSettings> {
  const [org, sizes] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { nutritionServingFlOz: true } }),
    db.nutritionSizeVolume.findMany({ where: { organizationId }, select: { variationName: true, volumeFlOz: true } }),
  ])
  return {
    orgServingFlOz: org?.nutritionServingFlOz ?? null,
    sizeTable: new Map(sizes.map((s) => [s.variationName, s.volumeFlOz])),
  }
}

// Everything one item's label needs: the engine's result for its recipe (the
// one calculation path) and its resolved serving. null = the sales item is not
// in this org, or has no recipe — there is nothing to label.
export type ItemLabelData = {
  salesItemId: string
  displayName: string
  variationName: string
  menuGroup: string | null
  recipeId: string
  totals: NutrientValues
  allergens: Allergen[]
  error: string | null
  verification: ItemVerification
  spec: ServingSpec
  override: ItemOverride | null
  /** the size table's volume for this item's name, whether or not an override beats it */
  tableVolumeFlOz: number | null
  orgServingFlOz: number | null
}

export async function loadItemLabelData(organizationId: string, salesItemId: string): Promise<ItemLabelData | null> {
  const item = await prisma.salesItem.findFirst({
    where: { id: salesItemId, organizationId },
    select: {
      id: true, displayName: true, variationName: true, menuGroup: true,
      recipe: { select: { id: true } },
      nutritionServing: { select: { perItem: true, volumeFlOz: true, servingFlOz: true } },
    },
  })
  if (!item?.recipe) return null

  const [graph, settings] = await Promise.all([loadNutritionGraph(organizationId), loadServingSettings(organizationId)])
  if (!graph.recipes.has(item.recipe.id)) return null
  const n = computeRecipeNutrition(graph, item.recipe.id)
  const override = item.nutritionServing ?? null

  return {
    salesItemId: item.id,
    displayName: item.displayName,
    variationName: item.variationName,
    menuGroup: item.menuGroup,
    recipeId: item.recipe.id,
    totals: n.totals,
    allergens: n.allergens,
    error: n.error,
    verification: itemVerification(n, (id) => graph.ingredients.get(id)?.proof ?? "NONE"),
    spec: resolveServing({ variationName: item.variationName, orgServingFlOz: settings.orgServingFlOz, sizeTable: settings.sizeTable, override }),
    override,
    tableVolumeFlOz: settings.sizeTable.get(item.variationName) ?? null,
    orgServingFlOz: settings.orgServingFlOz,
  }
}
