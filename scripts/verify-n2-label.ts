/**
 * N-2 — Nutrition Facts label with a selectable serving size, pinned.
 *
 *   npx tsx scripts/verify-n2-label.ts
 *
 * Rulings: docs/DECISIONS.md 2026-11-02 N-2 (Gary, DRAFT) — forks N2-F1–F6,
 * R-1–R-8 and the R-5 tenths ruling; audit docs/prompts/N-2_AUDIT.md.
 *
 * TWO PARTS.
 *   1–9 PURE: synthetic totals, graphs and serving settings BUILT IN CODE, run
 *       through src/lib/nutrition-label.ts (what the preview, the picker and the
 *       print page call) and the engine. Every name is invented.
 *   10  DATABASE: against the database in local .env (dev), inside ONE
 *       transaction that is ALWAYS rolled back. It proves the APPLIED migration
 *       20261102230000_n2_nutrition_serving_settings: the org serving column,
 *       the size table (and its one-row-per-exact-name key), the per-item
 *       override (one per sales item, removed with it), and loadServingSettings
 *       + resolveServing reading them. The branch is printed from
 *       `neon.branch_id`, never typed.
 *
 * WHAT THIS CAN DETECT (the prompt's list): 24 fl oz at 12 → 2 servings, per
 * serving = half; 32 at 12 → "about 2.5" with per serving = totals × 12/32
 * (R-2); 20 at 12 → one 20 fl oz serving (R-3); 12 at 12 → single column; an
 * item not in the size table → per item; every nutrient's rounding at its band
 * edges; %DV rounding; missing → "—", never 0; the allergen union; override
 * beats table beats default.
 *
 * WHAT IT CANNOT: the pages, the two routes' gates, the picker's rendering and
 * the print layout, and loadItemLabelData's graph read (Recipe is empty on dev
 * — audit A). Those are Gary's staging pass.
 */
import "dotenv/config"
import { readFileSync } from "node:fs"
import type { Allergen } from "@prisma/client"
import { prisma } from "../src/lib/prisma"
import { NUTRIENT_KEYS, type NutrientKey, type NutrientValues } from "../src/lib/nutrition"
import {
  DEFAULT_SERVING_FL_OZ, buildLabel, dvPercent, flOzError, formatFlOz, resolveServing, roundCalories, roundCholesterol,
  roundFat, roundGram, roundSodium, roundVitaminMineral, servingsFor, suggestVolumeFromName, vitaminMineralDvPercent,
  type NutritionLabel, type ServingSpec,
} from "../src/lib/nutrition-label"
import { loadServingSettings } from "../src/lib/nutrition-serving"
import { computeRecipeNutrition, type NutritionGraph, type NutritionIngredient } from "../src/lib/recipe-nutrition"
import type { GraphRecipe } from "../src/lib/recipe-cost"

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`}`)
}

function vals(partial: Partial<Record<NutrientKey, number | null>>, fill: number | null = 0): NutrientValues {
  return Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, k in partial ? partial[k]! : fill])) as NutrientValues
}
const vol = (volumeFlOz: number, servingFlOz = DEFAULT_SERVING_FL_OZ): ServingSpec => ({
  kind: "volume", volumeFlOz, servingFlOz, volumeSource: "table", servingSource: "default",
})
const item = (totals: NutrientValues, extra: Partial<{ allergens: Allergen[]; error: string | null; verification: "VERIFIED" | "NOT_VERIFIED" | "NO_FOOD" }> = {}) => ({
  totals, allergens: [] as Allergen[], error: null, verification: "VERIFIED" as const, ...extra,
})
function label(r: ReturnType<typeof buildLabel>): NutritionLabel {
  if (!r.ok) throw new Error(`expected a label, got error: ${r.error}`)
  return r.label
}
const text = (l: NutritionLabel, col: number, k: NutrientKey) => l.columns[col].values[k].text

// ─── 1. Servings per container — (b)(6), (b)(8)(i), R-2, R-3 ─────────────────
const T = vals({ calories: 300, totalFatG: 8, sodiumMg: 200, totalCarbG: 60, totalSugarsG: 50, proteinG: 6 })

const l24 = label(buildLabel(item(T), vol(24)))
check("1a. 24 fl oz at 12 → \"2 servings per container\", two columns", [l24.servingsPerContainer, l24.dual, l24.columns.map((c) => c.heading)],
  ["2 servings per container", true, ["Per serving", "Per container"]])
check("1b. … serving size line \"12 fl oz (360 mL)\" (R-8)", l24.servingSize, "12 fl oz (360 mL)")
check("1c. … per serving is half (150 cal, 4g fat, 100mg sodium, 30g carb); per container is the whole item",
  [text(l24, 0, "calories"), text(l24, 0, "totalFatG"), text(l24, 0, "sodiumMg"), text(l24, 0, "totalCarbG"), text(l24, 1, "calories"), text(l24, 1, "totalFatG")],
  ["150", "4g", "100mg", "30g", "300", "8g"])

const T32 = vals({ calories: 400 })
const l32 = label(buildLabel(item(T32), vol(32)))
check("1d. 32 fl oz at 12 → \"about 2.5 servings per container\", two columns", [l32.servingsPerContainer, l32.dual], ["about 2.5 servings per container", true])
check("1e. R-2: per serving = totals × 12/32 = 150 (÷ the printed 2.5 would be 160)", [text(l32, 0, "calories"), text(l32, 1, "calories")], ["150", "400"])

const l20 = label(buildLabel(item(T), vol(20)))
check("1f. R-3: 20 fl oz at 12 (167 %) → ONE 20 fl oz serving, single column", [l20.servingSize, l20.servingsPerContainer, l20.dual, text(l20, 0, "calories")],
  ["20 fl oz (600 mL)", "1 serving per container", false, "300"])
const l12 = label(buildLabel(item(T), vol(12)))
check("1g. 12 fl oz at 12 → single column \"12 fl oz (360 mL)\"", [l12.servingSize, l12.dual, l12.columns[0].heading], ["12 fl oz (360 mL)", false, "Amount per serving"])

check("1h. servingsFor edges: 23.9 single; 24 = 2 exactly; 30 = 2.5 exactly; 40 about 3.5; 60 = 5; 64 about 5 (whole above 5)",
  [servingsFor(23.9, 12).single, servingsFor(24, 12), servingsFor(30, 12), servingsFor(40, 12), servingsFor(60, 12), servingsFor(64, 12)].map((s) =>
    s === true ? "single" : typeof s === "object" && !s.single ? `${s.about ? "about " : ""}${s.declared}` : "single"),
  ["single", "2", "2.5", "about 3.5", "5", "about 5"])
check("1i. 8 fl oz serving (the picker) on a 24 fl oz item → 3 servings; 32 → 4", [servingsFor(24, 8), servingsFor(32, 8)].map((s) => (s.single ? "single" : s.declared)), [3, 4])
check("1j. formatFlOz: 30 mL per fl oz, mL to the whole number", [formatFlOz(12), formatFlOz(20), formatFlOz(16.9)], ["12 fl oz (360 mL)", "20 fl oz (600 mL)", "16.9 fl oz (507 mL)"])

// ─── 2. Per item (F1) ─────────────────────────────────────────────────────────
const perItem = resolveServing({ variationName: "Regular", orgServingFlOz: null, sizeTable: new Map([["M", 24]]), override: null })
check("2a. a name not in the size table → per item (noVolume)", perItem, { kind: "perItem", source: "noVolume" })
const lItem = label(buildLabel(item(T), perItem))
check("2b. … labeled \"1 item\", one serving, single column, whole-item values", [lItem.servingSize, lItem.servingsPerContainer, lItem.dual, text(lItem, 0, "calories")],
  ["1 item", "1 serving per container", false, "300"])

// ─── 3. Precedence — override beats table beats default (F3) ──────────────────
const table = new Map([["M", 24], ["20oz.", 20]])
const r = (variationName: string, override: Parameters<typeof resolveServing>[0]["override"], orgServingFlOz: number | null = null) =>
  resolveServing({ variationName, orgServingFlOz, sizeTable: table, override })
check("3a. table volume + default serving", r("M", null), { kind: "volume", volumeFlOz: 24, servingFlOz: 12, volumeSource: "table", servingSource: "default" })
check("3b. org serving beats the default", r("M", null, 8), { kind: "volume", volumeFlOz: 24, servingFlOz: 8, volumeSource: "table", servingSource: "org" })
check("3c. override volume beats the table; override serving beats the org",
  r("M", { perItem: false, volumeFlOz: 32, servingFlOz: 16 }, 8), { kind: "volume", volumeFlOz: 32, servingFlOz: 16, volumeSource: "override", servingSource: "override" })
check("3d. override serving only: table volume, override serving",
  r("M", { perItem: false, volumeFlOz: null, servingFlOz: 16 }, 8), { kind: "volume", volumeFlOz: 24, servingFlOz: 16, volumeSource: "table", servingSource: "override" })
check("3e. override \"per item\" beats a table volume", r("M", { perItem: true, volumeFlOz: null, servingFlOz: null }), { kind: "perItem", source: "override" })
check("3f. override volume gives a name the table lacks a volume", r("Regular", { perItem: false, volumeFlOz: 16, servingFlOz: null })?.kind, "volume")

// ─── 4. Exact names, suggestions only (F6) ────────────────────────────────────
check("4a. the table matches the exact name: \"20oz.\" has a volume, \"20oz\" does not", [r("20oz.", null).kind, r("20oz", null).kind], ["volume", "perItem"])
check("4b. suggestVolumeFromName reads 20oz. / 12 oz / Kids (12oz) / 32 Oz. / 16 fl oz",
  ["20oz.", "12 oz", "Kids (12oz)", "32 Oz.", "16 fl oz"].map(suggestVolumeFromName), [20, 12, 12, 32, 16])
check("4c. … and nothing from M / Regular / Half Dozen / 24 Count", ["M", "Regular", "Half Dozen", "24 Count"].map(suggestVolumeFromName), [null, null, null, null])
check("4d. flOzError: 0 and 201 refused, 12 accepted", [flOzError(0, "x") !== null, flOzError(201, "x") !== null, flOzError(12, "x")], [true, true, null])

// ─── 5. Rounding at every band edge — 101.9(c), R-5, R-6 ──────────────────────
const t = (d: { text: string }) => d.text
check("5a. calories (c)(1): 4.9→0, 5→5, 47.4→45, 47.5→50, 50→50, 50.1→50, 55→60",
  [4.9, 5, 47.4, 47.5, 50, 50.1, 55].map((x) => t(roundCalories(x))), ["0", "5", "45", "50", "50", "50", "60"])
check("5b. fats (c)(2): 0.49→0, 0.5→0.5, 0.74→0.5, 0.75→1, 4.74→4.5, 4.75→5, 5→5 (R-6), 5.49→5, 5.5→6",
  [0.49, 0.5, 0.74, 0.75, 4.74, 4.75, 5, 5.49, 5.5].map((x) => t(roundFat(x))), ["0g", "0.5g", "0.5g", "1g", "4.5g", "5g", "5g", "5g", "6g"])
check("5c. cholesterol (c)(3): 1.99→0, 2→<5mg, 4.99→<5mg, 5→5, 7.4→5, 7.5→10",
  [1.99, 2, 4.99, 5, 7.4, 7.5].map((x) => t(roundCholesterol(x))), ["0mg", "<5mg", "<5mg", "5mg", "5mg", "10mg"])
check("5d. sodium (c)(4): 4.99→0, 5→5, 137.5→140, 140→140, 142→140, 145→150",
  [4.99, 5, 137.5, 140, 142, 145].map((x) => t(roundSodium(x))), ["0mg", "5mg", "140mg", "140mg", "140mg", "150mg"])
check("5e. carb/fiber/sugars/added/protein (c)(6)–(c)(7): 0.49→0, 0.5→<1g, 0.99→<1g, 1→1, 1.49→1, 1.5→2",
  [0.49, 0.5, 0.99, 1, 1.49, 1.5].map((x) => t(roundGram(x))), ["0g", "<1g", "<1g", "1g", "1g", "2g"])
check("5f. vitamins/minerals (c)(8)(iii) + R-5: 0.04→0, 0.3→0.3, 0.7→0.7, 0.95→1, 1.49→1, 1.5→2, 1234.5→1235",
  [0.04, 0.3, 0.7, 0.95, 1.49, 1.5, 1234.5].map((x) => t(roundVitaminMineral(x, "mg"))), ["0mg", "0.3mg", "0.7mg", "1mg", "1mg", "2mg", "1235mg"])
check("5g. R-5 examples: \"iron 0.7 mg, vitamin D 0.3 mcg\"", [t(roundVitaminMineral(0.7, "mg")), t(roundVitaminMineral(0.3, "mcg"))], ["0.7mg", "0.3mcg"])
check("5h. potassium is on the vitamin/mineral rule, not sodium's bands: 142 → 142mg (sodium would say 140mg)",
  [text(label(buildLabel(item(vals({ potassiumMg: 142 })), perItem)), 0, "potassiumMg"), text(label(buildLabel(item(vals({ sodiumMg: 142 })), perItem)), 0, "sodiumMg")],
  ["142mg", "140mg"])

// ─── 6. %DV — (d)(7)(ii), (c)(8)(iii), R-4, R-7 ───────────────────────────────
check("6a. macros to the nearest whole percent from the DECLARED amount (R-4): fat 8g → 10%; sodium 140mg → 6%; added sugars 25g → 50%",
  [dvPercent("totalFatG", roundFat(8.2)), dvPercent("sodiumMg", roundSodium(139)), dvPercent("addedSugarsG", roundGram(25.4))], [10, 6, 50])
check("6b. R-4 really uses the rounded amount: fat 5.4g declares 5g → 6% (the actual 5.4g would give 7%)",
  [t(roundFat(5.4)), dvPercent("totalFatG", roundFat(5.4))], ["5g", 6])
check("6c. a \"less than\" amount has no number, so its %DV uses the actual: fiber 0.84g → <1g, 3%; cholesterol 3mg → <5mg, 1%",
  [t(roundGram(0.84)), dvPercent("dietaryFiberG", roundGram(0.84)), t(roundCholesterol(3)), dvPercent("cholesterolMg", roundCholesterol(3))], ["<1g", 3, "<5mg", 1])
check("6d. vitamins/minerals (c)(8)(iii): calcium 20→0 (R-7, <2%), 26→2, 95→8, 130→10, 136.5→10, 650→50, 663→50, 780→60",
  [20, 26, 95, 130, 136.5, 650, 663, 780].map((a) => vitaminMineralDvPercent(a, 1300)), [0, 2, 8, 10, 10, 50, 50, 60])
check("6e. iron 0.7 mg → 4%; vitamin D 0.3 mcg → 0% (1.5% is under 2%, R-7)", [dvPercent("ironMg", roundVitaminMineral(0.7, "mg")), dvPercent("vitaminDMcg", roundVitaminMineral(0.3, "mcg"))], [4, 0])
check("6f. no %DV for calories, trans fat, total sugars, protein ((c)(7)(i): voluntary, PDCAAS)",
  (["calories", "transFatG", "totalSugarsG", "proteinG"] as NutrientKey[]).map((k) => dvPercent(k, { text: "", amount: 10, actual: 10 })), [null, null, null, null])
check("6g. dual columns: %DV per column (24 @ 12: fat 4g → 5%, 8g → 10%)", [l24.columns[0].values.totalFatG.dv, l24.columns[1].values.totalFatG.dv], [5, 10])

// ─── 7. Honesty states (F4) ───────────────────────────────────────────────────
const lMissing = label(buildLabel(item(vals({ calories: 200, addedSugarsG: null, vitaminDMcg: null })), vol(24)))
check("7a. a missing nutrient is \"—\" in every column, never 0, with no %DV",
  [lMissing.columns.map((c) => [c.values.addedSugarsG.text, c.values.addedSugarsG.dv]), lMissing.missing], [[["—", null], ["—", null]], ["addedSugarsG", "vitaminDMcg"]])
check("7b. … the known ones still round (calories 100 / 200)", [text(lMissing, 0, "calories"), text(lMissing, 1, "calories")], ["100", "200"])
check("7c. Estimated banner: NOT_VERIFIED yes, NO_FOOD yes (F4), VERIFIED no",
  (["NOT_VERIFIED", "NO_FOOD", "VERIFIED"] as const).map((v) => label(buildLabel(item(T, { verification: v }), perItem)).estimated), [true, true, false])
check("7d. an engine error → no label, the error instead", buildLabel(item(vals({}, null), { error: "Can't convert cup to each" }), vol(24)), { ok: false, error: "Can't convert cup to each" })

// ─── 8. Allergen union, through the engine (one calculation path) ─────────────
const ing = (id: string, allergens: Allergen[], calories: number): NutritionIngredient => ({
  id, name: id, reportingUnit: "fl. oz", brand: null, costPerReportingUnit: 0, kind: "PURCHASED", preparedFromRecipeId: null,
  isActive: true, isArchived: false, nutritionExempt: false, allergens,
  nutrition: { basisAmount: 8, basisUnit: "fl. oz", values: vals({ calories }) }, proof: "VERIFIED",
})
const cup: NutritionIngredient = { ...ing("cup", ["SOYBEANS"], 0), nutritionExempt: true, nutrition: null, proof: "NONE" }
const smoothie: GraphRecipe = {
  id: "smoothie", name: "N-2 Fixture Smoothie", salesItemId: "si", yieldQty: 1, yieldUnit: "serving", servingSizeQty: null, servingSizeUnit: null, isActive: true,
  lines: [
    { id: "l1", ingredientId: "almond", subRecipeId: null, amount: 8, unit: "fl. oz", sortOrder: 1 },
    { id: "l2", ingredientId: "yogurt", subRecipeId: null, amount: 8, unit: "fl. oz", sortOrder: 2 },
    { id: "l3", ingredientId: "cup", subRecipeId: null, amount: 1, unit: "each", sortOrder: 3 },
  ],
}
const graph: NutritionGraph = {
  recipes: new Map([["smoothie", smoothie]]),
  ingredients: new Map([["almond", ing("almond", ["TREE_NUTS"], 60)], ["yogurt", ing("yogurt", ["MILK"], 140)], ["cup", cup]]),
}
const rn = computeRecipeNutrition(graph, "smoothie")
const lEngine = label(buildLabel({ ...rn, verification: "VERIFIED" }, vol(24)))
check("8a. \"Contains:\" is the union of every ingredient's allergens, statute order, a not-food line's included",
  lEngine.contains, "Contains: Milk, Tree nuts, Soybeans")
check("8b. the label is the engine's totals scaled, no second calculation: 200 cal total → 100 / 200", [text(lEngine, 0, "calories"), text(lEngine, 1, "calories")], ["100", "200"])
check("8c. no allergens recorded → no Contains line", label(buildLabel(item(T), perItem)).contains, null)

// ─── 9. The migration file is additive ────────────────────────────────────────
const sql = readFileSync("prisma/migrations/20261102230000_n2_nutrition_serving_settings/migration.sql", "utf8")
check("9a. nothing is dropped (additive only)", /DROP (COLUMN|TABLE|CONSTRAINT|INDEX)/i.test(sql), false)
check("9b. it adds the org column and both tables", ["\"nutritionServingFlOz\"", "CREATE TABLE \"NutritionSizeVolume\"", "CREATE TABLE \"NutritionItemServing\""].map((s) => sql.includes(s)), [true, true, true])

// ─── 10. Against the applied schema (dev), rolled back ────────────────────────
class Rollback extends Error {}
async function dbPart() {
  const [{ branch }] = await prisma.$queryRaw<{ branch: string | null }[]>`SELECT current_setting('neon.branch_id', true) AS branch`
  console.log(`  (database part on neon.branch_id = ${branch ?? "null"})`)
  try {
    await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { clerkOrgId: `n2-fixture-${Date.now()}`, name: "N-2 Fixture Org", nutritionServingFlOz: 8 } })
      const mkItem = (variationName: string) =>
        tx.salesItem.create({
          data: {
            organizationId: org.id, squareItemId: `n2-item`, squareVariationId: `n2-var-${variationName}`, name: "N-2 Fixture Smoothie",
            variationName, displayName: `N-2 Fixture Smoothie (${variationName})`,
          },
        })
      const [m, l] = [await mkItem("M"), await mkItem("L")]
      await tx.nutritionSizeVolume.create({ data: { organizationId: org.id, variationName: "M", volumeFlOz: 24 } })
      await tx.nutritionSizeVolume.create({ data: { organizationId: org.id, variationName: "L", volumeFlOz: 32 } })

      await tx.$executeRawUnsafe(`SAVEPOINT n2_dup`)
      let dup: string | null = null
      try {
        await tx.nutritionSizeVolume.create({ data: { organizationId: org.id, variationName: "M", volumeFlOz: 20 } })
      } catch (e) {
        dup = (e as { code?: string }).code ?? String(e)
      }
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT n2_dup`)
      check("10a. one size-table row per exact name per org (unique)", dup, "P2002")

      await tx.nutritionItemServing.create({ data: { organizationId: org.id, salesItemId: l.id, perItem: true } })
      const settings = await loadServingSettings(org.id, tx)
      check("10b. loadServingSettings reads the org serving and the table", [settings.orgServingFlOz, [...settings.sizeTable].sort()], [8, [["L", 32], ["M", 24]]])
      const overrideL = await tx.nutritionItemServing.findUnique({ where: { salesItemId: l.id }, select: { perItem: true, volumeFlOz: true, servingFlOz: true } })
      const resolve = (variationName: string, override: typeof overrideL) =>
        resolveServing({ variationName, orgServingFlOz: settings.orgServingFlOz, sizeTable: settings.sizeTable, override })
      check("10c. M resolves from the table at the org's 8 fl oz → 3 servings", (() => {
        const s = resolve(m.variationName, null)
        return s.kind === "volume" ? [s.volumeFlOz, s.servingFlOz, servingsFor(s.volumeFlOz, s.servingFlOz)] : s
      })(), [24, 8, { single: false, ratio: 3, declared: 3, about: false }])
      check("10d. L's stored \"per item\" override beats its table volume", resolve(l.variationName, overrideL), { kind: "perItem", source: "override" })

      await tx.salesItem.delete({ where: { id: l.id } })
      check("10e. deleting the sales item removes its override (cascade)", await tx.nutritionItemServing.count({ where: { organizationId: org.id } }), 0)
      throw new Rollback()
    })
  } catch (e) {
    if (!(e instanceof Rollback)) throw e
  }
  const leaked = await prisma.organization.count({ where: { name: "N-2 Fixture Org" } })
  check("10f. rolled back: no fixture rows left behind", leaked, 0)
}

dbPart()
  .catch((e) => {
    failures++
    console.log(`✗ 10. database part threw: ${e instanceof Error ? e.message : e}`)
  })
  .finally(async () => {
    await prisma.$disconnect()
    console.log(failures === 0 ? "\n✓ ALL PASS" : `\n✗ ${failures} CHECK(S) FAILED`)
    process.exit(failures === 0 ? 0 : 1)
  })
