import type { Allergen } from "@prisma/client"
import { NUTRIENT_KEYS, allergenLabel, type NutrientKey, type NutrientValues } from "@/lib/nutrition"
import type { ItemVerification } from "@/lib/nutrition-proof"
import { FDA_DAILY_VALUES } from "@/lib/label-review"

// ─── Nutrition Facts label (N-2) ─────────────────────────────────────────────
// PURE — no database, so it runs on the server and in the browser (the
// preview's serving-size picker re-renders with it) and scripts/verify-n2-label.ts
// pins it. It is a PRESENTATION of the engine's totals
// (computeRecipeNutrition, src/lib/recipe-nutrition.ts): it scales and rounds,
// it never walks a recipe, so there is one nutrition calculation in the app.
//
// Rulings: docs/DECISIONS.md 2026-11-02 N-2 (Gary, DRAFT), forks N2-F1–F6 and
// R-1–R-8; audit docs/prompts/N-2_AUDIT.md § B. Every rounding rule below is
// 21 CFR 101.9 as read 2026-11-02 (law.cornell.edu/cfr/text/21/101.9, and the
// govinfo CFR edition dated 2024-04-01 for (c)(7) and (c)(8)). The panel is
// voluntary for a made-to-order item (audit B10; Gary R-1: "the panel is
// voluntary"); the rounding is 101.9(c) strictly (F5).

/** F1 / R-1 (Gary): "12 fl oz default, changeable in settings." */
export const DEFAULT_SERVING_FL_OZ = 12
/** 101.9(b)(5)(viii): "1 fl oz means 30 mL" — so R-8 "12 fl oz (360 mL)". */
export const ML_PER_FL_OZ = 30
/** Bounds an ADMIN may enter for a serving size or an item volume, fl oz. */
export const MAX_FL_OZ = 200

// ─── Serving resolution (F1, F3, F6) ──────────────────────────────────────────
// "Volume comes from the org size table keyed by the exact Square variation
// name, plus a per-item override that can set a volume, a serving size, or
// 'per item'. Never inferred from the cup kit." Precedence: override → table →
// per item. The name is matched EXACTLY — nothing is guessed when a label is
// drawn (F6); suggestVolumeFromName only pre-fills the settings screen.

export type ItemOverride = { perItem: boolean; volumeFlOz: number | null; servingFlOz: number | null }

export type ServingSpec =
  | { kind: "perItem"; source: "override" | "noVolume" }
  | {
      kind: "volume"
      volumeFlOz: number
      servingFlOz: number
      volumeSource: "override" | "table"
      servingSource: "override" | "org" | "default"
    }

export function resolveServing(input: {
  variationName: string
  orgServingFlOz: number | null
  sizeTable: ReadonlyMap<string, number>
  override: ItemOverride | null
}): ServingSpec {
  const o = input.override
  if (o?.perItem) return { kind: "perItem", source: "override" }
  const fromOverride = o?.volumeFlOz ?? null
  const fromTable = input.sizeTable.get(input.variationName) ?? null
  const volumeFlOz = fromOverride ?? fromTable
  if (volumeFlOz === null) return { kind: "perItem", source: "noVolume" }
  const servingFlOz = o?.servingFlOz ?? input.orgServingFlOz ?? DEFAULT_SERVING_FL_OZ
  return {
    kind: "volume",
    volumeFlOz,
    servingFlOz,
    volumeSource: fromOverride !== null ? "override" : "table",
    servingSource: o?.servingFlOz != null ? "override" : input.orgServingFlOz != null ? "org" : "default",
  }
}

/** F6: a volume read from a name like "20oz.", "12 oz", "Kids (12oz)", "32 Oz." — a SUGGESTION for the settings screen only. */
export function suggestVolumeFromName(name: string): number | null {
  const m = name.match(/(\d+(?:\.\d+)?)\s*(?:fl\.?\s*)?oz\b/i)
  if (!m) return null
  const v = Number(m[1])
  return v > 0 && v <= MAX_FL_OZ ? v : null
}

export function flOzError(v: number, what: string): string | null {
  if (!Number.isFinite(v) || v <= 0) return `${what} must be greater than 0`
  if (v > MAX_FL_OZ) return `${what} must be ${MAX_FL_OZ} fl oz or less`
  return null
}

// ─── Servings per container — 101.9(b)(6), (b)(8)(i) ─────────────────────────
// R-3 (Gary): "Apply the single-serving rule (an item under 200% of the
// serving size is one serving of the whole item)." (b)(6): "contains less than
// 200 percent of the applicable reference amount … the entire content of the
// product must be labeled as one serving."
// (b)(8)(i): "rounded to the nearest whole number except for the number of
// servings between 2 and 5 … rounded to the nearest 0.5 serving. Rounding
// should be indicated by the use of the term about".
// R-2 (Gary): "Exact ratio for per-serving values; the label prints the
// rounded servings per container." So `ratio` scales, `declared` is printed.

export type Servings =
  | { single: true; ratio: number }
  | { single: false; ratio: number; declared: number; about: boolean }

const EPS = 1e-9

/** Round to a step, half up, without float noise (0.15 → 0.2 at 0.1). */
export function roundStep(x: number, step: number): number {
  const decimals = step < 1 ? Math.ceil(-Math.log10(step)) : 0
  return Number((Math.round(x / step + EPS) * step).toFixed(decimals))
}

export function servingsFor(volumeFlOz: number, servingFlOz: number): Servings {
  const ratio = volumeFlOz / servingFlOz
  if (ratio < 2 - EPS) return { single: true, ratio }
  const declared = ratio <= 5 + EPS ? roundStep(ratio, 0.5) : roundStep(ratio, 1)
  return { single: false, ratio, declared, about: Math.abs(declared - ratio) > EPS }
}

// ─── Nutrient rounding — 101.9(c) (F5, R-6) ───────────────────────────────────
// Each function takes the ACTUAL amount in one column and returns what the
// label declares. `amount` is the declared number %DV is computed from (R-4);
// null for a "less than" statement, whose %DV uses the actual amount, which
// 101.9(d)(7)(ii) allows ("either the amount declared on the label … or the
// actual amount").

export type Declared = { text: string; amount: number | null; actual: number }

const num = (v: number) => String(v)
const dec = (amount: number, unit: string, actual: number): Declared => ({ text: `${num(amount)}${unit}`, amount, actual })
const lessThan = (text: string, actual: number): Declared => ({ text, amount: null, actual })

/** (c)(1): "<5 → 0; nearest 5-calorie increment up to and including 50 calories, and 10-calorie increment above 50". */
export function roundCalories(x: number): Declared {
  if (x < 5) return dec(0, "", x)
  return dec(x <= 50 ? roundStep(x, 5) : roundStep(x, 10), "", x)
}

/** (c)(2), (c)(2)(i), (c)(2)(ii): <0.5 g → 0; 0.5 g steps below 5 g; whole grams above. Exactly 5 g → nearest gram (R-6). */
export function roundFat(x: number): Declared {
  if (x < 0.5) return dec(0, "g", x)
  return dec(x < 5 ? roundStep(x, 0.5) : roundStep(x, 1), "g", x)
}

/** (c)(3): <2 mg → 0; 2 to <5 mg "less than 5 mg" (R-6); otherwise nearest 5 mg. */
export function roundCholesterol(x: number): Declared {
  if (x < 2) return dec(0, "mg", x)
  if (x < 5) return lessThan("<5mg", x)
  return dec(roundStep(x, 5), "mg", x)
}

/** (c)(4): <5 mg → 0; nearest 5 mg for 5–140 mg; nearest 10 mg above 140 mg. */
export function roundSodium(x: number): Declared {
  if (x < 5) return dec(0, "mg", x)
  return dec(x <= 140 ? roundStep(x, 5) : roundStep(x, 10), "mg", x)
}

/** (c)(6), (c)(6)(i)–(iii), (c)(7): <0.5 g → 0; 0.5 to <1 g "less than 1 gram" (R-6); otherwise nearest gram. */
export function roundGram(x: number): Declared {
  if (x < 0.5) return dec(0, "g", x)
  if (x < 1) return lessThan("<1g", x)
  return dec(roundStep(x, 1), "g", x)
}

/**
 * (c)(8)(iii): amounts use "the levels of significance given in paragraph
 * (c)(8)(iv)" — RDIs 20 mcg, 1,300 mg, 18 mg, 4,700 mg, all whole — "and
 * additional levels of significance may be used when the number of decimal
 * places indicated is not sufficient to express lower amounts". R-5 (Gary):
 * "declared in whole units, with one decimal only when the amount is below 1
 * unit (e.g. iron 0.7 mg, vitamin D 0.3 mcg)." Potassium is on this rule, not
 * the sodium bands (those were the pre-2016 (c)(5); DECISIONS N-2 R-5).
 */
export function roundVitaminMineral(x: number, unit: string): Declared {
  if (x < 1) return dec(roundStep(x, 0.1), unit, x)
  return dec(roundStep(x, 1), unit, x)
}

const ROUNDERS: Record<Exclude<NutrientKey, "calories">, (x: number) => Declared> = {
  totalFatG: roundFat,
  saturatedFatG: roundFat,
  transFatG: roundFat,
  cholesterolMg: roundCholesterol,
  sodiumMg: roundSodium,
  totalCarbG: roundGram,
  dietaryFiberG: roundGram,
  totalSugarsG: roundGram,
  addedSugarsG: roundGram,
  proteinG: roundGram,
  vitaminDMcg: (x) => roundVitaminMineral(x, "mcg"),
  calciumMg: (x) => roundVitaminMineral(x, "mg"),
  ironMg: (x) => roundVitaminMineral(x, "mg"),
  potassiumMg: (x) => roundVitaminMineral(x, "mg"),
}

// ─── %DV — 101.9(d)(7)(ii), (c)(8)(iii) ───────────────────────────────────────
// Daily Values: FDA_DAILY_VALUES (N-1c), which matches 101.9(c)(9) and the
// (c)(8)(iv) adult RDIs exactly (audit B8). No %DV for calories, trans fat or
// total sugars (none exists), nor protein: (c)(7)(i) makes it voluntary and
// requires a protein-quality (PDCAAS) correction Froot has no data for.

const VITAMIN_MINERAL_KEYS: ReadonlySet<NutrientKey> = new Set(["vitaminDMcg", "calciumMg", "ironMg", "potassiumMg"])
const NO_DV_ON_LABEL: ReadonlySet<NutrientKey> = new Set(["calories", "transFatG", "totalSugarsG", "proteinG"])

/** (d)(7)(ii): macronutrients "expressed to the nearest whole percent". */
export function macroDvPercent(amount: number, dv: number): number {
  return roundStep((amount / dv) * 100, 1)
}

/**
 * (c)(8)(iii): "nearest 2-percent increment up to and including the 10-percent
 * level, the nearest 5-percent increment above 10 percent and up to and
 * including the 50-percent level, and the nearest 10-percent increment above
 * the 50-percent level." Below 2 %: "0" (R-7, Gary: "Yes" — no asterisk).
 */
export function vitaminMineralDvPercent(amount: number, rdi: number): number {
  const p = (amount / rdi) * 100
  if (p < 2 - EPS) return 0
  if (p <= 10 + EPS) return roundStep(p, 2)
  if (p <= 50 + EPS) return roundStep(p, 5)
  return roundStep(p, 10)
}

export function dvPercent(key: NutrientKey, d: Declared): number | null {
  if (NO_DV_ON_LABEL.has(key)) return null
  const dv = FDA_DAILY_VALUES[key]
  if (dv === undefined) return null
  // R-4: "%DV from the rounded amount the label shows"; a "less than"
  // statement has no number, so it uses the actual amount ((d)(7)(ii)).
  const basis = d.amount ?? d.actual
  return VITAMIN_MINERAL_KEYS.has(key) ? vitaminMineralDvPercent(basis, dv) : macroDvPercent(basis, dv)
}

// ─── The label ────────────────────────────────────────────────────────────────

/** One declared line. `missing` = the engine has no number (F4: "—", never 0). */
export type LabelValue =
  | { missing: true; text: "—"; dv: null }
  | { missing: false; text: string; dv: number | null }

export type LabelColumn = { heading: string; values: Record<NutrientKey, LabelValue> }

export type NutritionLabel = {
  /** "12 fl oz (360 mL)" or "1 item" */
  servingSize: string
  /** "2 servings per container", "about 2.5 servings per container" */
  servingsPerContainer: string
  /** F2 (Gary): "Two columns (per serving and per container) whenever there is more than one serving." */
  dual: boolean
  columns: LabelColumn[]
  /** "Contains: Milk, Tree nuts" — the engine's union of every ingredient's allergens; null when none recorded */
  contains: string | null
  allergens: Allergen[]
  /** nutrients shown as "—" */
  missing: NutrientKey[]
  /** F4: "banner on any item not fully Verified, including items with no food ingredients" */
  estimated: boolean
  spec: ServingSpec
  servings: Servings | null
}

/** F4 (Gary): "An item whose calculation has an error shows the error and a link to the recipe, no label." */
export type LabelResult = { ok: true; label: NutritionLabel } | { ok: false; error: string }

/** Label row order, names and indentation — 101.9(c) order, 2016 format names. */
export const LABEL_ROWS: { key: NutrientKey; label: string; indent: 0 | 1 | 2; bold: boolean }[] = [
  { key: "totalFatG", label: "Total Fat", indent: 0, bold: true },
  { key: "saturatedFatG", label: "Saturated Fat", indent: 1, bold: false },
  { key: "transFatG", label: "Trans Fat", indent: 1, bold: false },
  { key: "cholesterolMg", label: "Cholesterol", indent: 0, bold: true },
  { key: "sodiumMg", label: "Sodium", indent: 0, bold: true },
  { key: "totalCarbG", label: "Total Carbohydrate", indent: 0, bold: true },
  { key: "dietaryFiberG", label: "Dietary Fiber", indent: 1, bold: false },
  { key: "totalSugarsG", label: "Total Sugars", indent: 1, bold: false },
  // (c)(6)(iii): "Includes X g Added Sugars", indented under total sugars.
  { key: "addedSugarsG", label: "Added Sugars", indent: 2, bold: false },
  { key: "proteinG", label: "Protein", indent: 0, bold: true },
]
/** (c)(8)(ii): "vitamin D, calcium, iron, and potassium in that order". */
export const LABEL_MICRO_ROWS: { key: NutrientKey; label: string }[] = [
  { key: "vitaminDMcg", label: "Vitamin D" },
  { key: "calciumMg", label: "Calcium" },
  { key: "ironMg", label: "Iron" },
  { key: "potassiumMg", label: "Potassium" },
]
/** (d)(9) footnote, verbatim. */
export const DV_FOOTNOTE =
  "The % Daily Value tells you how much a nutrient in a serving of food contributes to a daily diet. 2,000 calories a day is used for general nutrition advice."

export function formatFlOz(flOz: number): string {
  return `${roundStep(flOz, 0.1)} fl oz (${Math.round(flOz * ML_PER_FL_OZ)} mL)`
}

function column(totals: NutrientValues, factor: number, heading: string): LabelColumn {
  const values = {} as Record<NutrientKey, LabelValue>
  for (const k of NUTRIENT_KEYS) {
    const t = totals[k]
    if (t === null) {
      values[k] = { missing: true, text: "—", dv: null }
      continue
    }
    const d = k === "calories" ? roundCalories(t * factor) : ROUNDERS[k](t * factor)
    values[k] = { missing: false, text: d.text, dv: dvPercent(k, d) }
  }
  return { heading, values }
}

export function buildLabel(
  item: { totals: NutrientValues; allergens: Allergen[]; error: string | null; verification: ItemVerification },
  spec: ServingSpec
): LabelResult {
  if (item.error) return { ok: false, error: item.error }

  let servingSize: string
  let servingsPerContainer: string
  let servings: Servings | null = null
  let columns: LabelColumn[]

  if (spec.kind === "perItem") {
    // F1: "anything not in the size table is labeled per item" — 1 serving = the whole item.
    servingSize = "1 item"
    servingsPerContainer = "1 serving per container"
    columns = [column(item.totals, 1, "Amount per serving")]
  } else {
    servings = servingsFor(spec.volumeFlOz, spec.servingFlOz)
    if (servings.single) {
      // R-3 / (b)(6): the whole item is the one serving.
      servingSize = formatFlOz(spec.volumeFlOz)
      servingsPerContainer = "1 serving per container"
      columns = [column(item.totals, 1, "Amount per serving")]
    } else {
      servingSize = formatFlOz(spec.servingFlOz)
      servingsPerContainer = `${servings.about ? "about " : ""}${num(servings.declared)} servings per container`
      // R-2: per serving = totals × serving ÷ volume (the exact ratio).
      columns = [
        column(item.totals, spec.servingFlOz / spec.volumeFlOz, "Per serving"),
        column(item.totals, 1, "Per container"),
      ]
    }
  }

  return {
    ok: true,
    label: {
      servingSize,
      servingsPerContainer,
      dual: columns.length === 2,
      columns,
      contains: item.allergens.length ? `Contains: ${item.allergens.map(allergenLabel).join(", ")}` : null,
      allergens: item.allergens,
      missing: NUTRIENT_KEYS.filter((k) => item.totals[k] === null),
      estimated: item.verification !== "VERIFIED",
      spec,
      servings,
    },
  }
}
