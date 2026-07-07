import type { Ingredient, IngredientCategory, Vendor, VendorIngredient } from "@prisma/client"

type IngredientWithRelations = Ingredient & {
  category: IngredientCategory | null
  vendorIngredients: (VendorIngredient & { vendor: Vendor })[]
}

export function effectiveGlCode(ingredient: {
  glCodeOverride: string | null
  category: { glCode: string | null } | null
}): string | null {
  return ingredient.glCodeOverride ?? ingredient.category?.glCode ?? null
}

export function serializeIngredient(ingredient: IngredientWithRelations, editedByName: string | null) {
  const vendorPrices = ingredient.vendorIngredients.map((vi) => ({
    vendorId: vi.vendorId,
    vendorName: vi.vendor.name,
    costPerReportingUnit:
      vi.casePrice != null
        ? vi.unitsPerCase && vi.unitsPerCase > 0
          ? vi.casePrice / vi.unitsPerCase
          : vi.casePrice
        : null,
  }))
  const cheapestVendorPrice = vendorPrices.reduce<number | null>((min, v) => {
    if (v.costPerReportingUnit == null) return min
    if (min == null || v.costPerReportingUnit < min) return v.costPerReportingUnit
    return min
  }, null)

  return {
    id: ingredient.id,
    brand: ingredient.brand,
    name: ingredient.name,
    categoryId: ingredient.categoryId,
    categoryName: ingredient.category?.name ?? null,
    categoryGlCode: ingredient.category?.glCode ?? null,
    subcategory: ingredient.subcategory,
    sku: ingredient.sku,
    purchaseUnitLabel: ingredient.purchaseUnitLabel,
    packDescription: ingredient.packDescription,
    purchaseCost: ingredient.purchaseCost,
    reportingUnit: ingredient.reportingUnit,
    unitsPerPurchase: ingredient.unitsPerPurchase,
    costPerReportingUnit: ingredient.costPerReportingUnit,
    glCodeOverride: ingredient.glCodeOverride,
    effectiveGlCode: effectiveGlCode(ingredient),
    productNote: ingredient.productNote,
    isActive: ingredient.isActive,
    isArchived: ingredient.isArchived,
    deletedAt: ingredient.deletedAt ? ingredient.deletedAt.toISOString() : null,
    lastEditedByUserId: ingredient.lastEditedByUserId,
    lastEditedByName: editedByName,
    kind: ingredient.kind,
    notes: ingredient.notes,
    vendorNames: vendorPrices.map((v) => v.vendorName),
    vendorPriceDisplay: vendorPrices.length === 0 ? null : vendorPrices.length === 1 ? vendorPrices[0].costPerReportingUnit : cheapestVendorPrice,
    vendorCount: vendorPrices.length,
    createdAt: ingredient.createdAt.toISOString(),
    updatedAt: ingredient.updatedAt.toISOString(),
  }
}

export type SerializedIngredient = ReturnType<typeof serializeIngredient>
