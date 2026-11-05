/**
 * N-5 — Square modifiers: sync, modifier recipes, BevSpot modifier import, pinned.
 *
 *   npx tsx scripts/verify-n5-modifiers.ts
 *
 * Rulings: docs/DECISIONS.md 2026-11-03 N-5 (Gary, DRAFT: "Accept all leans"
 * — N5-F1…F8); audit docs/prompts/N-5_AUDIT.md.
 *
 * TWO PARTS.
 *   1–6 PURE: the catalog mapper on a canned /v2/catalog/list payload, the
 *       shared recipe validator, the cost and nutrition engines on a synthetic
 *       graph, the BevSpot planner on a workbook built in code, and source
 *       checks on the routes and pages. Every name is invented.
 *   7   DATABASE: against the database in local .env (dev), inside ONE
 *       transaction that is ALWAYS rolled back. It proves the APPLIED migration
 *       20261103020000_n5_square_modifiers stores lists, modifiers, item links
 *       and a modifier recipe, and that a re-sync sweeps a vanished modifier
 *       to isDeleted while its recipe and Froot's recipeStatus survive.
 *       The branch is printed from `neon.branch_id`, never typed.
 *
 * WHAT THIS CAN DETECT (the prompt's list):
 *   - The sync mapping lists, modifiers and item links wrongly, keeping a
 *     deleted modifier, or keeping a TEXT list.
 *   - A negative line accepted anywhere but a modifier recipe, or refused on
 *     one; a modifier recipe offered or accepted as a sub-recipe line.
 *   - A substitution modifier netting the wrong cost or nutrition; a modifier
 *     that nets negative being clamped; a removal adding an allergen (N5-F6).
 *   - BevSpot rows not resolving to modifiers, a negative leaking onto a sales
 *     or prep recipe, and never-overwrite failing on a re-run.
 *
 * WHAT IT CANNOT DETECT: a real Square payload (the first staging sync is the
 * proof — audit § A2), the routes' role gates and HTTP shapes, and the pages.
 * Those are Gary's staging pass and the production BevSpot preview.
 */
import "dotenv/config"
import { readFileSync } from "node:fs"
import * as XLSX from "xlsx"
import type { Allergen } from "@prisma/client"
import { prisma } from "../src/lib/prisma"
import { mapModifierCatalog, writeModifierCatalogIn, type SquareModifierListObject } from "../src/lib/square-modifier-sync"
import { RecipeLineSchema, validateRecipeLines } from "../src/lib/recipe-api"
import { computeRecipeCost, expandRecipeToIngredients, recipeKind, type CostGraph, type GraphLine, type GraphRecipe } from "../src/lib/recipe-cost"
import { computeRecipeNutrition, type NutritionGraph, type NutritionIngredient } from "../src/lib/recipe-nutrition"
import { NUTRIENT_KEYS, type NutrientKey, type NutrientValues } from "../src/lib/nutrition"
import { parseSalesItemsWorkbook } from "../src/lib/bevspot/parse-sales-items"
import { planBevSpotImport, summarizePlan, type ImportPlan, type PlanIngredient, type PlanModifier, type PlanSalesItem } from "../src/lib/bevspot/plan-import"

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`}`)
}
const r6 = (x: number | null | undefined) => (x === null || x === undefined ? x : Math.round(x * 1e6) / 1e6)

// ─── 1. Sync mapper on a canned catalog payload ──────────────────────────────
const catalogLists: SquareModifierListObject[] = [
  {
    id: "ML-BOOST", type: "MODIFIER_LIST",
    modifier_list_data: {
      name: "N5 Boosts", ordinal: 2,
      modifiers: [
        { id: "MOD-PB", type: "MODIFIER", modifier_data: { name: "N5 Add Peanut Butter", price_money: { amount: 150 }, ordinal: 1 } },
        { id: "MOD-NOBAN", type: "MODIFIER", modifier_data: { name: "N5 No Banana", ordinal: 2, on_by_default: false } },
        { id: "MOD-GONE", type: "MODIFIER", is_deleted: true, modifier_data: { name: "N5 Deleted Boost" } },
      ],
    },
  },
  { id: "ML-NOTE", type: "MODIFIER_LIST", modifier_list_data: { name: "N5 Name on cup", modifier_type: "TEXT" } },
  { id: "ML-DEAD", type: "MODIFIER_LIST", is_deleted: true, modifier_list_data: { name: "N5 Dead list", modifiers: [{ id: "MOD-DEAD", type: "MODIFIER", modifier_data: { name: "x" } }] } },
]
const looseModifiers = [
  { id: "MOD-OAT", type: "MODIFIER", modifier_data: { name: "N5 Sub Oat", modifier_list_id: "ML-BOOST", price_money: { amount: 75 } } },
  { id: "MOD-ORPHAN", type: "MODIFIER", modifier_data: { name: "N5 Orphan", modifier_list_id: "ML-UNKNOWN" } },
]
const catalogItems = [
  { id: "ITEM-SMOOTHIE", item_data: { modifier_list_info: [{ modifier_list_id: "ML-BOOST" }, { modifier_list_id: "ML-NOTE" }] } },
  { id: "ITEM-BOWL", item_data: { modifier_list_info: [{ modifier_list_id: "ML-BOOST", enabled: false }] } },
  { id: "ITEM-OLD", is_deleted: true, item_data: { modifier_list_info: [{ modifier_list_id: "ML-BOOST" }] } },
]
const mapped = mapModifierCatalog(catalogLists, looseModifiers, catalogItems)
check("1a. lists: TEXT and deleted lists dropped", mapped.lists, [{ squareModifierListId: "ML-BOOST", name: "N5 Boosts", ordinal: 2 }])
check(
  "1b. modifiers: nested + loose, deleted and orphaned dropped; price in cents",
  mapped.modifiers.map((m) => [m.squareModifierId, m.squareModifierListId, m.name, m.priceCents, m.onByDefault]),
  [
    ["MOD-PB", "ML-BOOST", "N5 Add Peanut Butter", 150, false],
    ["MOD-NOBAN", "ML-BOOST", "N5 No Banana", null, false],
    ["MOD-OAT", "ML-BOOST", "N5 Sub Oat", 75, false],
  ]
)
check(
  "1c. item links: per ITEM, enabled flag kept, unknown/TEXT lists and deleted items dropped",
  mapped.links,
  [
    { squareItemId: "ITEM-SMOOTHIE", squareModifierListId: "ML-BOOST", enabled: true },
    { squareItemId: "ITEM-BOWL", squareModifierListId: "ML-BOOST", enabled: false },
  ]
)

// ─── 2. A synthetic graph (cost + nutrition) ─────────────────────────────────
function vals(partial: Partial<Record<NutrientKey, number | null>>): NutrientValues {
  return Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, k in partial ? partial[k]! : 0])) as NutrientValues
}
function ing(id: string, name: string, reportingUnit: string, cost: number, allergens: Allergen[], basis: [number, string], values: NutrientValues): NutritionIngredient {
  return {
    id, name, reportingUnit, brand: null, costPerReportingUnit: cost, kind: "PURCHASED", preparedFromRecipeId: null,
    isActive: true, isArchived: false, nutritionExempt: false, allergens,
    nutrition: { basisAmount: basis[0], basisUnit: basis[1], values },
  }
}
const ingredients = [
  ing("yogurt", "Vanilla Yogurt", "fl. oz", 0.2, ["MILK"], [8, "fl. oz"], vals({ calories: 200, totalSugarsG: 30 })),
  ing("oat", "Oatmilk Vanilla", "fl. oz", 0.25, [], [8, "fl. oz"], vals({ calories: 160, totalSugarsG: 20 })),
  ing("redbull", "Red Bull", "fl. oz", 0.3, [], [8.4, "fl. oz"], vals({ calories: 110, totalSugarsG: 27 })),
  ing("pb", "Peanut Butter", "oz (dry)", 0.18, ["PEANUTS"], [1, "oz (dry)"], vals({ calories: 170, totalFatG: 14 })),
  ing("banana", "Bananas", "oz (dry)", 0.05, [], [1, "oz (dry)"], vals({ calories: 25 })),
]
let seq = 0
const line = (ingredientId: string | null, amount: number, unit: string, subRecipeId: string | null = null): GraphLine => ({
  id: `l${++seq}`, ingredientId, subRecipeId, amount, unit, sortOrder: seq,
})
const rec = (id: string, lines: GraphLine[], link: { salesItemId?: string; squareModifierId?: string } = {}): GraphRecipe => ({
  id, name: id, salesItemId: link.salesItemId ?? null, squareModifierId: link.squareModifierId ?? null,
  yieldQty: 1, yieldUnit: "serving", servingSizeQty: null, servingSizeUnit: null, isActive: true, lines,
})
const recipes = [
  rec("smoothie", [line("yogurt", 10, "fl. oz"), line("banana", 1.6, "oz (dry)")], { salesItemId: "si-smoothie" }),
  rec("sub-oat", [line("yogurt", -10, "fl. oz"), line("oat", 10, "fl. oz")], { squareModifierId: "m-oat" }),
  rec("no-redbull", [line("redbull", -8.4, "fl. oz")], { squareModifierId: "m-norb" }),
  rec("add-pb", [line("pb", 1, "oz (dry)")], { squareModifierId: "m-pb" }),
  rec("pb-scoop", [line("pb", 1, "oz (dry)")]),
]
const costGraph: CostGraph = {
  recipes: new Map(recipes.map((r) => [r.id, r])),
  ingredients: new Map(ingredients.map((i) => [i.id, i])),
  preparedByRecipeId: new Map(),
}
const nutritionGraph: NutritionGraph = { recipes: costGraph.recipes, ingredients: new Map(ingredients.map((i) => [i.id, i])) }

check("2a. recipeKind: item / modifier / prep", ["smoothie", "sub-oat", "pb-scoop"].map((id) => recipeKind(costGraph.recipes.get(id)!)), ["item", "modifier", "prep"])

// ─── 3. Negative lines: modifier recipes only (N5-F2, N5-F8) ─────────────────
check("3a. RecipeLineSchema accepts a negative amount (the validator decides)", RecipeLineSchema.safeParse({ ingredientId: "yogurt", amount: -10, unit: "fl. oz" }).success, true)
check("3b. RecipeLineSchema refuses zero", RecipeLineSchema.safeParse({ ingredientId: "yogurt", amount: 0, unit: "fl. oz" }).success, false)
check("3c. negative line accepted on a modifier recipe", validateRecipeLines(costGraph, rec("cand-mod", [line("banana", -1.6, "oz (dry)")], { squareModifierId: "m-new" })), null)
const onItem = validateRecipeLines(costGraph, rec("cand-item", [line("banana", -1.6, "oz (dry)")], { salesItemId: "si-new" }))
check("3d. negative line refused on a menu-item recipe", onItem?.lineErrors?.[0]?.error, "Only modifier recipes can have negative amounts (removals and swaps)")
const onPrep = validateRecipeLines(costGraph, rec("cand-prep", [line("banana", -1.6, "oz (dry)")]))
check("3e. negative line refused on a prep recipe", onPrep?.lineErrors?.[0]?.error, "Only modifier recipes can have negative amounts (removals and swaps)")
check("3f. positive lines on an item recipe still pass", validateRecipeLines(costGraph, rec("cand-ok", [line("banana", 1.6, "oz (dry)")], { salesItemId: "si-new" })), null)
const asSub = validateRecipeLines(costGraph, rec("cand-uses-mod", [line(null, 1, "serving", "sub-oat")], { salesItemId: "si-new2" }))
check("3g. a modifier recipe can't be a sub-recipe line", asSub?.lineErrors?.[0]?.error, `"sub-oat" is a modifier recipe and can't be used inside another recipe`)
const modUsesMod = validateRecipeLines(costGraph, rec("cand-mod2", [line(null, 1, "serving", "no-redbull")], { squareModifierId: "m-x" }))
check("3h. … not even inside another modifier recipe", Boolean(modUsesMod?.lineErrors?.length), true)
check("3i. a modifier recipe may use a prep recipe", validateRecipeLines(costGraph, rec("cand-mod3", [line(null, 1, "serving", "pb-scoop")], { squareModifierId: "m-y" })), null)
check(
  "3j. a recipe can't be both a sales item's and a modifier's",
  validateRecipeLines(costGraph, rec("cand-both", [line("banana", 1, "oz (dry)")], { salesItemId: "si-z", squareModifierId: "m-z" }))?.error,
  "A recipe can belong to a sales item or a modifier, not both"
)

// ─── 4. Cost and nutrition keep their sign (N5-F2, N5-F6, N5-F7) ─────────────
const subCost = computeRecipeCost(costGraph, "sub-oat")
check("4a. substitution nets the right cost: −10 × $0.20 + 10 × $0.25 = +$0.50", [r6(subCost.cost), subCost.lines.map((l) => r6(l.cost))], [0.5, [-2, 2.5]])
const subN = computeRecipeNutrition(nutritionGraph, "sub-oat")
check("4b. substitution nets the right nutrition: −250 + 200 = −50 kcal, −37.5 + 25 = −12.5 g sugar", [r6(subN.totals.calories), r6(subN.totals.totalSugarsG), subN.complete], [-50, -12.5, true])
check("4c. N5-F6: swapping OUT the yogurt adds no MILK", subN.allergens, [])
const noRb = computeRecipeCost(costGraph, "no-redbull")
const noRbN = computeRecipeNutrition(nutritionGraph, "no-redbull")
check("4d. a removal nets NEGATIVE cost and stays negative: −8.4 × $0.30", r6(noRb.cost), -2.52)
check("4e. … and negative nutrition: −110 kcal, −27 g sugar", [r6(noRbN.totals.calories), r6(noRbN.totals.totalSugarsG)], [-110, -27])
const pbN = computeRecipeNutrition(nutritionGraph, "add-pb")
check("4f. an add-on adds its allergens and positive values", [pbN.allergens, r6(pbN.totals.calories), r6(computeRecipeCost(costGraph, "add-pb").cost)], [["PEANUTS"], 170, 0.18])
check("4g. a menu item's allergens are unchanged by N5-F6", computeRecipeNutrition(nutritionGraph, "smoothie").allergens, ["MILK"])
check(
  "4h. expansion is signed too (what N-5b's usage will read)",
  [...(expandRecipeToIngredients(costGraph, "sub-oat", 3) ?? new Map()).entries()].map(([k, v]) => [k, r6(v)]),
  [["yogurt", -30], ["oat", 30]]
)

// ─── 5. BevSpot: rows that resolve to modifiers import with negatives ────────
const sq = (tag: string) => `SQ${tag}`.padEnd(24, "0")
const HEADER = ["Name", "POS ID", "Recipe", "Sales Price", "Cost", "Cost %", "Category", "Subcategory", "Menu Group", "Note"]
const aoa: (string | number | null)[][] = []
function block(group: string, items: [string, string | null, string | null][]) {
  aoa.push([group, null, null, null, null, null, null, null, null, null])
  aoa.push(HEADER)
  for (const [name, pos, recipe] of items) aoa.push([name, pos, recipe, 5, 1, 0.2, "Cat", "Sub", group, ""])
  aoa.push([null, null, null, null, null, null, null, null, null, null])
}
block("Smoothies", [
  ["Classic (M)", sq("A"), "Vanilla Yogurt (10 fl. oz), Bananas (1.6 oz (dry))"],
  ["Bad Negative (M)", sq("B"), "Vanilla Yogurt (-2 fl. oz)"],
])
block("MODIFY SMOOTHIE", [
  ["No Banana", sq("M1"), "Bananas (-1.6 oz (dry))"],
  ["Non-Dairy Sub Oat", sq("M2"), "Vanilla Yogurt (-10 fl. oz), Oatmilk Vanilla (10 fl. oz)"],
  ["No Red Bull", sq("M3"), "Red Bull (-1 can (8.4fl. oz))"],
  ["Add PB", sq("M4"), "PB Scoop (1 serving)"],
  ["Old Mod", sq("M5"), "Bananas (1 oz (dry))"],
  ["Light Ice", sq("M6"), "Bananas (1 oz (dry))"],
  ["Mystery", sq("X9"), "Bananas (-1 oz (dry))"],
  ["Uses Negative Prep", sq("M7"), "Negative Prep (1 serving)"],
])
block("Recipe Kits", [
  ["PB Scoop", null, "Peanut Butter (1 oz (dry))"],
  ["Negative Prep", null, "Bananas (-1 oz (dry))"],
])
const ws = XLSX.utils.aoa_to_sheet(aoa)
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, ws, "Sales Items")
const rows = parseSalesItemsWorkbook(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer)

const planIngredients: PlanIngredient[] = ingredients.map((i) => ({ id: i.id, name: i.name, brand: null, reportingUnit: i.reportingUnit }))
const salesItems: PlanSalesItem[] = [
  { id: "si-A", squareVariationId: sq("A"), displayName: "Classic (M)", recipeStatus: "UNMAPPED", recipeId: null },
  { id: "si-B", squareVariationId: sq("B"), displayName: "Bad Negative (M)", recipeStatus: "UNMAPPED", recipeId: null },
]
const mod = (tag: string, name: string, recipeStatus = "UNMAPPED", recipeId: string | null = null): PlanModifier => ({
  id: `m-${tag}`, squareModifierId: sq(tag), name, recipeStatus, recipeId,
})
const modifiers: PlanModifier[] = [
  mod("M1", "N5 No Banana"),
  mod("M2", "N5 Sub Oat"),
  mod("M3", "N5 No Red Bull"),
  mod("M4", "N5 Add PB"),
  mod("M5", "N5 Old Mod", "MAPPED", "r-old"),
  mod("M6", "N5 Light Ice", "NON_RECIPE"),
  mod("M7", "N5 Uses Negative Prep"),
]
const emptyGraph = (extra: GraphRecipe[] = []): CostGraph => ({
  recipes: new Map([rec("r-old", [line("banana", 1, "oz (dry)")], { squareModifierId: "m-M5" }), ...extra].map((r) => [r.id, r])),
  ingredients: costGraph.ingredients,
  preparedByRecipeId: new Map(),
})
let n = 0
const newId = () => `new-${++n}`
const plan1 = planBevSpotImport({ rows, ingredients: planIngredients, salesItems, modifiers, graph: emptyGraph(), newId })

function outcome(plan: ImportPlan, tag: string): string {
  const made = plan.toCreate.find((r) => r.salesItemId === `si-${tag}` || r.squareModifierId === `m-${tag}`)
  if (made) return `${made.kind}:created`
  const s = plan.skipped.find((x) => x.squareId === sq(tag))
  return s ? s.reason : "missing"
}
check(
  "5a. outcomes: modifiers created, sales/prep negatives refused, BEV-1 rules kept",
  ["A", "B", "M1", "M2", "M3", "M4", "M5", "M6", "X9", "M7"].map((t) => [t, outcome(plan1, t)]),
  [
    ["A", "sales:created"],
    ["B", "NEGATIVE_QTY"],
    ["M1", "modifier:created"],
    ["M2", "modifier:created"],
    ["M3", "modifier:created"],
    ["M4", "modifier:created"],
    ["M5", "ALREADY_HAS_RECIPE"],
    ["M6", "MARKED_NON_RECIPE"],
    ["X9", "NOT_IN_SQUARE"],
    ["M7", "NEGATIVE_QTY"],
  ]
)
const byMod = (tag: string) => plan1.toCreate.find((r) => r.squareModifierId === `m-${tag}`)!
check("5b. No Banana → −1.6 oz (dry) Bananas, attached to the modifier", [byMod("M1").salesItemId, byMod("M1").lines.map((l) => [l.ingredientId, l.amount, l.unit])], [null, [["banana", -1.6, "oz (dry)"]]])
check("5c. substitution keeps both signs", byMod("M2").lines.map((l) => [l.ingredientId, l.amount]), [["yogurt", -10], ["oat", 10]])
check("5d. −1 can (8.4 fl. oz) maps to −8.4 fl. oz, not a whole-package skip", byMod("M3").lines.map((l) => [l.ingredientId, l.amount, l.unit]), [["redbull", -8.4, "fl. oz"]])
const pbSub = plan1.toCreate.find((r) => r.kind === "sub" && r.name === "PB Scoop")
check("5e. a modifier's prep line becomes a prep sub-recipe, created before it", [Boolean(pbSub), byMod("M4").lines[0].subRecipeId === pbSub?.id, plan1.toCreate.indexOf(pbSub!) < plan1.toCreate.indexOf(byMod("M4"))], [true, true, true])
check("5f. a prep recipe with a negative line never imports", plan1.toCreate.some((r) => r.name === "Negative Prep"), false)
const sum1 = summarizePlan(plan1)
check("5g. summary counts modifier recipes apart from menu items and prep", [sum1.ready, sum1.readyModifiers, sum1.readySubRecipes], [1, 4, 1])

// Run 2: run 1 applied — never overwrite, prep reused not duplicated.
const applied = plan1.toCreate.map((r) =>
  rec(r.id, r.lines.map((l) => line(l.ingredientId, l.amount, l.unit, l.subRecipeId)), {
    salesItemId: r.salesItemId ?? undefined, squareModifierId: r.squareModifierId ?? undefined,
  })
).map((r, i) => ({ ...r, name: plan1.toCreate[i].name }))
const recipeIdFor = (key: string) => plan1.toCreate.find((r) => r.salesItemId === key || r.squareModifierId === key)?.id ?? null
const plan2 = planBevSpotImport({
  rows,
  ingredients: planIngredients,
  salesItems: salesItems.map((s) => ({ ...s, recipeId: recipeIdFor(s.id), recipeStatus: recipeIdFor(s.id) ? "MAPPED" : s.recipeStatus })),
  modifiers: modifiers.map((m) => ({ ...m, recipeId: m.recipeId ?? recipeIdFor(m.id), recipeStatus: recipeIdFor(m.id) ? "MAPPED" : m.recipeStatus })),
  graph: emptyGraph(applied),
  newId,
})
check("5h. re-run: nothing already imported is planned again", plan2.toCreate.map((r) => r.name), [])
check("5i. re-run: each imported modifier skips as ALREADY_HAS_RECIPE", ["M1", "M2", "M3", "M4"].map((t) => outcome(plan2, t)), Array(4).fill("ALREADY_HAS_RECIPE"))
check("5j. without modifiers (BEV-1 behaviour) the same rows are NOT_IN_SQUARE", outcome(planBevSpotImport({ rows, ingredients: planIngredients, salesItems, graph: emptyGraph(), newId }), "M1"), "NOT_IN_SQUARE")

// ─── 6. Source checks on the routes and pages ────────────────────────────────
const src = (p: string) => readFileSync(p, "utf8")
const syncRoute = src("src/app/api/square/sales-items/sync/route.ts")
check("6a. sync asks for MODIFIER_LIST alongside ITEM and CATEGORY", /types", "ITEM,CATEGORY,MODIFIER_LIST"/.test(syncRoute), true)
check("6b. sync writes modifiers AFTER the item/variation sweep", syncRoute.indexOf("writeModifierCatalog(") > syncRoute.indexOf("prisma.salesItem.updateMany"), true)
check("6c. still no write scope requested from Square", /_WRITE/.test(src("src/app/api/square/auth/route.ts").replace(/\/\/.*$/gm, "")), false)
check("6d. duplicate refuses a modifier recipe", /source\.squareModifierId[\s\S]{0,200}status: 422/.test(src("src/app/api/inventory/recipes/[id]/duplicate/route.ts")), true)
const patchRoute = src("src/app/api/inventory/recipes/[id]/route.ts")
check("6e. PATCH can't change squareModifierId, refuses countable, countable only for prep", [/\.omit\(\{ squareModifierId: true \}\)/.test(patchRoute), /existing\.squareModifierId && data\.countable === true/.test(patchRoute), /recipeKind\(merged\) === "prep"/.test(patchRoute)], [true, true, true])
check("6f. editor never offers a modifier recipe as a sub-recipe", /recipeKind\(r\) !== "modifier"/.test(src("src/app/(app)/inventory/recipes/[id]/page.tsx")), true)
check("6g. prep list uses recipeKind, not salesItemId === null", /recipeKind\(r\) === "prep"/.test(src("src/app/(app)/inventory/recipes/page.tsx")), true)
const modTable = src("src/app/(app)/nutrition/menu/modifier-nutrition-table.tsx")
check("6h. N5-F7: the Modifiers view never imports FDA label rounding", /from "@\/lib\/nutrition-label"/.test(modTable), false)
check("6i. modifier cost shown only with inventory.costs.view", /can\(current\.actor, "inventory\.costs\.view"\)/.test(src("src/app/(app)/nutrition/menu/page.tsx")), true)
const migration = src("prisma/migrations_archive/20261103020000_n5_square_modifiers/migration.sql")
check("6j. the migration is additive only", [/DROP (COLUMN|TABLE|CONSTRAINT|INDEX)/i.test(migration), /ALTER TABLE "Recipe" (?!ADD)/.test(migration)], [false, false])

// ─── 7. Against the applied schema (dev), rolled back ────────────────────────
class Rollback extends Error {}
async function dbPart() {
  const [{ branch }] = await prisma.$queryRaw<{ branch: string | null }[]>`SELECT current_setting('neon.branch_id', true) AS branch`
  console.log(`  (database part on neon.branch_id = ${branch ?? "null"})`)
  try {
    await prisma.$transaction(
      async (tx) => {
        const org = await tx.organization.create({ data: { clerkOrgId: `n5-fixture-${Date.now()}`, name: "N-5 Fixture Org" } })
        const counts = await writeModifierCatalogIn(tx, org.id, mapped)
        check("7a. first sync stores 1 list, 3 modifiers, 2 item links", counts, { modifierLists: 1, modifiers: 3, itemLinks: 2 })
        const mods = await tx.squareModifier.findMany({ where: { organizationId: org.id }, orderBy: { squareModifierId: "asc" } })
        check("7b. rows as mapped, UNMAPPED by default", mods.map((m) => [m.squareModifierId, m.priceCents, m.recipeStatus, m.isDeleted]), [
          ["MOD-NOBAN", null, "UNMAPPED", false],
          ["MOD-OAT", 75, "UNMAPPED", false],
          ["MOD-PB", 150, "UNMAPPED", false],
        ])
        const noBan = mods.find((m) => m.squareModifierId === "MOD-NOBAN")!
        const oat = mods.find((m) => m.squareModifierId === "MOD-OAT")!
        const recipe = await tx.recipe.create({
          data: { organizationId: org.id, name: "N-5 Fixture No Banana", squareModifierId: noBan.id, lines: { create: [{ amount: -1.6, unit: "oz (dry)", sortOrder: 0 }] } },
          include: { lines: true },
        })
        check("7c. a modifier recipe stores with a negative line", [recipe.squareModifierId, recipe.salesItemId, recipe.lines[0].amount], [noBan.id, null, -1.6])
        await tx.squareModifier.update({ where: { id: noBan.id }, data: { recipeStatus: "MAPPED" } })
        await tx.squareModifier.update({ where: { id: oat.id }, data: { recipeStatus: "NON_RECIPE" } })

        // Re-sync: No Banana vanished from Square, the list was renamed, the bowl link is gone.
        const second = mapModifierCatalog(
          [{ ...catalogLists[0], modifier_list_data: { ...catalogLists[0].modifier_list_data, name: "N5 Boosts v2", modifiers: catalogLists[0].modifier_list_data!.modifiers!.filter((m) => m.id !== "MOD-NOBAN") } }],
          looseModifiers,
          [catalogItems[0]]
        )
        const counts2 = await writeModifierCatalogIn(tx, org.id, second)
        check("7d. re-sync counts", counts2, { modifierLists: 1, modifiers: 2, itemLinks: 1 })
        const after = await tx.squareModifier.findMany({ where: { organizationId: org.id }, include: { recipe: { select: { id: true } }, modifierList: true }, orderBy: { squareModifierId: "asc" } })
        check(
          "7e. vanished modifier swept to isDeleted, keeps its recipe and MAPPED; NON_RECIPE survives a re-sync",
          after.map((m) => [m.squareModifierId, m.isDeleted, m.recipeStatus, m.recipe?.id ?? null]),
          [
            ["MOD-NOBAN", true, "MAPPED", recipe.id],
            ["MOD-OAT", false, "NON_RECIPE", null],
            ["MOD-PB", false, "UNMAPPED", null],
          ]
        )
        check("7f. list renamed in place", after[0].modifierList.name, "N5 Boosts v2")
        check("7g. item links replaced wholesale", (await tx.squareItemModifierList.findMany({ where: { organizationId: org.id } })).map((l) => l.squareItemId), ["ITEM-SMOOTHIE"])
        await writeModifierCatalogIn(tx, org.id, mapped)
        check("7h. a modifier that comes back is un-deleted", (await tx.squareModifier.findUnique({ where: { id: noBan.id } }))?.isDeleted, false)
        throw new Rollback()
      },
      { timeout: 60_000 }
    )
  } catch (e) {
    if (!(e instanceof Rollback)) throw e
  }
  const leaked = await prisma.organization.count({ where: { name: "N-5 Fixture Org" } })
  check("7i. rolled back: no fixture rows left behind", leaked, 0)
}

dbPart()
  .catch((e) => {
    failures++
    console.log(`✗ database part threw: ${e instanceof Error ? e.stack : e}`)
  })
  .finally(async () => {
    await prisma.$disconnect()
    console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`)
    process.exit(failures === 0 ? 0 : 1)
  })
