import type { Allergen } from "@prisma/client"
import { compatibleUnits, unitDimension } from "@/lib/units"

// ─── Ingredient nutrition vocabulary (N-1) ───────────────────────────────────
// PURE — no database. Shared by the nutrition engine, the ingredient dialog's
// save route and the CSV import, so the three can never disagree on what a
// valid record is. Rulings: docs/DECISIONS.md 2026-11-01 N-1 (F1–F6, R-1–R-4).

// The FDA Nutrition Facts set, in label order. Keys are IngredientNutrition
// column names.
export const NUTRIENTS = [
  { key: "calories", label: "Calories", unit: "kcal", csv: "calories" },
  { key: "totalFatG", label: "Total fat", unit: "g", csv: "total_fat_g" },
  { key: "saturatedFatG", label: "Saturated fat", unit: "g", csv: "saturated_fat_g" },
  { key: "transFatG", label: "Trans fat", unit: "g", csv: "trans_fat_g" },
  { key: "cholesterolMg", label: "Cholesterol", unit: "mg", csv: "cholesterol_mg" },
  { key: "sodiumMg", label: "Sodium", unit: "mg", csv: "sodium_mg" },
  { key: "totalCarbG", label: "Total carbohydrate", unit: "g", csv: "total_carb_g" },
  { key: "dietaryFiberG", label: "Dietary fiber", unit: "g", csv: "dietary_fiber_g" },
  { key: "totalSugarsG", label: "Total sugars", unit: "g", csv: "total_sugars_g" },
  { key: "addedSugarsG", label: "Added sugars", unit: "g", csv: "added_sugars_g" },
  { key: "proteinG", label: "Protein", unit: "g", csv: "protein_g" },
  { key: "vitaminDMcg", label: "Vitamin D", unit: "mcg", csv: "vitamin_d_mcg" },
  { key: "calciumMg", label: "Calcium", unit: "mg", csv: "calcium_mg" },
  { key: "ironMg", label: "Iron", unit: "mg", csv: "iron_mg" },
  { key: "potassiumMg", label: "Potassium", unit: "mg", csv: "potassium_mg" },
] as const

export type NutrientKey = (typeof NUTRIENTS)[number]["key"]
export const NUTRIENT_KEYS: NutrientKey[] = NUTRIENTS.map((n) => n.key)

/** null = unknown. Unknown is never zero (N1-F5). */
export type NutrientValues = Record<NutrientKey, number | null>

export function emptyNutrients(fill: number | null): NutrientValues {
  return Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, fill])) as NutrientValues
}

// The FDA major nine, in statute order. Values are the Prisma enum.
export const ALLERGENS = [
  { value: "MILK", label: "Milk" },
  { value: "EGGS", label: "Eggs" },
  { value: "FISH", label: "Fish" },
  { value: "CRUSTACEAN_SHELLFISH", label: "Crustacean shellfish" },
  { value: "TREE_NUTS", label: "Tree nuts" },
  { value: "PEANUTS", label: "Peanuts" },
  { value: "WHEAT", label: "Wheat" },
  { value: "SOYBEANS", label: "Soybeans" },
  { value: "SESAME", label: "Sesame" },
] as const satisfies readonly { value: Allergen; label: string }[]

const ALLERGEN_ORDER = new Map<string, number>(ALLERGENS.map((a, i) => [a.value, i]))
export function sortAllergens(list: Iterable<Allergen>): Allergen[] {
  return [...new Set(list)].sort((a, b) => (ALLERGEN_ORDER.get(a) ?? 99) - (ALLERGEN_ORDER.get(b) ?? 99))
}
export function allergenLabel(a: Allergen): string {
  return ALLERGENS.find((x) => x.value === a)?.label ?? a
}

// ─── Basis unit (N1-F1) ───────────────────────────────────────────────────────
// Values are per an amount in the ingredient's OWN dimension — no density, so
// a weight label on a volume-counted ingredient is converted by hand. Count
// units never convert, so a count ingredient's basis unit IS its reporting unit.

export function allowedBasisUnits(reportingUnit: string): string[] {
  return compatibleUnits(reportingUnit)
}

export function basisUnitError(basisUnit: string, reportingUnit: string): string | null {
  if (unitDimension(basisUnit) === null) return `Unknown unit "${basisUnit}"`
  if (allowedBasisUnits(reportingUnit).includes(basisUnit)) return null
  if (unitDimension(reportingUnit) === "count") {
    return `This ingredient is counted in ${reportingUnit}, so nutrition must be per ${reportingUnit}`
  }
  return `"${basisUnit}" isn't a ${unitDimension(reportingUnit)} unit — nutrition must be per a ${unitDimension(reportingUnit)} amount (${allowedBasisUnits(reportingUnit).join(", ")})`
}

export type NutritionInput = {
  basisAmount: number
  basisUnit: string
  values: NutrientValues
  sourceNote: string | null
}

// One validator for every write path. Returns the first problem, or null.
export function nutritionInputError(input: NutritionInput, reportingUnit: string): string | null {
  if (!Number.isFinite(input.basisAmount) || input.basisAmount <= 0) return "Basis amount must be greater than 0"
  const unitErr = basisUnitError(input.basisUnit, reportingUnit)
  if (unitErr) return unitErr
  for (const n of NUTRIENTS) {
    const v = input.values[n.key]
    if (v === null) continue
    if (!Number.isFinite(v) || v < 0) return `${n.label} must be a number of 0 or more`
  }
  return null
}

// "brand name" when there is a brand — the form BEV-1 F5 matches on.
export function ingredientDisplayName(i: { brand: string | null; name: string }): string {
  return i.brand && i.brand.trim() ? `${i.brand.trim()} ${i.name}` : i.name
}
