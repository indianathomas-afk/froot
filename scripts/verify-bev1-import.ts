/**
 * BEV-1 — the BevSpot recipe import planner, pinned.
 *
 *   npx tsx scripts/verify-bev1-import.ts
 *
 * PURE. No database: a synthetic BevSpot workbook is BUILT IN CODE with the
 * same xlsx package the route uses, written to bytes, read back through
 * parseSalesItemsWorkbook(), and planned against synthetic ingredients, sales
 * items and a recipe graph. Every name here is invented; no Keva data is in
 * the repo (BEV-1 prompt).
 *
 * WHAT THIS CAN DETECT, so a green run means something:
 *   - The tokenizer splitting a name that contains a comma, losing a name
 *     that ends in its own parentheses, or mis-reading nested-paren units.
 *   - Any ruling F3–F13 (docs/DECISIONS.md, 2026-11-01 BEV-1) drifting: each
 *     sales item below asserts its EXACT outcome — created, or the reason
 *     code it skips with.
 *   - Sub-recipe wiring: a wrapper pointing at the wrong recipe, a prep row
 *     created twice, a sub-recipe created that nothing uses (F4), dependency
 *     order wrong for the apply's createMany.
 *   - F6 on a re-run: nothing already imported is planned again, and a prep
 *     recipe made by run 1 is REUSED by run 2, not duplicated.
 *
 * WHAT IT CANNOT DETECT: that the apply route's transaction writes these rows,
 * that the routes refuse a non-admin, or how the real export matches real
 * ingredients. Those are Gary's staging preview (the real test, per his
 * ruling) and the PRE-PUSH-CHECK.
 */
import * as XLSX from "xlsx"
import { parseRecipeString, parseSalesItemsWorkbook } from "../src/lib/bevspot/parse-sales-items"
import { mapBevSpotQty } from "../src/lib/bevspot/units"
import { planBevSpotImport, summarizePlan, type ImportPlan, type PlanIngredient, type PlanSalesItem } from "../src/lib/bevspot/plan-import"
import type { CostGraph, GraphRecipe } from "../src/lib/recipe-cost"

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`}`)
}

const sq = (tag: string) => `SQ${tag}`.padEnd(24, "0")

// ─── 1. Tokenizer and units, directly ────────────────────────────────────────
const tricky = parseRecipeString(
  "Choco Topping, Dark Liquid Bag Syrup (1 fl. oz), Banana  Slices  (0.8 oz (dry)), Coconut Water (1 bottle (1L)), Berry Blast (Kids) (1 serving)"
)
check(
  "1a. comma name, double space, nested unit, name ending in parens",
  "lines" in tricky ? tricky.lines.map((l) => [l.name, l.qty, l.unitRaw]) : tricky,
  [
    ["Choco Topping, Dark Liquid Bag Syrup", 1, "fl. oz"],
    ["Banana  Slices", 0.8, "oz (dry)"],
    ["Coconut Water", 1, "bottle (1L)"],
    ["Berry Blast (Kids)", 1, "serving"],
  ]
)
check("1b. a line with no quantity is an error", "error" in parseRecipeString("Just A Name"), true)
check("1c. case of cans", mapBevSpotQty(1, "case (24 x 8.4fl. oz (can))"), { ok: true, amount: 201.6, unit: "fl. oz", wholePackage: true })
check("1d. fractional container is not whole", mapBevSpotQty(0.181, "container (96oz (dry))"), { ok: true, amount: 17.376, unit: "oz (dry)", wholePackage: false })
check("1e. one can is single-serve (F12)", mapBevSpotQty(1, "can (8.4fl. oz)"), { ok: true, amount: 8.4, unit: "fl. oz", wholePackage: false })
check("1f. other (1 unit) is the unit marker (F13)", mapBevSpotQty(1, "other (1 unit)"), { ok: true, amount: 1, unit: "unit", wholePackage: false })
check("1g. unknown unit is an error", mapBevSpotQty(1, "pinch").ok, false)

// ─── 2. The synthetic workbook ───────────────────────────────────────────────
const HEADER = ["Name", "POS ID", "Recipe", "Sales Price", "Cost", "Cost %", "Category", "Subcategory", "Menu Group", "Note"]
const aoa: (string | number | null)[][] = []
function block(group: string, items: [string, string | null, string | null][]) {
  aoa.push([group, null, null, null, null, null, null, null, null, null])
  aoa.push(HEADER)
  for (const [name, pos, recipe] of items) aoa.push([name, pos, recipe, 5, 1, 0.2, "Cat", "Sub", group === "Unassigned" ? "" : group, ""])
  aoa.push([null, null, null, null, null, null, null, null, null, null])
}

block("Smoothies", [
  ["Berry Blast (M)", sq("A"), "Cup Kit - 24oz (1 serving), Frozen Berries (4 oz (dry)), Choco Topping, Dark Liquid Bag Syrup (1 fl. oz), Banana  Slices  (0.8 oz (dry))"],
  ["Berry Blast (L)", sq("B"), "Berry Blast (M) (1.5 servings)"],
  ["Green Machine (S)", sq("C"), "Kale Leaves (1 oz (dry)), Cup Kit - 24oz (1 serving)"],
  ["Green Machine Old (S)", sq("C"), "Berry Blast (M) (1 serving)"],
  ["Tropic (M)", sq("D"), "Mango Puree (2 fl. oz)"],
  ["Tropic (M)", sq("D"), "Mango Puree (3 fl. oz)"],
  ["Tropic (L)", sq("E"), "Tropic (M) (1 serving)"],
  ["Green Machine (L)", sq("C2"), "Green Machine (S) (2 servings)"],
  ["Mango Twist", sq("F"), "Mango Puree (2 fl. oz), Juice - Ginger 1 oz (1 serving), Cup Kit - 24oz (1 serving)"],
  ["Mystery Mix", sq("G"), "Unicorn Dust (1 oz (dry))"],
  ["Honey Shot", sq("H"), "Honey (1 package (5lbs))"],
  ["Red Charger", sq("I"), "Energy Drink (1 can (8.4fl. oz))"],
  ["Coconut Water", sq("J"), "Coconut Water (1 bottle (1L))"],
  ["Protein Add", sq("K"), "Whey Protein (30 g)"],
  ["Cookie", sq("L"), "Acme Baking Choc Chip Cookie (1 EA)"],
  ["Mug", sq("M"), "Travel Mug (1 other (1 unit))"],
  ["Fruit Cup", sq("N"), "Melon Chunks (1 unit)"],
  ["Classic (M)", sq("Q"), "Frozen Berries (5 oz (dry))"],
  ["Classic (L)", sq("R"), "Classic (M) (1 serving)"],
  ["Chia Bowl", sq("S"), "Chia Pudding - 1oz (2 servings)"],
  ["Guava Cooler", sq("T"), "Monin Guava Syrup (1 fl. oz)"],
  ["Saucy", sq("U"), "Prep Sauce (1 serving)"],
  ["Loop A", sq("V"), "Loop B (1 serving)"],
  ["Loop B", sq("W"), "Loop A (1 serving)"],
  ["Water Cup", sq("Y"), null],
  ["Kale Shot", sq("K2"), "Kale (1 EA)"],
  ["Kale", sq("K3"), "Kale Leaves (1 oz (dry))"],
  ["Gift Card", sq("Z"), "Card Stock (1 EA)"],
])
block("ADD ONS", [
  ["No Ice", sq("X"), "Ice (-10 fl. oz)"],
  ["Extra Shot", sq("O"), "Espresso (-1 fl. oz)"],
])
block("Recipe Kits", [
  ["Cup Kit - 24oz", "CK24", "Cup 24oz (1 EA), Lid 24oz (1 EA), Straws (1 unit)"],
  ["Napkin Kit", null, "Napkin (1 EA)"],
  ["Prep Sauce", "PS1", "Mango Puree (1 fl. oz)"],
  ["Prep Sauce", "PS2", "Mango Puree (2 fl. oz)"],
])
block("Archived", [["Old Smoothie", sq("P"), "Frozen Berries (9 oz (dry))"]])
// Would make Berry Blast (M) a conflict if Unassigned were not dropped first (F3).
block("Unassigned", [["Berry Blast 24oz", sq("A"), "Frozen Berries (99 oz (dry))"]])

const ws = XLSX.utils.aoa_to_sheet(aoa)
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, ws, "Sales Items")
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Name"]]), "Items Needing Attention")
const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer)
const rows = parseSalesItemsWorkbook(bytes)

check("2a. every item row parsed", rows.length, 36)
check("2b. Unassigned group comes from the block title, not the empty column", rows.find((r) => r.name === "Berry Blast 24oz")?.group, "Unassigned")
check("2c. non-Square POS ids are not Square ids", rows.filter((r) => r.group === "Recipe Kits").map((r) => r.squareId), [null, null, null, null])

// ─── 3. Org state ────────────────────────────────────────────────────────────
const ing = (id: string, name: string, reportingUnit: string, brand: string | null = null): PlanIngredient => ({ id, name, brand, reportingUnit })
const ingredients: PlanIngredient[] = [
  ing("i-berries", "Frozen Berries", "oz (dry)"),
  ing("i-choco", "Choco Topping, Dark Liquid Bag Syrup", "fl. oz"),
  ing("i-banana", "Banana Slices", "oz (dry)"),
  ing("i-kale", "Kale Leaves", "oz (dry)"),
  ing("i-mango", "Mango Puree", "fl. oz"),
  ing("i-honey", "Honey", "lbs"),
  ing("i-energy", "Energy Drink", "fl. oz"),
  ing("i-coconut", "Coconut Water", "fl. oz"),
  ing("i-whey", "Whey Protein", "oz (dry)"),
  ing("i-cookie", "Choc Chip Cookie", "each", "Acme Baking"),
  ing("i-mug", "Travel Mug", "each"),
  ing("i-melon", "Melon Chunks", "oz (dry)"),
  ing("i-cup", "Cup 24oz", "each"),
  ing("i-lid", "Lid 24oz", "each"),
  ing("i-straws", "Straws", "each"),
  ing("i-guava1", "Guava Syrup", "fl. oz", "Monin"),
  ing("i-guava2", "Monin Guava Syrup", "fl. oz"),
  ing("i-card", "Card Stock", "each"),
  ing("i-espresso", "Espresso", "fl. oz"),
  ing("i-napkin", "Napkin", "each"),
]
const sales = (tag: string, recipeStatus = "UNMAPPED", recipeId: string | null = null): PlanSalesItem => ({
  id: `si-${tag}`,
  squareVariationId: sq(tag),
  displayName: `Item ${tag}`,
  recipeStatus,
  recipeId,
})
// X (the modifier) and P (archived) are deliberately NOT Froot sales items.
const salesItems: PlanSalesItem[] = [
  ..."ABCDEFGHIJKLMNORSTUVWY".split("").map((t) => sales(t)),
  sales("C2"),
  sales("K2"),
  sales("K3"),
  sales("Q", "MAPPED", "r-classic-m"),
  sales("Z", "NON_RECIPE"),
]

const graphRecipe = (id: string, name: string, salesItemId: string | null): GraphRecipe => ({
  id, name, salesItemId, yieldQty: 1, yieldUnit: "serving", servingSizeQty: null, servingSizeUnit: null, isActive: true,
  lines: [{ id: `${id}-l0`, ingredientId: "i-berries", subRecipeId: null, amount: 1, unit: "oz (dry)", sortOrder: 0 }],
})
function graphFor(recipes: GraphRecipe[]): CostGraph {
  return {
    recipes: new Map(recipes.map((r) => [r.id, r])),
    ingredients: new Map(
      ingredients.map((i) => [
        i.id,
        { id: i.id, name: i.name, reportingUnit: i.reportingUnit, costPerReportingUnit: 1, kind: "PURCHASED", preparedFromRecipeId: null, isActive: true, isArchived: false },
      ])
    ),
    preparedByRecipeId: new Map(),
  }
}
const existing = [graphRecipe("r-classic-m", "Classic (M)", "si-Q"), graphRecipe("r-chia", "Chia Pudding - 1oz", null)]

let n = 0
const newId = () => `new-${++n}`
const plan1 = planBevSpotImport({ rows, ingredients, salesItems, graph: graphFor(existing), newId })

// ─── 4. Run 1 outcomes, one per Square item ──────────────────────────────────
function outcome(plan: ImportPlan, tag: string): string {
  if (plan.toCreate.some((r) => r.salesItemId === `si-${tag}`)) return "CREATE"
  const s = plan.skipped.filter((x) => x.squareId === sq(tag))
  return s.length ? [...new Set(s.map((x) => x.reason))].join("+") : "ABSENT"
}
const expected: Record<string, string> = {
  A: "CREATE", // sub-recipe, comma name, double space; Unassigned conflict dropped first (F3)
  B: "CREATE", // wrapper → A's new recipe (F10)
  C: "CREATE", // expanded beats a wrapper for the same id (F3)
  C2: "CREATE", // wrapper → C, whose two rows F3 resolves (not AMBIGUOUS)
  D: "CONFLICT", // two expanded recipes (F3)
  E: "CONFLICT", // wrapper whose target skipped, carrying its reason (F10)
  F: "MISSING_INGREDIENT", // undefined prep name, never an empty sub-recipe (F4)
  G: "MISSING_INGREDIENT", // (F5)
  H: "SUSPECT_QTY", // whole package (F12)
  I: "CREATE", // one can imports (F12 boundary)
  J: "CREATE", // ingredient beats the same-named row (F11); 1 L
  K: "CREATE", // g (F13)
  L: "CREATE", // brand + " " + name (F5)
  M: "CREATE", // other (1 unit) → each (F13)
  N: "BAD_UNIT", // unit, but the ingredient is not counted each (F13)
  O: "NEGATIVE_QTY", // (F7)
  X: "NOT_IN_SQUARE", // modifier: Square id not a sales item (F7)
  P: "DROPPED_GROUP", // Archived (F3)
  Q: "ALREADY_HAS_RECIPE", // never overwrite (F6)
  R: "CREATE", // wrapper → the EXISTING recipe of Q (F6 + F10)
  S: "CREATE", // existing Froot sub-recipe by exact name (F6)
  T: "AMBIGUOUS_NAME", // brand+name and a plain name both match (F5/F11)
  U: "AMBIGUOUS_NAME", // prep defined two different ways (F11)
  V: "LOOP",
  W: "LOOP",
  Y: "NO_RECIPE",
  K2: "MISSING_INGREDIENT", // EA line that only matches a sales row → missing ingredient, not a unit problem
  K3: "CREATE",
  Z: "MARKED_NON_RECIPE",
}
for (const [tag, want] of Object.entries(expected)) check(`4. ${tag} → ${want}`, outcome(plan1, tag), want)

const byItem = (tag: string) => plan1.toCreate.find((r) => r.salesItemId === `si-${tag}`)!
const cupKits = plan1.toCreate.filter((r) => r.kind === "sub")
check("4a. exactly one sub-recipe created: the Cup Kit", cupKits.map((r) => r.name), ["Cup Kit - 24oz"])
check("4b. Cup Kit lines; Straws (1 unit) → each", cupKits[0]?.lines.map((l) => [l.ingredientId, l.amount, l.unit]), [["i-cup", 1, "each"], ["i-lid", 1, "each"], ["i-straws", 1, "each"]])
check("4c. A uses the Cup Kit", byItem("A").lines[0].subRecipeId, cupKits[0]?.id)
check("4d. A's comma-name and double-space lines matched", byItem("A").lines.slice(2).map((l) => l.ingredientId), ["i-choco", "i-banana"])
check("4e. B → A's new recipe, 1.5 serving", [byItem("B").lines[0].subRecipeId, byItem("B").lines[0].amount, byItem("B").lines[0].unit], [byItem("A").id, 1.5, "serving"])
check("4e2. C2 → C's new recipe", byItem("C2").lines[0].subRecipeId, byItem("C").id)
check("4f. R → Q's existing recipe", byItem("R").lines[0].subRecipeId, "r-classic-m")
check("4g. S → existing Chia Pudding", byItem("S").lines[0].subRecipeId, "r-chia")
check("4h. J is an ingredient line, 1 L", [byItem("J").lines[0].ingredientId, byItem("J").lines[0].amount, byItem("J").lines[0].unit], ["i-coconut", 1, "L"])
check("4i. K 30 g", [byItem("K").lines[0].amount, byItem("K").lines[0].unit], [30, "g"])
check("4j. I one can = 8.4 fl. oz", [byItem("I").lines[0].amount, byItem("I").lines[0].unit], [8.4, "fl. oz"])
check("4k. L brand match", byItem("L").lines[0].ingredientId, "i-cookie")
check("4l. M → each", [byItem("M").lines[0].ingredientId, byItem("M").lines[0].unit], ["i-mug", "each"])
const order = plan1.toCreate.map((r) => r.id)
check("4m. dependency order: Cup Kit before A before B", order.indexOf(cupKits[0]?.id) < order.indexOf(byItem("A").id) && order.indexOf(byItem("A").id) < order.indexOf(byItem("B").id), true)
check("4n. F names the missing prep", plan1.skipped.find((s) => s.squareId === sq("F"))?.names, ["Juice - Ginger 1 oz"])
check("4o. unused prep row skipped, not created (F4)", plan1.skipped.filter((s) => s.label === "Napkin Kit").map((s) => s.reason), ["NO_SQUARE_ID"])
check("4p. recipes use the Froot sales item name", byItem("A").name, "Item A")
const s1 = summarizePlan(plan1)
check("4q. summary counts", [s1.ready, s1.readySubRecipes], [12, 1])

// ─── 5. Run 2 — after applying run 1 and adding the missing prep as an ingredient
const applied: GraphRecipe[] = plan1.toCreate.map((r) => ({
  id: r.id, name: r.name, salesItemId: r.salesItemId, yieldQty: 1, yieldUnit: "serving", servingSizeQty: null, servingSizeUnit: null, isActive: true,
  lines: r.lines.map((l, i) => ({ id: `${r.id}-l${i}`, ingredientId: l.ingredientId, subRecipeId: l.subRecipeId, amount: l.amount, unit: l.unit, sortOrder: i })),
}))
ingredients.push(ing("i-ginger", "Juice - Ginger 1 oz", "serving"))
const salesItems2 = salesItems.map((s) => {
  const r = plan1.toCreate.find((x) => x.salesItemId === s.id)
  return r ? { ...s, recipeStatus: "MAPPED", recipeId: r.id } : s
})
const plan2 = planBevSpotImport({ rows, ingredients, salesItems: salesItems2, graph: graphFor([...existing, ...applied]), newId })
check("5a. run 2 creates only the newly fixable item", plan2.toCreate.map((r) => r.salesItemId), ["si-F"])
check("5a2. K2 names Kale as the missing ingredient", plan1.skipped.find((s) => s.squareId === sq("K2"))?.names, ["Kale"])
check("5b. run 2 reuses run 1's Cup Kit by exact name (F6), no new sub-recipe", plan2.toCreate[0]?.lines.map((l) => l.subRecipeId ?? l.ingredientId), ["i-mango", "i-ginger", cupKits[0]?.id])
check("5c. everything run 1 created is ALREADY_HAS_RECIPE", plan1.toCreate.filter((r) => r.kind === "sales").every((r) => outcome(plan2, r.salesItemId!.slice(3)).split("+").includes("ALREADY_HAS_RECIPE")), true)

// ─── 6. BEV-1b — prep rows that other recipes use always import as prep ──────
// A second workbook, so the counts in sections 2 and 4 stay pinned.
aoa.length = 0
block("Smoothies", [
  ["Carrot Cooler", sq("E1"), "Juice - Carrot 1 oz (1 serving), Mango Puree (2 fl. oz)"],
  ["Big Cup Smoothie", sq("A1"), "Cup Kit - 20oz (1 serving), Frozen Berries (4 oz (dry))"],
  ["Lemon Splash", sq("B1"), "Pressed Lemon (2 servings)"],
  ["Ginger Zing", sq("C1"), "Ginger Shot Prep (1 serving)"],
  ["Wheat Wonder", sq("D1"), "Wheat Prep (1 serving)"],
])
block("Juice Fresh", [["Juice - Carrot 1 oz", sq("CA"), "Mango Puree (1 fl. oz)"]])
block("Custom Juice Recipe", [["Pressed Lemon", sq("PL"), "Mango Puree (1 fl. oz)"]])
block("Recipe Kits", [
  ["Ginger Shot Prep", null, "Mango Puree (1 fl. oz)"],
  ["Wheat Prep", null, "Mango Puree (1 fl. oz)"],
  ["Wheat Prep", null, "Mango Puree (2 fl. oz)"],
])
block("Archived", [["Ginger Shot Prep", null, "Mango Puree (9 fl. oz)"]])
block("Unassigned", [["Cup Kit - 20oz", sq("CK"), "Cup 24oz (1 EA), Lid 24oz (1 EA)"]])
const wb6 = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb6, XLSX.utils.aoa_to_sheet(aoa), "Sales Items")
const rows6 = parseSalesItemsWorkbook(new Uint8Array(XLSX.write(wb6, { type: "array", bookType: "xlsx" }) as ArrayBuffer))
// CA, PL and CK are deliberately NOT Froot sales items.
const salesItems6 = ["E1", "A1", "B1", "C1", "D1"].map((t) => sales(t))
const carrot = graphRecipe("r-carrot", "Juice - Carrot 1 oz", null)
const plan6 = planBevSpotImport({ rows: rows6, ingredients, salesItems: salesItems6, graph: graphFor([carrot]), newId })
const item6 = (tag: string) => plan6.toCreate.find((r) => r.salesItemId === `si-${tag}`)
const subs6 = plan6.toCreate.filter((r) => r.kind === "sub")
const sub6 = (name: string) => subs6.find((r) => r.name === name)
const reasons6 = (tag: string) => plan6.skipped.filter((s) => s.squareId === sq(tag)).map((s) => s.reason)

check("6e. existing Froot prep beats the export's non-Froot-Square row: dependent imports", outcome(plan6, "E1"), "CREATE")
check("6e2. … pointing at the existing prep", item6("E1")?.lines[0].subRecipeId, "r-carrot")
check("6e3. … and no second Juice - Carrot 1 oz is created", sub6("Juice - Carrot 1 oz"), undefined)
check("6a. prep only in Unassigned, used by a sales item → imports", outcome(plan6, "A1"), "CREATE")
check("6a2. … as a sub-recipe from its Unassigned row", [item6("A1")?.lines[0].subRecipeId, sub6("Cup Kit - 20oz")?.lines.map((l) => l.ingredientId)], [sub6("Cup Kit - 20oz")?.id, ["i-cup", "i-lid"]])
check("6a3. … with no sales item, and its own row still DROPPED_GROUP for attachment", [sub6("Cup Kit - 20oz")?.salesItemId, reasons6("CK")], [null, ["DROPPED_GROUP"]])
check("6b. prep with a non-Froot Square id, used by a sales item → imports", outcome(plan6, "B1"), "CREATE")
check("6b2. … as prep (no sales item) that B1 uses", [sub6("Pressed Lemon")?.salesItemId, item6("B1")?.lines[0].subRecipeId], [null, sub6("Pressed Lemon")?.id])
check("6b3. … and its own row still reports NOT_IN_SQUARE for attachment", reasons6("PL"), ["NOT_IN_SQUARE"])
check("6c. same prep name in Archived and an active group, different lines → active wins", [outcome(plan6, "C1"), sub6("Ginger Shot Prep")?.lines[0].amount], ["CREATE", 1])
check("6d. two active rows define one prep name differently → ambiguous", outcome(plan6, "D1"), "AMBIGUOUS_NAME")
check("6f. exactly the three new preps are created, never a sales-item recipe change", [subs6.map((r) => r.name).sort(), plan6.toCreate.filter((r) => r.kind === "sales").map((r) => r.salesItemId).sort()], [["Cup Kit - 20oz", "Ginger Shot Prep", "Pressed Lemon"], ["si-A1", "si-B1", "si-C1", "si-E1"]])

console.log(failures === 0 ? "\n✓ ALL PASS\n" : `\n✗ ${failures} CHECK(S) FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
