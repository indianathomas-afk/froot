/**
 * N-1c — "Read label": everything after the model answers, pinned.
 *
 *   npx tsx scripts/verify-n1c-label.ts
 *
 * PURE. NO LIVE API CALLS, no database, no blob store. Canned model outputs
 * BUILT IN CODE — including the real Almond Breeze Original panel from Keva's
 * spec sheet — run through the same functions the read route and the review
 * screen call (parseLabelOutput, chooseBasis, parsePrintedValue,
 * reviewAllergens, nameWarning, buildLabelReview). Ingredient names are
 * invented except Almond Milk.
 *
 * WHAT THIS CAN DETECT (the prompt's list, plus the rulings of 2026-11-02):
 *   - The serving chosen is the one in the ingredient's dimension
 *     (1 cup (240mL) → 8 fl. oz on a fl-oz ingredient).
 *   - A weight-only serving on a volume ingredient is refused for basis, and
 *     a bare label "oz" is never read as fl. oz (N1-F1).
 *   - "<1 g" pre-fills 0.5 and "0" pre-fills 0, both flagged; a %DV-only value
 *     converts with the FDA Daily Value, flagged (N1C-F7).
 *   - almonds → TREE_NUTS from the printed Contains line, even if the model
 *     misses it; coconut is not mapped (FDA Edition 5, Table 1).
 *   - The name check warns on Unsweetened vs Original (N1C-F3).
 *   - Malformed model output is rejected, never half-applied.
 *   - The JSON schema sent to the API keeps structured-output rules.
 *
 * WHAT IT CANNOT DETECT: whether the model reads a real label correctly, the
 * route's ADMIN gate, rate limit and 24 h reuse (they run on AuditLog rows),
 * or the review screen's rendering. Those are Gary's staging pass.
 */
import { NUTRIENT_KEYS } from "../src/lib/nutrition"
import {
  LABEL_OUTPUT_JSON_SCHEMA, buildLabelReview, chooseBasis, nameWarning, parseLabelOutput, parsePrintedValue, reviewAllergens,
  type LabelOutput,
} from "../src/lib/label-review"

let failures = 0
let count = 0
function check(label: string, actual: unknown, expected: unknown) {
  count++
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`}`)
}

// The real panel (docs/prompts/N-1c.md § Phase 2), as the model would transcribe it.
const ALMOND_BREEZE_ORIGINAL: LabelOutput = {
  isNutritionLabel: true,
  productName: "Almondmilk Original",
  brand: "Almond Breeze",
  servingSizeText: "1 cup (240mL)",
  nutrients: [
    { key: "calories", printed: "60", dailyValuePercent: "" },
    { key: "totalFatG", printed: "2.5g", dailyValuePercent: "3%" },
    { key: "saturatedFatG", printed: "0g", dailyValuePercent: "0%" },
    { key: "transFatG", printed: "0g", dailyValuePercent: "" },
    { key: "cholesterolMg", printed: "0mg", dailyValuePercent: "0%" },
    { key: "sodiumMg", printed: "150mg", dailyValuePercent: "7%" },
    { key: "totalCarbG", printed: "8g", dailyValuePercent: "3%" },
    { key: "dietaryFiberG", printed: "<1g", dailyValuePercent: "2%" },
    { key: "totalSugarsG", printed: "7g", dailyValuePercent: "" },
    { key: "addedSugarsG", printed: "7g", dailyValuePercent: "14%" },
    { key: "proteinG", printed: "1g", dailyValuePercent: "" },
    { key: "vitaminDMcg", printed: "0mcg", dailyValuePercent: "0%" },
    { key: "calciumMg", printed: "450mg", dailyValuePercent: "35%" },
    { key: "ironMg", printed: "0.7mg", dailyValuePercent: "4%" },
    { key: "potassiumMg", printed: "170mg", dailyValuePercent: "4%" },
  ],
  containsText: "Contains: Almonds",
  mayContainText: "",
  allergens: ["TREE_NUTS"],
  unreadable: [],
}

const almondMilk = { name: "Almond Milk", brand: null, reportingUnit: "fl. oz", allergens: [] }

// ─── 1. The real panel, end to end ───────────────────────────────────────────
{
  const p = parseLabelOutput(JSON.stringify(ALMOND_BREEZE_ORIGINAL))
  check("1a. the Almond Breeze output parses", p.ok, true)
  const r = buildLabelReview(ALMOND_BREEZE_ORIGINAL, almondMilk, null)
  check("1b. basis: 1 cup (240mL) on a fl. oz ingredient → 8 fl. oz", r.basis.ok && [r.basis.amount, r.basis.unit], [8, "fl. oz"])
  const by = Object.fromEntries(r.nutrients.map((x) => [x.key, [x.proposed, x.flag]]))
  check("1c. calories 60, unflagged", by.calories, [60, null])
  check("1d. fat 2.5 g", by.totalFatG, [2.5, null])
  check("1e. saturated 0 → 0, flagged ZERO", by.saturatedFatG, [0, "ZERO"])
  check("1f. trans 0 and cholesterol 0, flagged ZERO", [by.transFatG, by.cholesterolMg], [[0, "ZERO"], [0, "ZERO"]])
  check("1g. sodium 150, carb 8, sugars 7/7, protein 1", [by.sodiumMg[0], by.totalCarbG[0], by.totalSugarsG[0], by.addedSugarsG[0], by.proteinG[0]], [150, 8, 7, 7, 1])
  check("1h. fiber <1g → 0.5, flagged LESS_THAN_1G (not silently converted)", by.dietaryFiberG, [0.5, "LESS_THAN_1G"])
  check("1i. vitamin D 0, calcium 450, iron 0.7, potassium 170", [by.vitaminDMcg, by.calciumMg[0], by.ironMg[0], by.potassiumMg[0]], [[0, "ZERO"], 450, 0.7, 170])
  check("1j. allergens: almonds → TREE_NUTS", r.allergens.proposed, ["TREE_NUTS"])
  check("1k. no name warning for \"Almond Milk\" vs Almond Breeze Almondmilk Original", r.nameWarning, null)
  check("1l. nothing unreadable", r.unreadable, [])
}

// ─── 2. Serving / basis (deliverable 2, N1-F1) ───────────────────────────────
check("2a. weight-only serving on a volume ingredient is refused", chooseBasis("28g", "fl. oz").ok, false)
check("2b. … and the reason names both dimensions", (() => { const b = chooseBasis("28g", "fl. oz"); return !b.ok && /weight/.test(b.reason) && /volume/.test(b.reason) })(), true)
check("2c. bare label \"oz\" is never read as fl. oz", chooseBasis("8 oz", "fl. oz").ok, false)
check("2d. 8 fl oz (240 mL) on fl. oz → 8 fl. oz", (() => { const b = chooseBasis("8 fl oz (240 mL)", "fl. oz"); return b.ok && [b.amount, b.unit] })(), [8, "fl. oz"])
check("2e. 2 tbsp (30 g) on a weight ingredient → 30 g (the g serving, printed unit kept)", (() => { const b = chooseBasis("2 tbsp (30 g)", "oz (dry)"); return b.ok && [b.amount, b.unit] })(), [30, "g"])
check("2f. 2 tbsp (30 g) on a volume ingredient → 1 fl. oz (exact)", (() => { const b = chooseBasis("2 Tbsp (30g)", "fl. oz"); return b.ok && [b.amount, b.unit] })(), [1, "fl. oz"])
check("2g. 1 cup on a gal ingredient keeps cup (1/16 gal isn't 2-dp exact)", (() => { const b = chooseBasis("1 cup (240mL)", "gal"); return b.ok && [b.amount, b.unit] })(), [1, "cup"])
check("2h. 1 bar (40g) on an each ingredient → 1 each", (() => { const b = chooseBasis("1 bar (40g)", "each"); return b.ok && [b.amount, b.unit] })(), [1, "each"])
check("2i. 2 tbsp (30 g) on an each ingredient is refused", chooseBasis("2 tbsp (30 g)", "each").ok, false)
check("2j. ⅔ cup (55g) on a cup ingredient → 0.6667 cup", (() => { const b = chooseBasis("⅔ cup (55g)", "cup"); return b.ok && [b.amount, b.unit] })(), [0.6667, "cup"])
check("2k. 1 1/2 cups on fl. oz → 12 fl. oz", (() => { const b = chooseBasis("1 1/2 cups (360mL)", "fl. oz"); return b.ok && [b.amount, b.unit] })(), [12, "fl. oz"])
check("2l. 0.5 kg on a g ingredient → 500 g", (() => { const b = chooseBasis("0.5 kg", "g"); return b.ok && [b.amount, b.unit] })(), [500, "g"])
check("2m. empty serving text is refused", chooseBasis("", "fl. oz").ok, false)

// ─── 3. Printed values (N1C-F7) ──────────────────────────────────────────────
check("3a. \"Less than 1g\" protein → 0.5, flagged", parsePrintedValue("proteinG", "Less than 1g", ""), { value: 0.5, flag: "LESS_THAN_1G" })
check("3b. %DV only: calcium 35% → 455 mg (DV 1300), flagged FROM_DV", parsePrintedValue("calciumMg", "", "35%"), { value: 455, flag: "FROM_DV" })
check("3c. %DV only: iron 4% → 0.72 mg (DV 18)", parsePrintedValue("ironMg", "", "4%"), { value: 0.72, flag: "FROM_DV" })
check("3d. vitamin D 100 IU → 2.5 mcg, flagged UNIT_CONVERTED", parsePrintedValue("vitaminDMcg", "100 IU", ""), { value: 2.5, flag: "UNIT_CONVERTED" })
check("3e. potassium printed 0.17g → 170 mg, flagged UNIT_CONVERTED", parsePrintedValue("potassiumMg", "0.17g", ""), { value: 170, flag: "UNIT_CONVERTED" })
// 3f updated by N-1d (N1D-F3, Gary 2026-11-02: "Cholesterol "<5 mg" pre-fills
// as 2"; 21 CFR 101.9(c)(3) "2 to 5 milligrams"). It used to pin null.
check("3f. cholesterol \"<5mg\" → 2, flagged LESS_THAN_5MG (N-1d)", parsePrintedValue("cholesterolMg", "<5mg", ""), { value: 2, flag: "LESS_THAN_5MG" })
check("3g. garbage text → null, UNREADABLE", parsePrintedValue("sodiumMg", "see panel", ""), { value: null, flag: "UNREADABLE" })
check("3h. total sugars has no DV — a %DV alone stays UNREADABLE", parsePrintedValue("totalSugarsG", "", "10%"), { value: null, flag: "UNREADABLE" })
check("3i. calories in g is refused", parsePrintedValue("calories", "60g", ""), { value: null, flag: "UNREADABLE" })

// ─── 4. Allergens ────────────────────────────────────────────────────────────
{
  const a = reviewAllergens("Contains: Almonds", [])
  check("4a. almonds → TREE_NUTS from the printed line even when the model maps nothing", [a.proposed, a.onlyText], [["TREE_NUTS"], ["TREE_NUTS"]])
  const b = reviewAllergens("Contains: Milk, Soy, Wheat", ["MILK", "SOYBEANS", "WHEAT"])
  check("4b. milk, soy, wheat in statute order", b.proposed, ["MILK", "WHEAT", "SOYBEANS"])
  const c = reviewAllergens("Contains: Coconut", [])
  check("4c. coconut is not mapped (FDA Edition 5 Table 1) and gets a note", [c.proposed, c.notes.length > 0], [[], true])
  const d = reviewAllergens("Contains: Cashews, Pistachios, Pine Nuts", [])
  check("4d. Table 1 tree nuts map", d.proposed, ["TREE_NUTS"])
  const e = reviewAllergens("Contains: Peanuts", ["PEANUTS", "TREE_NUTS"])
  check("4e. peanut is not a tree nut; the model's extra is proposed and called out", [e.proposed, e.onlyModel], [["TREE_NUTS", "PEANUTS"], ["TREE_NUTS"]])
  const f = reviewAllergens("", [])
  check("4f. no Contains line → a note to check the ingredient list", f.notes.some((t) => /Contains/.test(t)), true)
}

// ─── 5. Name check (N1C-F3) ──────────────────────────────────────────────────
check("5a. \"Unsweetened\" label vs \"Original\" product → warning",
  nameWarning({ brand: "Almond Breeze", productName: "Unsweetened Almondmilk" }, { name: "Almond Milk Original", brand: "Almond Breeze" }) !== null, true)
check("5b. Original label vs Original product → no warning",
  nameWarning({ brand: "Almond Breeze", productName: "Original Almondmilk" }, { name: "Almond Milk Original", brand: "Almond Breeze" }), null)
check("5c. unrelated product → warning",
  nameWarning({ brand: "Silk", productName: "Oat Yeah Oatmilk" }, { name: "Almond Milk", brand: null }) !== null, true)
check("5d. \"Sugar-Free\" vs \"Original\" → warning (multi-word variant)",
  nameWarning({ brand: "Torani", productName: "Sugar-Free Vanilla Syrup" }, { name: "Vanilla Syrup Original", brand: "Torani" }) !== null, true)
check("5f. BevSpot size words don't trip it: \"Almond Milk 32oz Carton\" vs Almond Breeze Almondmilk",
  nameWarning({ brand: "Almond Breeze", productName: "Almondmilk" }, { name: "Almond Milk 32oz Carton", brand: null }), null)
check("5e. unreadable product name → warning", nameWarning({ brand: "", productName: "" }, { name: "Almond Milk", brand: null }) !== null, true)

// ─── 6. Against what is stored ───────────────────────────────────────────────
{
  const stored = { basisAmount: 8, basisUnit: "fl. oz", values: Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, null])) as Record<(typeof NUTRIENT_KEYS)[number], number | null> }
  stored.values.calories = 30 // the old unsweetened estimate
  stored.values.sodiumMg = 150
  const r = buildLabelReview(ALMOND_BREEZE_ORIGINAL, almondMilk, stored)
  const cal = r.nutrients.find((x) => x.key === "calories")!
  const na = r.nutrients.find((x) => x.key === "sodiumMg")!
  check("6a. calories 60 on the label vs 30 stored → differs", [cal.storedOnLabelBasis, cal.differs], [30, true])
  check("6b. sodium matches → not highlighted", [na.storedOnLabelBasis, na.differs], [150, false])
  const per4 = { ...stored, basisAmount: 4, values: { ...stored.values, calories: 30 } }
  const r2 = buildLabelReview(ALMOND_BREEZE_ORIGINAL, almondMilk, per4)
  check("6c. stored per 4 fl. oz is rescaled to the label's 8 fl. oz", r2.nutrients.find((x) => x.key === "calories")!.storedOnLabelBasis, 60)
  const weightOnly = buildLabelReview({ ...ALMOND_BREEZE_ORIGINAL, servingSizeText: "240g" }, almondMilk, stored)
  check("6d. weight-only label on a volume ingredient: no basis, values still shown", [weightOnly.basis.ok, weightOnly.nutrients.find((x) => x.key === "calories")!.proposed], [false, 60])
}

// ─── 7. Malformed model output (deliverable 6) ───────────────────────────────
check("7a. not JSON → rejected", parseLabelOutput("{not json").ok, false)
check("7b. missing field → rejected", parseLabelOutput({ ...ALMOND_BREEZE_ORIGINAL, unreadable: undefined }).ok, false)
check("7c. unknown nutrient key → rejected", parseLabelOutput({ ...ALMOND_BREEZE_ORIGINAL, nutrients: [{ key: "caffeineMg", printed: "1mg", dailyValuePercent: "" }] }).ok, false)
check("7d. unknown allergen → rejected", parseLabelOutput({ ...ALMOND_BREEZE_ORIGINAL, allergens: ["COCONUT"] }).ok, false)
check("7e. a nutrient listed twice → rejected", parseLabelOutput({ ...ALMOND_BREEZE_ORIGINAL, nutrients: [...ALMOND_BREEZE_ORIGINAL.nutrients, { key: "calories", printed: "70", dailyValuePercent: "" }] }).ok, false)
check("7f. a number where a string belongs → rejected", parseLabelOutput({ ...ALMOND_BREEZE_ORIGINAL, servingSizeText: 240 }).ok, false)
check("7g. not a nutrition label → rejected", parseLabelOutput({ ...ALMOND_BREEZE_ORIGINAL, isNutritionLabel: false }).ok, false)
check("7h. empty string (no text block) → rejected", parseLabelOutput("").ok, false)

// ─── 8. The schema sent to the API (structured-outputs rules) ────────────────
{
  const problems: string[] = []
  const walk = (s: Record<string, unknown>, path: string) => {
    for (const bad of ["minimum", "maximum", "minLength", "maxLength", "multipleOf", "nullable"]) if (bad in s) problems.push(`${path}.${bad}`)
    if (Array.isArray(s.type)) problems.push(`${path}: union type`)
    if (s.type === "object") {
      if (s.additionalProperties !== false) problems.push(`${path}: additionalProperties`)
      const props = Object.keys(s.properties as object)
      const req = s.required as string[]
      if (props.some((p) => !req.includes(p))) problems.push(`${path}: not all required`)
      for (const [k, v] of Object.entries(s.properties as Record<string, Record<string, unknown>>)) walk(v, `${path}.${k}`)
    }
    if (s.type === "array") walk(s.items as Record<string, unknown>, `${path}[]`)
  }
  walk(LABEL_OUTPUT_JSON_SCHEMA as unknown as Record<string, unknown>, "$")
  check("8a. schema: every object closed and fully required, no numeric bounds, no unions", problems, [])
}

console.log(`\n${count - failures}/${count} checks passed`)
process.exit(failures === 0 ? 0 : 1)
