import { z } from "zod"
import type { Allergen } from "@prisma/client"
import { ALLERGENS, NUTRIENTS, NUTRIENT_KEYS, allowedBasisUnits, sortAllergens, type NutrientKey } from "@/lib/nutrition"
import { convert, unitDimension } from "@/lib/units"

// ─── N-1c "Read label": everything after the model answers ───────────────────
// PURE — no database, no network — so the read route, the dialog's review
// screen and scripts/verify-n1c-label.ts run the same code. The model only
// transcribes what is printed; every decision (which serving is the basis,
// what "<1 g" becomes, which allergens a Contains line names, whether the
// product name matches) is made HERE, in code (N1C-F3, deliverable 2).

// ─── What the model returns ──────────────────────────────────────────────────
// No nullable fields: structured outputs cap union-typed parameters per
// request, and 15 nutrients × nullable would exceed it. Absent = "".

export const LABEL_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["isNutritionLabel", "productName", "brand", "servingSizeText", "nutrients", "containsText", "mayContainText", "allergens", "unreadable"],
  properties: {
    isNutritionLabel: { type: "boolean" },
    productName: { type: "string" },
    brand: { type: "string" },
    servingSizeText: { type: "string" },
    nutrients: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "printed", "dailyValuePercent"],
        properties: {
          key: { type: "string", enum: NUTRIENT_KEYS },
          printed: { type: "string" },
          dailyValuePercent: { type: "string" },
        },
      },
    },
    containsText: { type: "string" },
    mayContainText: { type: "string" },
    allergens: { type: "array", items: { type: "string", enum: ALLERGENS.map((a) => a.value) } },
    unreadable: { type: "array", items: { type: "string" } },
  },
} as const

const OutputSchema = z.object({
  isNutritionLabel: z.boolean(),
  productName: z.string(),
  brand: z.string(),
  servingSizeText: z.string(),
  nutrients: z.array(
    z.object({
      key: z.enum(NUTRIENT_KEYS as [NutrientKey, ...NutrientKey[]]),
      printed: z.string(),
      dailyValuePercent: z.string(),
    })
  ),
  containsText: z.string(),
  mayContainText: z.string(),
  allergens: z.array(z.enum(ALLERGENS.map((a) => a.value) as [Allergen, ...Allergen[]])),
  unreadable: z.array(z.string()),
})
export type LabelOutput = z.infer<typeof OutputSchema>

/** The model's text, or a stored copy of it, as a LabelOutput — or why not.
 *  Anything malformed is a failed read, never a half-filled form (deliverable 6). */
export function parseLabelOutput(raw: unknown): { ok: true; output: LabelOutput } | { ok: false; error: string } {
  let value = raw
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw)
    } catch {
      return { ok: false, error: "The reader's answer wasn't valid JSON" }
    }
  }
  const parsed = OutputSchema.safeParse(value)
  if (!parsed.success) return { ok: false, error: "The reader's answer didn't have the expected shape" }
  const keys = parsed.data.nutrients.map((n) => n.key)
  if (new Set(keys).size !== keys.length) return { ok: false, error: "The reader listed a nutrient twice" }
  if (!parsed.data.isNutritionLabel) return { ok: false, error: "This document doesn't look like a Nutrition Facts label" }
  return { ok: true, output: parsed.data }
}

// ─── Printed numbers ─────────────────────────────────────────────────────────

const UNICODE_FRACTIONS: Record<string, string> = { "½": "1/2", "⅓": "1/3", "⅔": "2/3", "¼": "1/4", "¾": "3/4", "⅛": "1/8" }

function parseAmount(text: string): number | null {
  const t = text.trim()
  let m = t.match(/^(\d+)\s+(\d+)\/(\d+)$/)
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3])
  m = t.match(/^(\d+)\/(\d+)$/)
  if (m) return Number(m[1]) / Number(m[2])
  m = t.match(/^\d*\.?\d+$/)
  return m ? Number(t) : null
}

// ─── Servings (deliverable 2) ────────────────────────────────────────────────
// Printed spellings → Froot's canonical units (src/lib/units.ts). A bare "oz"
// on a label is WEIGHT: mapping it to fl. oz would be the weight↔volume
// conversion N1-F1 forbids.
const UNIT_ALIASES: Record<string, string> = {
  ml: "mL", milliliter: "mL", milliliters: "mL", millilitre: "mL",
  l: "L", liter: "L", liters: "L", litre: "L",
  cup: "cup", cups: "cup", c: "cup",
  floz: "fl. oz", fluidounce: "fl. oz", fluidounces: "fl. oz",
  tbsp: "tbsp", tbs: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp", t: "tbsp",
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp",
  qt: "qt", quart: "qt", quarts: "qt", pt: "pt", pint: "pt", pints: "pt", gal: "gal", gallon: "gal", gallons: "gal",
  g: "g", gram: "g", grams: "g", gr: "g",
  oz: "oz (dry)", ounce: "oz (dry)", ounces: "oz (dry)",
  lb: "lbs", lbs: "lbs", pound: "lbs", pounds: "lbs",
  each: "each", serving: "serving", servings: "serving",
}
// kg is not a Froot unit; expressed as g.
const KG = new Set(["kg", "kilogram", "kilograms"])

export type PrintedServing = { amount: number; printedUnit: string; unit: string | null; dimension: "weight" | "volume" | "count" | null }

export function parseServingText(text: string): PrintedServing[] {
  let t = text
  for (const [u, f] of Object.entries(UNICODE_FRACTIONS)) t = t.replaceAll(u, ` ${f}`)
  const out: PrintedServing[] = []
  const re = /(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+)\s*(fl\.?\s*oz\.?|fluid\s+ounces?|[a-zA-Z]+\.?)/gi
  for (const m of t.matchAll(re)) {
    let amount = parseAmount(m[1])
    if (amount === null || amount <= 0) continue
    const printedUnit = m[2].trim()
    const key = printedUnit.toLowerCase().replace(/[.\s]/g, "")
    let unit: string | null = UNIT_ALIASES[key] ?? null
    if (KG.has(key)) {
      unit = "g"
      amount *= 1000
    }
    // Anything else ("bar", "piece", "scoop", "container") is a count noun.
    const dimension = unit ? unitDimension(unit) : "count"
    out.push({ amount, printedUnit, unit, dimension })
  }
  return out
}

export type BasisChoice =
  | { ok: true; amount: number; unit: string; from: string }
  | { ok: false; reason: string }

const round4 = (x: number) => Math.round(x * 10000) / 10000

/** The printed serving in the ingredient's own dimension, as a basis the
 *  N-1 save route accepts — or why there is none (N1-F1: never convert). */
export function chooseBasis(servingSizeText: string, reportingUnit: string): BasisChoice {
  const dim = unitDimension(reportingUnit)
  const printed = parseServingText(servingSizeText)
  if (!servingSizeText.trim() || printed.length === 0) {
    return { ok: false, reason: "The label's serving size couldn't be read. Enter the basis by hand." }
  }
  if (dim === "count") {
    // A count ingredient's basis IS its reporting unit; a weight/volume serving says nothing about pieces.
    const c = printed.find((p) => p.dimension === "count")
    if (!c) return { ok: false, reason: `The label gives the serving only as ${printed.map((p) => `${p.amount} ${p.printedUnit}`).join(" / ")}; this ingredient is counted in ${reportingUnit}. Enter the basis by hand.` }
    return { ok: true, amount: c.amount, unit: reportingUnit, from: `${c.amount} ${c.printedUnit}` }
  }
  // Household measure first (FDA prints it first; the metric figure is a rounded equivalent).
  const match = printed.find((p) => p.dimension === dim && p.unit)
  if (!match || !match.unit) {
    const dims = [...new Set(printed.map((p) => p.dimension))].join(" and ")
    return {
      ok: false,
      reason: `The label gives the serving only by ${dims} (${servingSizeText.trim()}); this ingredient is counted by ${dim} (${reportingUnit}). Froot never converts between weight and volume — enter the basis by hand.`,
    }
  }
  const allowed = allowedBasisUnits(reportingUnit)
  const inReporting = convert(match.amount, match.unit, reportingUnit)
  // The ingredient's own unit when that is exact (1 cup → 8 fl. oz), otherwise the printed unit (30 g stays 30 g).
  if (inReporting !== null && Math.abs(inReporting - Math.round(inReporting * 100) / 100) < 1e-9) {
    return { ok: true, amount: round4(inReporting), unit: reportingUnit, from: `${match.amount} ${match.printedUnit}` }
  }
  if (allowed.includes(match.unit)) return { ok: true, amount: round4(match.amount), unit: match.unit, from: `${match.amount} ${match.printedUnit}` }
  return { ok: true, amount: round4(inReporting!), unit: reportingUnit, from: `${match.amount} ${match.printedUnit}` }
}

// ─── Nutrient values (N1C-F7, Gary 2026-11-02) ───────────────────────────────
// "'<1 g' pre-fills as 0.5 (FDA: printed '<1 g' means 0.5 to under 1 g) and
// '0 g' as 0, both flagged on the review screen. A nutrient printed only as
// %DV is converted using the FDA Daily Values, flagged. Nothing is left blank
// when the label gives a value."

// FDA "Daily Value on the Nutrition and Supplement Facts Labels", Reference
// Guide table (fda.gov, content current 03/05/2024), read 2026-11-02. Calories,
// trans fat and total sugars have no Daily Value.
export const FDA_DAILY_VALUES: Partial<Record<NutrientKey, number>> = {
  totalFatG: 78, saturatedFatG: 20, cholesterolMg: 300, sodiumMg: 2300, totalCarbG: 275, dietaryFiberG: 28,
  addedSugarsG: 50, proteinG: 50, vitaminDMcg: 20, calciumMg: 1300, ironMg: 18, potassiumMg: 4700,
}

// ─── Printed bounds (N1D-F3 / F3a, Gary 2026-11-02) ───────────────────────────
// "Cholesterol "<5 mg" pre-fills as 2; "<1 g" pre-fills as 0.5 for total
// carbohydrate, dietary fiber, total sugars, added sugars and protein, all
// flagged." "a fat value printed as "<1 g" (total, saturated or trans) is left
// blank and flagged as not a standard FDA fat declaration".
// Each fill is the LOW END of the band 21 CFR 101.9(c) gives the statement
// (law.cornell.edu/cfr/text/21/101.9, read 2026-11-02):
//   (c)(3) cholesterol: "2 to 5 milligrams … may be stated as 'less than 5
//          milligrams'" → 2.
//   (c)(6), (c)(6)(i)–(iii), (c)(7) carbohydrate, fiber, sugars, added sugars,
//          protein: "less than 1 gram" may be used below 1 g; below 0.5 g it
//          may be zero → 0.5.
//   (c)(2), (c)(2)(i)–(ii) fats: below 0.5 g "shall be expressed as zero" —
//          there is no "less than 1 gram" form, so no band to fill from.
// Keyed on the number and unit AS PRINTED. Any other bound stays blank, flagged.
const LESS_THAN_1G_KEYS: ReadonlySet<NutrientKey> = new Set([
  "totalCarbG", "dietaryFiberG", "totalSugarsG", "addedSugarsG", "proteinG",
])
const FAT_KEYS: ReadonlySet<NutrientKey> = new Set(["totalFatG", "saturatedFatG", "transFatG"])

function printedBound(key: NutrientKey, n: number, unit: string): ParsedValue {
  if (n === 1 && unit === "g" && LESS_THAN_1G_KEYS.has(key)) return { value: 0.5, flag: "LESS_THAN_1G" }
  if (n === 5 && unit === "mg" && key === "cholesterolMg") return { value: 2, flag: "LESS_THAN_5MG" }
  if (n === 1 && unit === "g" && FAT_KEYS.has(key)) return { value: null, flag: "LESS_THAN_1G_FAT" }
  return { value: null, flag: "LESS_THAN_OTHER" }
}

export type ValueFlag =
  | "LESS_THAN_1G" | "LESS_THAN_5MG" | "LESS_THAN_1G_FAT"
  | "ZERO" | "FROM_DV" | "UNIT_CONVERTED" | "LESS_THAN_OTHER" | "UNREADABLE"

export const FLAG_TEXT: Record<ValueFlag, string> = {
  LESS_THAN_1G: "Label says <1 g — filled as 0.5 g",
  LESS_THAN_5MG: "Label says <5 mg — filled as 2 mg",
  LESS_THAN_1G_FAT: "Label says <1 g — not a standard FDA fat declaration; enter it from the label",
  ZERO: "Label says 0 — FDA allows 0 for small amounts",
  FROM_DV: "Only a %DV is printed — converted with the FDA Daily Value",
  UNIT_CONVERTED: "Printed in a different unit — converted",
  LESS_THAN_OTHER: "Label gives only an upper limit — enter a value",
  UNREADABLE: "Couldn't read this value — enter it",
}

const MASS_TO_MG: Record<string, number> = { g: 1000, mg: 1, mcg: 0.001, "µg": 0.001, ug: 0.001 }

function nutrientUnit(key: NutrientKey): string {
  return NUTRIENTS.find((n) => n.key === key)!.unit
}

export type ParsedValue = { value: number | null; flag: ValueFlag | null }

/** One printed nutrient → the number Apply would save, in Froot's unit. */
export function parsePrintedValue(key: NutrientKey, printed: string, dailyValuePercent: string): ParsedValue {
  const target = nutrientUnit(key)
  const p = printed.trim().toLowerCase().replace(/,/g, "")
  if (p) {
    const m = p.match(/^(<|less than)?\s*(\d*\.?\d+)\s*(kcal|cal|calories|g|mg|mcg|µg|ug|iu)?$/)
    if (!m) return dvOrUnreadable(key, dailyValuePercent)
    const lessThan = Boolean(m[1])
    let n = Number(m[2])
    const unit = m[3] ?? (target === "kcal" ? "kcal" : target)
    let converted = false
    if (target === "kcal") {
      if (!["kcal", "cal", "calories"].includes(unit)) return { value: null, flag: "UNREADABLE" }
    } else if (unit === "iu") {
      // Older labels print vitamin D in IU; 1 mcg = 40 IU.
      if (key !== "vitaminDMcg") return { value: null, flag: "UNREADABLE" }
      n = n / 40
      converted = true
    } else if (unit !== target) {
      if (!(unit in MASS_TO_MG) || !(target in MASS_TO_MG)) return { value: null, flag: "UNREADABLE" }
      n = (n * MASS_TO_MG[unit]) / MASS_TO_MG[target]
      converted = true
    }
    if (lessThan) return printedBound(key, Number(m[2]), unit)
    const value = round4(n)
    if (value === 0) return { value: 0, flag: "ZERO" }
    return { value, flag: converted ? "UNIT_CONVERTED" : null }
  }
  return dvOrUnreadable(key, dailyValuePercent)
}

function dvOrUnreadable(key: NutrientKey, dailyValuePercent: string): ParsedValue {
  const m = dailyValuePercent.trim().match(/^(\d*\.?\d+)\s*%?$/)
  const dv = FDA_DAILY_VALUES[key]
  if (m && dv !== undefined) {
    const value = Math.round(((Number(m[1]) / 100) * dv) * 100) / 100
    return { value, flag: value === 0 ? "ZERO" : "FROM_DV" }
  }
  // The model listed the nutrient, so something is printed; nothing usable was.
  return { value: null, flag: "UNREADABLE" }
}

// ─── Allergens (deliverable 1) ───────────────────────────────────────────────
// Read from the printed Contains text in CODE, and compared with the model's
// own mapping. Tree nuts are FDA Table 1 — "Questions and Answers Regarding
// Food Allergens … (Edition 5)", January 2025, read 2026-11-02. Coconut is not
// in Table 1 (the word does not appear in the guidance), and tree nuts not in
// Table 1 "should not be included in the 'Contains' statement".
const ALLERGEN_WORDS: Record<Allergen, RegExp> = {
  MILK: /\b(milk|whey|casein(ate)?s?|cream|butter|cheese|yogh?urt|lactose|dairy)\b/i,
  EGGS: /\beggs?\b/i,
  FISH: /\b(fish|anchov(y|ies)|bass|cod|flounder|haddock|pollock|salmon|sardines?|tilapia|trout|tuna)\b/i,
  CRUSTACEAN_SHELLFISH: /\b(crustacean|shellfish|crabs?|lobsters?|shrimps?|prawns?|crawfish|crayfish|krill)\b/i,
  TREE_NUTS:
    /\b(tree\s*nuts?|almonds?|black\s+walnuts?|brazil\s+nuts?|california\s+walnuts?|cashews?|filberts?|hazelnuts?|heartnuts?|japanese\s+walnuts?|macadamias?(\s+nuts?)?|bush\s+nuts?|pecans?|pine\s+nuts?|pi[nñ]on\s+nuts?|pistachios?|walnuts?)\b/i,
  PEANUTS: /\bpeanuts?\b/i,
  WHEAT: /\bwheat\b/i,
  SOYBEANS: /\b(soy|soya|soybeans?)\b/i,
  SESAME: /\bsesame\b/i,
}

export function allergensFromText(text: string): Allergen[] {
  return sortAllergens(ALLERGENS.map((a) => a.value).filter((a) => ALLERGEN_WORDS[a].test(text)))
}

export type AllergenReview = {
  proposed: Allergen[]
  onlyText: Allergen[]   // the printed line names it, the model didn't map it
  onlyModel: Allergen[]  // the model mapped it, the printed line doesn't say so
  notes: string[]
}

// Union, not intersection: an allergen either side finds is proposed, and the
// disagreement is shown. Under-declaring is the failure that hurts someone.
export function reviewAllergens(containsText: string, modelAllergens: Allergen[]): AllergenReview {
  const fromText = allergensFromText(containsText)
  const fromModel = sortAllergens(modelAllergens)
  const notes: string[] = []
  if (/\bcoconuts?\b/i.test(containsText)) {
    notes.push("Coconut is printed, but FDA doesn't count it as a tree nut (2025 guidance) — not checked. Tick Tree nuts yourself if you want it flagged.")
  }
  if (!containsText.trim()) notes.push("No “Contains” line was read. Check the ingredient list on the label.")
  return {
    proposed: sortAllergens([...fromText, ...fromModel]),
    onlyText: fromText.filter((a) => !fromModel.includes(a)),
    onlyModel: fromModel.filter((a) => !fromText.includes(a)),
    notes,
  }
}

// ─── Name check (N1C-F3, Gary 2026-11-02: "Name mismatch is a warning plus a
// 'This is the product we use' tickbox, checked in code.") ────────────────────
export const VARIANT_WORDS = new Set([
  "original", "unsweetened", "sweetened", "vanilla", "chocolate", "strawberry", "light", "lite", "zero", "sugarfree",
  "nosugar", "organic", "barista", "plain", "unflavored", "reduced", "lowfat", "nonfat", "fatfree", "whole", "skim",
  "decaf", "diet", "keto", "honey", "salted", "unsalted",
])
const STOP_WORDS = new Set(["the", "and", "of", "with", "a", "brand", "inc", "co", "company", "foods", "beverage", "drink"])

export function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/sugar[\s-]+free/g, "sugarfree")
    .replace(/no[\s-]+sugar(\s+added)?/g, "nosugar")
    .replace(/(low|non|fat)[\s-]+(fat|free)/g, "$1$2")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
}

/** A warning when the printed product doesn't plausibly match the ingredient, else null. */
export function nameWarning(label: { productName: string; brand: string }, ingredient: { name: string; brand: string | null }): string | null {
  const printed = `${label.brand} ${label.productName}`.trim()
  if (!printed) return "The label's product name couldn't be read — check it's the product you use."
  const lw = words(printed)
  const iw = words(`${ingredient.brand ?? ""} ${ingredient.name}`)
  const lv = lw.filter((w) => VARIANT_WORDS.has(w))
  const iv = iw.filter((w) => VARIANT_WORDS.has(w))
  if (lv.length && iv.length && (lv.some((w) => !iv.includes(w)) || iv.some((w) => !lv.includes(w)))) {
    return `The label says “${lv.join(", ")}” but this ingredient says “${iv.join(", ")}”.`
  }
  // "almondmilk" on the label still matches "almond milk" here. More than half
  // the ingredient's words must appear — one shared word ("milk" in "Oatmilk")
  // is not a match. Size tokens ("32oz") are BevSpot packaging, not the product.
  const squashed = lw.join("")
  const significant = iw.filter((w) => !VARIANT_WORDS.has(w) && !/\d/.test(w))
  if (significant.length && significant.filter((w) => squashed.includes(w)).length * 2 <= significant.length) {
    return `The label's product (“${printed}”) doesn't mention this ingredient's name.`
  }
  return null
}

// ─── The review screen's model (deliverable 3) ───────────────────────────────

export type StoredNutrition = { basisAmount: number; basisUnit: string; values: Record<NutrientKey, number | null> } | null

/** The saved numbers a review compares against, from the serialized record
 *  GET /api/nutrition/ingredients/[id] returns. A proof-only record has no
 *  numbers to compare against (N1D-F1). Shared by the dialog and the N-1e
 *  queue so the two reviews can't differ. */
export function storedForReview(
  n: ({ basisAmount: number | null; basisUnit: string | null } & Partial<Record<NutrientKey, number | null>>) | null
): StoredNutrition {
  if (!n || n.basisAmount === null || n.basisUnit === null) return null
  return { basisAmount: n.basisAmount, basisUnit: n.basisUnit, values: Object.fromEntries(NUTRIENTS.map((nt) => [nt.key, n[nt.key] ?? null])) as Record<NutrientKey, number | null> }
}

export type NutrientRow = {
  key: NutrientKey
  label: string
  unit: string
  printed: string
  proposed: number | null
  flag: ValueFlag | null
  /** The stored value rescaled to the label's basis, when the two bases share a dimension. */
  storedOnLabelBasis: number | null
  differs: boolean
}

export type LabelReview = {
  productName: string
  servingSizeText: string
  basis: BasisChoice
  nutrients: NutrientRow[]
  allergens: AllergenReview
  storedAllergens: Allergen[]
  containsText: string
  mayContainText: string
  nameWarning: string | null
  unreadable: string[]
}

export function buildLabelReview(
  output: LabelOutput,
  ingredient: { name: string; brand: string | null; reportingUnit: string; allergens: Allergen[] },
  stored: StoredNutrition
): LabelReview {
  const basis = chooseBasis(output.servingSizeText, ingredient.reportingUnit)
  const unreadable = [...output.unreadable]
  const nutrients: NutrientRow[] = NUTRIENTS.map((nt) => {
    const printed = output.nutrients.find((x) => x.key === nt.key)
    const parsed = printed ? parsePrintedValue(nt.key, printed.printed, printed.dailyValuePercent) : { value: null, flag: null }
    let storedOnLabelBasis: number | null = null
    if (stored && stored.values[nt.key] !== null && basis.ok) {
      const factor = convert(basis.amount, basis.unit, stored.basisUnit)
      if (factor !== null) storedOnLabelBasis = round4((stored.values[nt.key]! * factor) / stored.basisAmount)
    }
    const differs =
      parsed.value !== null && storedOnLabelBasis !== null
        ? Math.abs(parsed.value - storedOnLabelBasis) > Math.max(0.05, Math.abs(storedOnLabelBasis) * 0.02)
        : parsed.value !== storedOnLabelBasis
    if (printed && parsed.flag === "UNREADABLE") unreadable.push(`${nt.label}: “${printed.printed || printed.dailyValuePercent}”`)
    return {
      key: nt.key,
      label: nt.label,
      unit: nt.unit,
      printed: printed ? [printed.printed, printed.dailyValuePercent && `${printed.dailyValuePercent.replace(/%$/, "")}% DV`].filter(Boolean).join(" · ") : "",
      proposed: parsed.value,
      flag: parsed.flag,
      storedOnLabelBasis,
      differs,
    }
  })
  return {
    productName: `${output.brand} ${output.productName}`.trim(),
    servingSizeText: output.servingSizeText,
    basis,
    nutrients,
    allergens: reviewAllergens(output.containsText, output.allergens),
    storedAllergens: sortAllergens(ingredient.allergens),
    containsText: output.containsText,
    mayContainText: output.mayContainText,
    nameWarning: nameWarning(output, ingredient),
    unreadable,
  }
}

// ─── Instructions sent with the document ─────────────────────────────────────
export const LABEL_READ_INSTRUCTIONS = `You are reading a food product's label from the attached document (a supplier spec sheet, a screenshot, or a photo of packaging). Transcribe what is PRINTED. Do not estimate, calculate, convert or round anything.

- isNutritionLabel: true only if a Nutrition Facts panel (or an equivalent nutrition table) is visible.
- productName / brand: exactly as printed on the label, including variant words such as "Original" or "Unsweetened". "" if not visible.
- servingSizeText: the "Serving size" text exactly as printed, including any parenthetical alternate, e.g. "1 cup (240mL)" or "2 tbsp (30g)". "" if not visible.
- nutrients: one entry per nutrient present on the panel, using these keys: ${NUTRIENTS.map((n) => `${n.key} = ${n.label}`).join("; ")}. "printed" is the amount exactly as printed including its unit and any "<" or "less than" (e.g. "2.5g", "<1g", "150mg", "0mcg", "60" for calories). "dailyValuePercent" is the %DV as printed (e.g. "11%"), or "" if none. If only a %DV is printed, leave "printed" as "". Omit nutrients that are not on the label at all. Use the per-serving column when the panel has several.
- containsText: the allergen statement that begins "Contains" exactly as printed, or "" if there is none. mayContainText: any "may contain" / "processed in a facility" statement, or "".
- allergens: the major allergens the Contains statement names, mapped to: ${ALLERGENS.map((a) => `${a.value} (${a.label})`).join(", ")}. Only what the Contains statement says.
- unreadable: anything you could not read with confidence (blurry, cut off, glare), described briefly. [] if none.`
