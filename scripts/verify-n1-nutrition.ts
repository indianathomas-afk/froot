/**
 * N-1 — ingredient nutrition computed through recipes, pinned.
 *
 *   npx tsx scripts/verify-n1-nutrition.ts
 *
 * PURE. No database: a synthetic recipe graph and CSV are BUILT IN CODE and run
 * through the same functions the pages and routes call
 * (computeRecipeNutrition, rankBlockers, parseNutritionCsv,
 * planNutritionImport). Every name is invented; no Keva data is in the repo.
 *
 * WHAT THIS CAN DETECT, so a green run means something:
 *   - Sub-recipe yield division, prepared-through-source, and unit conversion
 *     across fl. oz / oz (dry) / g / lbs / each / tbsp — exact numbers.
 *   - N1-F5: a missing nutrient makes THAT nutrient incomplete while the others
 *     still sum; a missing record makes every nutrient incomplete; a loop or a
 *     conversion failure makes every nutrient incomplete.
 *   - N1-F2: a not-food line contributes nothing and never blocks completeness.
 *   - Allergen union through a sub-recipe, in statute order.
 *   - The "To fix" ranking, and the completeness counts the menu page shows.
 *   - The CSV matcher: brand + name and name-only (BEV-1 F5 folding),
 *     unmatched / ambiguous / duplicate / invalid rows reported, prepared
 *     ingredients refused, blank cells stay unknown (never zero).
 *   - R-1: tbsp / tsp / mL convert, and are kept out of REPORTING_UNITS.
 *
 * WHAT IT CANNOT DETECT: that the routes refuse a MANAGER's write or a STAFF
 * read, that the apply transaction writes the rows, or how real ingredients
 * match a real file. Those are Gary's staging pass (R-3) and the
 * PRE-PUSH-CHECK.
 */
import type { Allergen } from "@prisma/client"
import type { GraphLine, GraphRecipe } from "../src/lib/recipe-cost"
import { REPORTING_UNITS, convert } from "../src/lib/units"
import { NUTRIENTS, NUTRIENT_KEYS, basisUnitError, type NutrientKey, type NutrientValues } from "../src/lib/nutrition"
import { parseNutritionCsv, planNutritionImport, type PlanIngredientRef } from "../src/lib/nutrition-import"
import {
  computeRecipeNutrition, incompleteNutrients, rankBlockers,
  type NutritionGraph, type NutritionIngredient,
} from "../src/lib/recipe-nutrition"

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`}`)
}
// Floating point: equal to 1e-9, reported at full precision.
function near(label: string, actual: number | null | undefined, expected: number) {
  const ok = typeof actual === "number" && Math.abs(actual - expected) < 1e-9
  if (!ok) failures++
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `\n    expected ${expected}\n    actual   ${actual}`}`)
}

// ─── 1. Units (R-1) and basis rules (F1) ─────────────────────────────────────
check("1a. 2 tbsp = 1 fl. oz", convert(2, "tbsp", "fl. oz"), 1)
near("1b. 1 cup = 48 tsp", convert(1, "cup", "tsp"), 48)
near("1c. 1 L = 1000 mL", convert(1, "L", "mL"), 1000)
check("1d. label units are not reporting units; cup still is", ["tbsp", "tsp", "mL", "cup"].map((u) => REPORTING_UNITS.includes(u)), [false, false, false, true])
check("1e. weight basis in g for an oz (dry) ingredient is fine", basisUnitError("g", "oz (dry)"), null)
check("1f. volume basis for a weight ingredient is refused (no density)", basisUnitError("tbsp", "oz (dry)") !== null, true)
check("1g. count ingredient: basis must be its own unit", [basisUnitError("each", "each"), basisUnitError("serving", "each") !== null, basisUnitError("g", "each") !== null], [null, true, true])

// ─── 2. A synthetic graph ─────────────────────────────────────────────────────
// Nutrients not named are a KNOWN zero; null marks a genuinely unknown value.
function vals(partial: Partial<Record<NutrientKey, number | null>>): NutrientValues {
  return Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, k in partial ? partial[k]! : 0])) as NutrientValues
}
function ing(
  id: string, name: string, reportingUnit: string,
  opts: { brand?: string; exempt?: boolean; allergens?: Allergen[]; basis?: [number, string]; values?: NutrientValues; preparedFrom?: string } = {}
): NutritionIngredient {
  return {
    id, name, reportingUnit, brand: opts.brand ?? null,
    costPerReportingUnit: 0, kind: opts.preparedFrom ? "PREPARED" : "PURCHASED",
    preparedFromRecipeId: opts.preparedFrom ?? null, isActive: true, isArchived: false,
    nutritionExempt: opts.exempt ?? false, allergens: opts.allergens ?? [],
    nutrition: opts.basis ? { basisAmount: opts.basis[0], basisUnit: opts.basis[1], values: opts.values ?? vals({}) } : null,
  }
}
let lineSeq = 0
const ingLine = (ingredientId: string, amount: number, unit: string): GraphLine => ({ id: `l${++lineSeq}`, ingredientId, subRecipeId: null, amount, unit, sortOrder: lineSeq })
const subLine = (subRecipeId: string, amount: number, unit: string): GraphLine => ({ id: `l${++lineSeq}`, ingredientId: null, subRecipeId, amount, unit, sortOrder: lineSeq })
function recipe(id: string, lines: GraphLine[], yieldQty = 1, yieldUnit = "serving", salesItemId: string | null = `si-${id}`): GraphRecipe {
  return { id, name: id, salesItemId, yieldQty, yieldUnit, servingSizeQty: null, servingSizeUnit: null, isActive: true, lines }
}

const ingredients = [
  ing("juice", "Raspberry Juice Blend", "fl. oz", { basis: [8, "fl. oz"], values: vals({ calories: 120, totalSugarsG: 28, sodiumMg: 10, proteinG: 1 }) }),
  ing("almond", "Almond Butter", "oz (dry)", { brand: "Justin's", allergens: ["TREE_NUTS"], basis: [2, "oz (dry)"], values: vals({ calories: 190, totalFatG: 16, proteinG: 7, totalSugarsG: 2 }) }),
  ing("banana", "Bananas (sliced)", "oz (dry)", { basis: [28, "g"], values: vals({ calories: 25, totalSugarsG: 3.4, potassiumMg: 100, proteinG: 0.3 }) }),
  // transFatG unknown on the label → the smoothie's trans fat is incomplete.
  ing("yogurt", "Froyo Base", "lbs", { allergens: ["MILK"], basis: [4, "oz (dry)"], values: vals({ calories: 100, proteinG: 4, calciumMg: 150, transFatG: null }) }),
  ing("cup", "Cup Kit - 32oz", "each", { exempt: true }),
  ing("whey", "Whey Scoop", "each", { allergens: ["SOYBEANS"], basis: [1, "each"], values: vals({ calories: 110, proteinG: 24 }) }),
  ing("honey", "Honey", "fl. oz"), // no record at all
  // Prepared: its own record must be IGNORED — nutrition comes through "puree".
  ing("prep", "Strawberry Puree", "fl. oz", { preparedFrom: "puree", basis: [1, "fl. oz"], values: vals({ calories: 9999 }) }),
]

const recipes = [
  recipe("berry-base", [ingLine("juice", 24, "fl. oz"), ingLine("almond", 4, "oz (dry)")], 32, "fl. oz", null),
  recipe("smoothie", [
    subLine("berry-base", 16, "fl. oz"),
    ingLine("banana", 0.25, "lbs"),
    ingLine("yogurt", 8, "oz (dry)"),
    ingLine("cup", 1, "each"),
    ingLine("whey", 1, "each"),
  ]),
  recipe("honey-shot", [ingLine("honey", 2, "tbsp"), ingLine("juice", 1, "tbsp")]),
  recipe("puree", [ingLine("juice", 16, "fl. oz")], 16, "fl. oz", null),
  recipe("puree-cup", [ingLine("prep", 4, "fl. oz")]),
  recipe("loop-a", [subLine("loop-b", 1, "serving")]),
  recipe("loop-b", [subLine("loop-a", 1, "serving")]),
  recipe("bad-unit", [ingLine("juice", 1, "each"), ingLine("whey", 1, "each")]),
  recipe("cup-only", [ingLine("cup", 1, "each")]),
]

const graph: NutritionGraph = {
  recipes: new Map(recipes.map((r) => [r.id, r])),
  ingredients: new Map(ingredients.map((i) => [i.id, i])),
}

// ─── 3. Sub-recipe + yield + mixed units + not-food + a missing nutrient ─────
const base = computeRecipeNutrition(graph, "berry-base")
check("3a. Berry Base: juice ×3 + almond butter ×2 → 740 kcal, complete", [base.totals.calories, base.complete], [740, true])

const s = computeRecipeNutrition(graph, "smoothie")
const bananaFactor = (4 / 0.035274) / 28 // 0.25 lbs = 4 oz (dry), in g, per 28 g
near("3b. smoothie calories = 370 (half the base) + banana + 200 (yogurt ×2) + 110 (whey)", s.totals.calories, 370 + 25 * bananaFactor + 200 + 110)
near("3c. protein = 8.5 + 0.3×banana + 8 + 24", s.totals.proteinG, 8.5 + 0.3 * bananaFactor + 8 + 24)
near("3d. sugars = 44 (half of 84 + 4) + 3.4×banana", s.totals.totalSugarsG, 44 + 3.4 * bananaFactor)
near("3e. potassium through lbs → g", s.totals.potassiumMg, 100 * bananaFactor)
near("3f. calcium = yogurt ×2", s.totals.calciumMg, 300)
check("3g. trans fat INCOMPLETE (yogurt lacks it); everything else sums", incompleteNutrients(s), ["transFatG"])
check("3h. smoothie is not complete", s.complete, false)
check("3i. allergens: tree nuts via the sub-recipe + milk + soybeans, statute order", s.allergens, ["MILK", "TREE_NUTS", "SOYBEANS"])
check("3j. the cup kit is not food: 5 food ingredients, none missing", [s.foodIngredientIds.size, s.missingIngredientIds.size], [5, 0])
check("3k. yogurt is the partial ingredient, missing trans fat", [...s.partialIngredients], [["yogurt", ["transFatG"]]])
check("3l. line statuses", s.lines.map((l) => l.status), ["ok", "ok", "partial", "exempt", "ok"])
check("3m. the not-food line contributes nothing", s.lines[3].contribution, null)

// ─── 4. A missing record ──────────────────────────────────────────────────────
const h = computeRecipeNutrition(graph, "honey-shot")
check("4a. honey has no record → every nutrient incomplete", NUTRIENT_KEYS.every((k) => h.totals[k] === null), true)
check("4b. 1 of 2 ingredients have nutrition", [h.foodIngredientIds.size - h.missingIngredientIds.size, h.foodIngredientIds.size], [1, 2])
near("4c. the juice line still computes: 1 tbsp = 0.5 fl. oz = 7.5 kcal", h.lines[1].contribution?.calories, 7.5)
check("4d. the honey line is 'missing', not an error", [h.lines[0].status, h.error], ["missing", null])

// ─── 5. Prepared ingredient, loop, conversion failure, not-food only ─────────
const pc = computeRecipeNutrition(graph, "puree-cup")
near("5a. prepared ingredient computes through its source recipe (240 kcal / 16 fl. oz × 4)", pc.totals.calories, 60)
check("5b. … its own (9999) record is ignored, and it is not a food ingredient itself", [pc.foodIngredientIds.has("prep"), [...pc.foodIngredientIds]], [false, ["juice"]])
const lp = computeRecipeNutrition(graph, "loop-a")
check("5c. a loop marks every nutrient incomplete", [NUTRIENT_KEYS.every((k) => lp.totals[k] === null), lp.error?.startsWith("A loop was detected"), lp.complete], [true, true, false])
const bu = computeRecipeNutrition(graph, "bad-unit")
check("5d. a conversion failure marks every nutrient incomplete — even the whey that converted", [NUTRIENT_KEYS.every((k) => bu.totals[k] === null), bu.error], [true, "Can't convert each to fl. oz (the nutrition basis of \"Raspberry Juice Blend\")"])
const co = computeRecipeNutrition(graph, "cup-only")
check("5e. a recipe of only not-food lines is complete at zero", [co.complete, co.totals.calories, co.foodIngredientIds.size], [true, 0, 0])

// ─── 6. "To fix" ranking ─────────────────────────────────────────────────────
const smoothie2 = { ...s, recipeId: "smoothie-2" } // a second item blocked by yogurt
check(
  "6a. missing records rank before partial ones; then by items blocked",
  rankBlockers([s, h, smoothie2]).map((b) => [b.ingredientId, b.kind, b.itemCount, b.missingNutrients]),
  [["honey", "missing", 1, []], ["yogurt", "partial", 2, ["transFatG"]]]
)

// ─── 7. CSV matcher (deliverable 4) ──────────────────────────────────────────
const refs: PlanIngredientRef[] = [
  { id: "almond", name: "Almond Butter", brand: "Justin's", reportingUnit: "oz (dry)", kind: "PURCHASED", hasNutrition: false },
  { id: "juice", name: "Raspberry Juice Blend", brand: null, reportingUnit: "fl. oz", kind: "PURCHASED", hasNutrition: true },
  { id: "syrup1", name: "Simple Syrup", brand: null, reportingUnit: "fl. oz", kind: "PURCHASED", hasNutrition: false },
  { id: "syrup2", name: "simple  syrup", brand: null, reportingUnit: "fl. oz", kind: "PURCHASED", hasNutrition: false },
  { id: "cup", name: "Cup Kit - 32oz", brand: null, reportingUnit: "each", kind: "PURCHASED", hasNutrition: false },
  { id: "whey", name: "Whey Scoop", brand: null, reportingUnit: "each", kind: "PURCHASED", hasNutrition: false },
  { id: "prep", name: "Strawberry Puree", brand: null, reportingUnit: "fl. oz", kind: "PREPARED", hasNutrition: false },
]
const header = ["Name", "Brand", "Basis Amount", "Basis Unit", ...NUTRIENTS.map((n) => n.csv), "Allergens", "Not Food", "Source"]
const csvRow = (o: Record<string, string>) =>
  ["name", "brand", "basis_amount", "basis_unit", ...NUTRIENTS.map((n) => n.csv), "allergens", "not_food", "source"]
    .map((k) => `"${(o[k] ?? "").replace(/"/g, '""')}"`)
    .join(",")
const csvText = [
  header.join(","),
  csvRow({ name: "  justin's   ALMOND butter ", basis_amount: "2", basis_unit: "oz (dry)", calories: "190", total_fat_g: "16", allergens: "Tree nuts", source: "label" }),
  csvRow({ name: "Almond Butter", brand: "Justin's", basis_amount: "2", basis_unit: "oz (dry)", calories: "1" }),
  csvRow({ name: "RASPBERRY juice blend", basis_amount: "8", basis_unit: "fl. oz", calories: "120" }),
  csvRow({ name: "Mango Puree", basis_amount: "1", basis_unit: "fl. oz", calories: "20" }),
  csvRow({ name: "Simple Syrup", basis_amount: "1", basis_unit: "fl. oz", calories: "50" }),
  csvRow({ name: "Cup Kit - 32oz", not_food: "yes" }),
  csvRow({ name: "Whey Scoop", basis_amount: "30", basis_unit: "g", calories: "110" }),
  csvRow({ name: "Strawberry Puree", basis_amount: "1", basis_unit: "fl. oz", calories: "15" }),
  csvRow({ name: "Raspberry Juice Blend ", basis_amount: "8", basis_unit: "fl. oz" }),
].join("\n")

const parsedCsv = parseNutritionCsv(csvText)
check("7a. headers fold (case/space) to the documented names", parsedCsv.headers.slice(0, 4), ["name", "brand", "basis_amount", "basis_unit"])
const plan = planNutritionImport(parsedCsv, refs)
check(
  "7b. per-row status",
  plan.map((p) => [p.rowNumber, p.status, p.ingredientId]),
  [
    [1, "NEW", "almond"], // brand + name, case/space folded, in the name column
    [2, "DUPLICATE", "almond"], // brand column + name → the same ingredient
    [3, "UPDATE", "juice"], // existing record → replaced
    [4, "UNMATCHED", null],
    [5, "AMBIGUOUS", null], // two ingredients fold to "simple syrup"
    [6, "NOT_FOOD", "cup"],
    [7, "INVALID", "whey"], // count ingredient, basis in g
    [8, "INVALID", "prep"], // prepared: computed from its recipe
    [9, "DUPLICATE", "juice"], // trailing space folds to row 3's ingredient
  ]
)
const r1 = plan[0].write?.nutrition
check("7c. row 1 values: given numbers kept, blank cells stay UNKNOWN (null, never 0)", [r1?.values.calories, r1?.values.totalFatG, r1?.values.proteinG, r1?.sourceNote], [190, 16, null, "label"])
check("7d. row 1 allergens parsed", plan[0].write?.allergens, ["TREE_NUTS"])
check("7e. not-food row writes the flag and no nutrition", plan[5].write, { nutrition: null, allergens: [], nutritionExempt: true })
check("7f. the count-unit refusal says why", plan[6].detail, "This ingredient is counted in each, so nutrition must be per each")
const badAllergen = planNutritionImport(parseNutritionCsv([header.join(","), csvRow({ name: "Whey Scoop", basis_amount: "1", basis_unit: "each", allergens: "gluten" })].join("\n")), refs)
check("7g. an unknown allergen is INVALID, not dropped", [badAllergen[0].status, badAllergen[0].detail], ["INVALID", 'Unknown allergen "gluten"'])
const noAllergenCol = planNutritionImport(parseNutritionCsv("name,basis_amount,basis_unit,calories\nWhey Scoop,1,each,110"), refs)
check("7h. no allergens column → allergens left as they are (null), not cleared", [noAllergenCol[0].status, noAllergenCol[0].write?.allergens], ["NEW", null])
check("7i. a file with no name column is refused", parseNutritionCsv("ingredient,calories\nx,1").error, 'The file needs a "name" column')

console.log(failures === 0 ? "\n✓ ALL PASS\n" : `\n✗ ${failures} CHECK(S) FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
