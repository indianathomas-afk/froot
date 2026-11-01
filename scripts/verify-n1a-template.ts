/**
 * N-1a — the nutrition template round-trips as zero changes, pinned.
 *
 *   npx tsx scripts/verify-n1a-template.ts
 *
 * PURE. No database: synthetic ingredients are BUILT IN CODE and run through
 * the same functions the template route and the import routes call
 * (buildNutritionTemplate → parseNutritionCsv → planNutritionImport). Every
 * name is invented; no Keva data is in the repo.
 *
 * WHAT THIS CAN DETECT, so a green run means something:
 *   - Which ingredients the template lists (active, not archived, not PREPARED),
 *     in what order (category, uncategorized last, then display name).
 *   - Columns: exactly the import's, in order, then the three helpers.
 *   - Pre-fill: name/brand as stored, basis from the record or 1 × reporting
 *     unit, blank stays blank (never "0"), allergens in the import's spelling,
 *     not-food rows with basis and nutrients blank.
 *   - Gary's rule (2026-11-01): the UNEDITED template plans as zero writes —
 *     every row UNCHANGED, resolved to its own ingredient id. That covers A (no
 *     empty record for a blank row) and B (identical rows unwritten).
 *   - Edits still import: a filled-in value is NEW, a changed value is UPDATE,
 *     an allergen-only change is DETAILS_ONLY with no nutrition write, a
 *     not-food row never carries a nutrition write (so apply never deletes).
 *
 * WHAT IT CANNOT DETECT: the route's ADMIN gate, the apply transaction, or how
 * Keva's real ingredient names match. Those are Gary's staging pass.
 */
import type { Allergen } from "@prisma/client"
import Papa from "papaparse"
import { IMPORT_COLUMNS, NUTRIENT_KEYS, type NutrientKey, type NutrientValues, type NutritionInput } from "../src/lib/nutrition"
import {
  APPLYABLE, TEMPLATE_HELPER_COLUMNS, buildNutritionTemplate, parseNutritionCsv, planNutritionImport, summarizeNutritionPlan,
  type PlanIngredientRef, type TemplateIngredient,
} from "../src/lib/nutrition-import"

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`}`)
}

function vals(partial: Partial<Record<NutrientKey, number | null>>): NutrientValues {
  return Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, k in partial ? partial[k]! : null])) as NutrientValues
}
const record = (basisAmount: number, basisUnit: string, values: NutrientValues, sourceNote: string | null = null): NutritionInput =>
  ({ basisAmount, basisUnit, values, sourceNote })

function ing(id: string, name: string, reportingUnit: string, o: Partial<TemplateIngredient> = {}): TemplateIngredient {
  return {
    id, name, reportingUnit, brand: null, kind: "PURCHASED", isActive: true, isArchived: false,
    category: "Produce", allergens: [], nutritionExempt: false, nutrition: null, ...o,
  }
}

// Every nutrient known, some awkward doubles (0.1 + 0.2 is not 0.3).
const full = vals({
  calories: 395, totalFatG: 0.5, saturatedFatG: 0.1 + 0.2, transFatG: 0, cholesterolMg: 0, sodiumMg: 12.25,
  totalCarbG: 102, dietaryFiberG: 8.8, totalSugarsG: 78.8, addedSugarsG: 38.3, proteinG: 3.9,
  vitaminDMcg: 0.0000001, calciumMg: 1000, ironMg: 1.1, potassiumMg: 450,
})

const all: TemplateIngredient[] = [
  ing("almond", "Almond Butter", "oz (dry)", {
    brand: "Justin's", category: "Dry Goods", allergens: ["TREE_NUTS", "MILK", "CRUSTACEAN_SHELLFISH"],
    nutrition: record(2, "oz (dry)", full, 'label, "2026" pack'),
  }),
  ing("banana", "Bananas", "oz (dry)", { nutrition: record(28, "g", vals({ calories: 25, totalSugarsG: 3.4 })) }), // partial
  ing("honey", "Honey", "fl. oz", { category: "Dry Goods" }), // no record (A)
  ing("empty", "Mint Leaves", "each", { nutrition: record(1, "each", vals({})) }), // a record with every value unknown
  ing("cup", 'Cup Kit, 24oz "Lid"', "each", { category: null, nutritionExempt: true }), // not food, name needs quoting
  ing("straw", "Straws", "each", { category: null, nutritionExempt: true, nutrition: record(1, "each", vals({ calories: 1 })) }), // not food, OLD record
  ing("prep", "Strawberry Puree", "fl. oz", { kind: "PREPARED" }),
  ing("off", "Old Syrup", "fl. oz", { isActive: false }),
  ing("arch", "Archived Syrup", "fl. oz", { isArchived: true }),
]

// ─── 1. Rows and order ───────────────────────────────────────────────────────
const text = buildNutritionTemplate(all)
const raw = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" }).data
check("1a. the file starts with a UTF-8 BOM", text.charCodeAt(0), 0xfeff)
check("1b. header = the import's columns in order, then the helpers", raw[0], [...IMPORT_COLUMNS, ...TEMPLATE_HELPER_COLUMNS])
const rows = raw.slice(1).map((r) => Object.fromEntries(raw[0].map((h, i) => [h, r[i]])))
check(
  "1c. PREPARED, inactive and archived excluded; sorted by category (uncategorized last), then brand + name",
  rows.map((r) => r.name),
  ["Honey", "Almond Butter", "Bananas", "Mint Leaves", 'Cup Kit, 24oz "Lid"', "Straws"]
)

// ─── 2. Pre-fill ─────────────────────────────────────────────────────────────
const [honeyRow, almondRow, bananaRow, mintRow, cupRow, strawRow] = rows
check("2a. brand and name as stored, separately", [almondRow.brand, almondRow.name, honeyRow.brand], ["Justin's", "Almond Butter", ""])
check("2b. awkward doubles written losslessly", [almondRow.saturated_fat_g, almondRow.vitamin_d_mcg, almondRow.trans_fat_g], [String(0.1 + 0.2), "1e-7", "0"])
check("2c. allergens in statute order, the import's spelling", almondRow.allergens, "milk; crustacean shellfish; tree nuts")
check("2d. source with a comma and quotes survives", almondRow.source, 'label, "2026" pack')
check("2e. partial record: known values filled, unknown blank (never 0)", [bananaRow.basis_amount, bananaRow.basis_unit, bananaRow.calories, bananaRow.protein_g], ["28", "g", "25", ""])
check("2f. no record: basis 1 × reporting unit, every nutrient blank", [honeyRow.basis_amount, honeyRow.basis_unit, honeyRow.calories, honeyRow.potassium_mg], ["1", "fl. oz", "", ""])
check("2g. not food: flag yes, basis and nutrients blank — even with an old record", [cupRow.not_food, cupRow.basis_amount, cupRow.basis_unit, strawRow.basis_amount, strawRow.calories], ["yes", "", "", "", ""])
check("2h. helper columns", [almondRow.category, cupRow.category, honeyRow.reporting_unit, honeyRow.has_nutrition, strawRow.has_nutrition, mintRow.has_nutrition], ["Dry Goods", "", "fl. oz", "no", "yes", "yes"])

// ─── 3. The round trip: unedited template → zero changes ─────────────────────
// The planner sees every non-deleted ingredient, as planNutritionForOrg does —
// excluded ones included, so a name clash with them would show up here.
const refs: PlanIngredientRef[] = all.map((i) => ({
  id: i.id, name: i.name, brand: i.brand, reportingUnit: i.reportingUnit, kind: i.kind,
  nutrition: i.nutrition, allergens: i.allergens, nutritionExempt: i.nutritionExempt,
}))
const csv = parseNutritionCsv(text)
check("3a. the parser accepts the file, helper columns and all", [csv.error, csv.rows.length], [null, 6])
const plan = planNutritionImport(csv, refs)
check(
  "3b. every row resolves to its OWN ingredient, and every row is UNCHANGED",
  plan.map((p) => [p.status, p.ingredientId]),
  [["UNCHANGED", "honey"], ["UNCHANGED", "almond"], ["UNCHANGED", "banana"], ["UNCHANGED", "empty"], ["UNCHANGED", "cup"], ["UNCHANGED", "straw"]]
)
check("3c. nothing would be written: no applyable rows, no write payloads", [plan.filter((p) => APPLYABLE.has(p.status)).length, plan.every((p) => p.write === null)], [0, true])
const sum = summarizeNutritionPlan(plan)
check("3d. summary: zero NEW / UPDATE / DETAILS_ONLY / NOT_FOOD", [sum.NEW, sum.UPDATE, sum.DETAILS_ONLY, sum.NOT_FOOD, sum.UNCHANGED], [0, 0, 0, 0, 6])
check("3e. A: the no-record row says nothing is imported (no empty record)", plan[0].detail, "No nutrient values — nothing to import")

// ─── 4. Edits still import, and only what changed is written ─────────────────
function edited(edit: (rows: Record<string, string>[]) => void) {
  const c = parseNutritionCsv(text)
  edit(c.rows.map((r) => r.cells))
  return planNutritionImport(c, refs)
}
const e1 = edited((r) => { r[0].calories = "64"; r[0].total_sugars_g = "17.2" })
check("4a. a value filled in on a no-record row → NEW, the rest stay unknown", [e1[0].status, e1[0].write?.nutrition?.values.calories, e1[0].write?.nutrition?.values.proteinG], ["NEW", 64, null])
check("4b. … and every other row is still UNCHANGED", e1.filter((p, i) => i !== 0).every((p) => p.status === "UNCHANGED"), true)
const e2 = edited((r) => { r[1].calories = "400" })
check("4c. a changed value → UPDATE (whole record), allergens untouched", [e2[1].status, e2[1].write?.nutrition?.values.calories, e2[1].write?.allergens], ["UPDATE", 400, null])
const e3 = edited((r) => { r[1].allergens = "milk; tree nuts" })
check("4d. allergens only → DETAILS_ONLY, no nutrition write", [e3[1].status, e3[1].write], ["DETAILS_ONLY", { nutrition: null, allergens: ["MILK", "TREE_NUTS"], nutritionExempt: null }])
const e4 = edited((r) => { r[0].allergens = "sesame" })
check("4e. A: allergens on a blank no-record row → DETAILS_ONLY, still no empty record", [e4[0].status, e4[0].write?.nutrition], ["DETAILS_ONLY", null])
const e5 = edited((r) => { r[5].allergens = "soy" })
check("4f. not-food row with a record: allergen change writes no nutrition (never deletes)", [e5[5].status, e5[5].write], ["NOT_FOOD", { nutrition: null, allergens: ["SOYBEANS"], nutritionExempt: null }])
const e6 = edited((r) => { r[0].basis_amount = ""; r[0].basis_unit = "" })
check("4g. A: a blank no-record row with no basis is UNCHANGED, not INVALID", e6[0].status, "UNCHANGED")
const e7 = edited((r) => { r[3].basis_amount = ""; r[3].basis_unit = "" })
check("4h. a record that exists still needs its basis", [e7[3].status, e7[3].detail], ["INVALID", "basis_amount and basis_unit are required"])
const e8 = edited((r) => { r[4].not_food = "" })
check("4i. blank not_food on an exempt item leaves the flag as is (UNCHANGED)", e8[4].status, "UNCHANGED")

console.log(failures === 0 ? "\n✓ ALL PASS\n" : `\n✗ ${failures} CHECK(S) FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
