import Papa from "papaparse"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import type { Allergen, NutritionStatus } from "@prisma/client"
import { normName } from "@/lib/bevspot/plan-import"
import {
  IMPORT_COLUMNS, NUTRIENTS, NUTRIENT_KEYS, allergenLabel, emptyNutrients, hasNutrition, ingredientDisplayName, nutritionInputError, sortAllergens,
  type NutrientKey, type NutrientValues, type NutritionInput,
} from "@/lib/nutrition"
import { numbersChanged, parseSourceUrl, type ProofState } from "@/lib/nutrition-proof"

// ─── CSV import (N-1 deliverable 4) ───────────────────────────────────────────
// Columns (header case/spacing/punctuation ignored):
//   name (required) · brand (optional) · basis_amount · basis_unit ·
//   one column per nutrient (NUTRIENTS[].csv) · allergens (optional, "milk;
//   tree nuts") · not_food (optional, yes/no) · source (optional) ·
//   source_url (optional, N-1b — http/https; blank clears the stored link)
// Matching is BEV-1 F5 exactly: whitespace/case folding on name, or on
// brand + " " + name. Never creates ingredients.

export type NutritionCsvRow = {
  rowNumber: number // 1-based, header excluded — what a spreadsheet user sees as row N+1
  cells: Record<string, string> // folded header → raw cell
}

export type NutritionCsv = { rows: NutritionCsvRow[]; headers: string[]; error: string | null }

function foldHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")
}

export function parseNutritionCsv(text: string): NutritionCsv {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" })
  const [header, ...body] = parsed.data
  if (!header || header.length === 0) return { rows: [], headers: [], error: "The file is empty" }
  const headers = header.map(foldHeader)
  if (!headers.includes("name")) return { rows: [], headers, error: 'The file needs a "name" column' }
  const rows = body.map((cells, i) => ({
    rowNumber: i + 1,
    cells: Object.fromEntries(headers.map((h, j) => [h, (cells[j] ?? "").trim()])),
  }))
  return { rows, headers, error: null }
}

const ALLERGEN_WORDS: Record<string, Allergen> = {
  milk: "MILK", dairy: "MILK",
  egg: "EGGS", eggs: "EGGS",
  fish: "FISH",
  shellfish: "CRUSTACEAN_SHELLFISH", crustacean_shellfish: "CRUSTACEAN_SHELLFISH", crustacean: "CRUSTACEAN_SHELLFISH",
  tree_nut: "TREE_NUTS", tree_nuts: "TREE_NUTS",
  peanut: "PEANUTS", peanuts: "PEANUTS",
  wheat: "WHEAT",
  soy: "SOYBEANS", soybean: "SOYBEANS", soybeans: "SOYBEANS",
  sesame: "SESAME",
}

export function parseAllergenList(raw: string): { allergens: Allergen[] } | { error: string } {
  const out: Allergen[] = []
  for (const token of raw.split(/[;,|]/).map((t) => foldHeader(t)).filter(Boolean)) {
    if (token === "none") continue
    const a = ALLERGEN_WORDS[token]
    if (!a) return { error: `Unknown allergen "${token.replace(/_/g, " ")}"` }
    out.push(a)
  }
  return { allergens: sortAllergens(out) }
}

function parseYesNo(raw: string): boolean | null | "bad" {
  const v = raw.trim().toLowerCase()
  if (v === "") return null
  if (["y", "yes", "true", "1", "x"].includes(v)) return true
  if (["n", "no", "false", "0"].includes(v)) return false
  return "bad"
}

export type PlanIngredientRef = {
  id: string
  name: string
  brand: string | null
  reportingUnit: string
  kind: string
  /** what is stored now — B compares the row against it */
  nutrition: NutritionInput | null
  allergens: Allergen[]
  nutritionExempt: boolean
  /** N-1b — the stored proof link and status (absent = no record / not loaded) */
  sourceUrl?: string | null
  status?: NutritionStatus | null
}

// N-1a (Gary, 2026-11-01): A — every nutrient blank on an ingredient with no
// record does nothing; B — a row identical to what is stored is UNCHANGED and
// not written. DETAILS_ONLY = allergens, the not-food flag and/or (N-1b) the
// source link change while the nutrition numbers do not.
export type NutritionRowStatus =
  | "NEW" | "UPDATE" | "DETAILS_ONLY" | "NOT_FOOD" | "UNCHANGED" | "UNMATCHED" | "AMBIGUOUS" | "DUPLICATE" | "INVALID"

export type NutritionRowPlan = {
  rowNumber: number
  label: string // the name as written (brand + name when both columns given)
  status: NutritionRowStatus
  detail: string | null
  ingredientId: string | null
  ingredientName: string | null
  /** set when status is applyable. Each part is null when it is left as is —
   *  absent from the file, or identical to what is stored (N-1a). */
  write: {
    nutrition: NutritionInput | null // never set on NOT_FOOD / DETAILS_ONLY rows
    allergens: Allergen[] | null
    nutritionExempt: boolean | null
    /** N-1b: null = leave the stored link as is; { url: null } clears it */
    sourceUrl?: { url: string | null } | null
    /** N-1b, F3: "Import changes reset to Estimated" — true only when a VERIFIED
     *  record's basis, numbers, allergens or source link change. The import
     *  never sets VERIFIED. */
    resetStatus?: boolean
  } | null
}

export const RESET_DETAIL = "Verified → Estimated (the change needs re-verifying)"

export const APPLYABLE: ReadonlySet<NutritionRowStatus> = new Set(["NEW", "UPDATE", "DETAILS_ONLY", "NOT_FOOD"])

function sameNutrition(a: NutritionInput, b: NutritionInput): boolean {
  return (
    a.basisAmount === b.basisAmount &&
    a.basisUnit === b.basisUnit &&
    (a.sourceNote || null) === (b.sourceNote || null) &&
    NUTRIENT_KEYS.every((k) => a.values[k] === b.values[k])
  )
}

function sameAllergens(a: Allergen[], b: Allergen[]): boolean {
  const x = sortAllergens(a), y = sortAllergens(b)
  return x.length === y.length && x.every((v, i) => v === y[i])
}

export function planNutritionImport(csv: NutritionCsv, ingredients: PlanIngredientRef[]): NutritionRowPlan[] {
  const byKey = new Map<string, Map<string, PlanIngredientRef>>()
  for (const ing of ingredients) {
    const keys = [normName(ing.name)]
    if (ing.brand && ing.brand.trim()) keys.push(normName(`${ing.brand} ${ing.name}`))
    for (const k of keys) {
      if (!byKey.has(k)) byKey.set(k, new Map())
      byKey.get(k)!.set(ing.id, ing)
    }
  }
  const hasAllergenCol = csv.headers.includes("allergens")
  const hasSourceUrlCol = csv.headers.includes("source_url")
  const plans: NutritionRowPlan[] = []
  const seen = new Map<string, number>() // ingredientId → first rowNumber

  for (const row of csv.rows) {
    const c = row.cells
    const name = c.name ?? ""
    const brand = c.brand ?? ""
    const label = brand ? `${brand} ${name}` : name
    const base = { rowNumber: row.rowNumber, label, ingredientId: null, ingredientName: null, write: null }
    const invalid = (detail: string, ing?: PlanIngredientRef): NutritionRowPlan => ({
      ...base, status: "INVALID", detail,
      ingredientId: ing?.id ?? null, ingredientName: ing ? ingredientDisplayName(ing) : null,
    })

    if (!name) { plans.push(invalid("No name")); continue }
    const matches = byKey.get(normName(label))
    if (!matches || matches.size === 0) {
      plans.push({ ...base, status: "UNMATCHED", detail: "No ingredient has this name" })
      continue
    }
    if (matches.size > 1) {
      plans.push({ ...base, status: "AMBIGUOUS", detail: `${matches.size} ingredients match this name` })
      continue
    }
    const ing = [...matches.values()][0]
    const firstRow = seen.get(ing.id)
    if (firstRow !== undefined) {
      plans.push({ ...base, status: "DUPLICATE", detail: `Row ${firstRow} already sets this ingredient`, ingredientId: ing.id, ingredientName: ingredientDisplayName(ing) })
      continue
    }
    seen.set(ing.id, row.rowNumber)
    if (ing.kind === "PREPARED") {
      plans.push(invalid("Prepared ingredient — its nutrition is computed from its recipe", ing))
      continue
    }

    let allergens: Allergen[] | null = null
    if (hasAllergenCol) {
      const parsed = parseAllergenList(c.allergens ?? "")
      if ("error" in parsed) { plans.push(invalid(parsed.error, ing)); continue }
      allergens = parsed.allergens
    }
    const notFood = parseYesNo(c.not_food ?? "")
    if (notFood === "bad") { plans.push(invalid(`not_food must be yes or no, not "${c.not_food}"`, ing)); continue }
    // N-1b: undefined = column absent (leave as is); null = blank (clear).
    let sourceUrl: string | null | undefined = undefined
    if (hasSourceUrlCol) {
      const u = parseSourceUrl(c.source_url)
      if ("error" in u) { plans.push(invalid(u.error, ing)); continue }
      sourceUrl = u.url
    }
    const verified = ing.status === "VERIFIED"

    const values = emptyNutrients(null)
    let bad: string | null = null
    for (const n of NUTRIENTS) {
      const raw = (c[n.csv] ?? "").replace(/,/g, "")
      if (raw === "") continue
      const v = Number(raw)
      if (!Number.isFinite(v) || v < 0) { bad = `${n.label}: "${c[n.csv]}" is not a number of 0 or more`; break }
      values[n.key] = v
    }
    if (bad) { plans.push(invalid(bad, ing)); continue }
    const anyValue = NUTRIENT_KEYS.some((k) => values[k] !== null)
    const basisGiven = (c.basis_amount ?? "") !== "" || (c.basis_unit ?? "") !== ""
    const matched = { ...base, ingredientId: ing.id, ingredientName: ingredientDisplayName(ing) }
    // B: allergens and the flag are written only where the file differs from what is stored.
    const allergensWrite = allergens !== null && !sameAllergens(allergens, ing.allergens) ? allergens : null
    const flagWrite = notFood !== null && notFood !== ing.nutritionExempt ? notFood : null

    if (notFood === true) {
      // Sets the flag (and allergens); never touches the nutrition record.
      if (anyValue || basisGiven) { plans.push(invalid("Not-food rows carry no nutrition — clear the values or not_food", ing)); continue }
      // The template exports not-food rows with source_url blank; a blank here
      // is ignored, because a not-food row never touches the record (N-1a).
      if (sourceUrl) { plans.push(invalid("Not-food rows carry no source link — clear source_url or not_food", ing)); continue }
      if (allergensWrite === null && flagWrite === null) {
        plans.push({ ...matched, status: "UNCHANGED", detail: null, write: null })
        continue
      }
      const resetStatus = verified && allergensWrite !== null
      plans.push({
        ...matched, status: "NOT_FOOD", detail: resetStatus ? RESET_DETAIL : null,
        write: { nutrition: null, allergens: allergensWrite, nutritionExempt: flagWrite, ...(resetStatus && { resetStatus }) },
      })
      continue
    }

    let nutritionWrite: NutritionInput | null = null
    if (anyValue || ing.nutrition) {
      const nutrition: NutritionInput = {
        basisAmount: Number((c.basis_amount ?? "").replace(/,/g, "")),
        basisUnit: c.basis_unit ?? "",
        values,
        sourceNote: (c.source ?? "") || null,
      }
      if (!basisGiven) { plans.push(invalid("basis_amount and basis_unit are required", ing)); continue }
      const err = nutritionInputError(nutrition, ing.reportingUnit)
      if (err) { plans.push(invalid(err, ing)); continue }
      if (!ing.nutrition || !sameNutrition(nutrition, ing.nutrition)) nutritionWrite = nutrition
    }
    // A: no values and no record → nothing to write for nutrition; no empty record.

    // N-1b, F6 (Gary): "an import row with a link but no values is rejected".
    // N-1d (E): only a link that DIFFERS from the stored one — a proof-only
    // record exports its link, and the unedited row must stay UNCHANGED. The
    // import still never creates a proof-only record.
    const recordAfter = ing.nutrition !== null || nutritionWrite !== null
    if (sourceUrl && !recordAfter && sourceUrl !== (ing.sourceUrl ?? null)) {
      plans.push(invalid("Add nutrient values before a source link", ing))
      continue
    }
    const sourceUrlWrite = sourceUrl !== undefined && recordAfter && sourceUrl !== (ing.sourceUrl ?? null) ? { url: sourceUrl } : null

    if (nutritionWrite === null && allergensWrite === null && flagWrite === null && sourceUrlWrite === null) {
      plans.push({ ...matched, status: "UNCHANGED", detail: anyValue || ing.nutrition ? null : "No nutrient values — nothing to import", write: null })
      continue
    }
    // F3: a source-note-only edit is written but resets nothing; the not-food
    // flag never resets. N1D-F2a: nor does the link — it is reference only.
    const resetStatus =
      verified &&
      ((nutritionWrite !== null && ing.nutrition !== null && numbersChanged(ing.nutrition, nutritionWrite)) ||
        allergensWrite !== null)
    // The N-1b keys appear only when they carry something, so every write an
    // N-1-era file produces is byte-identical to what it was before N-1b.
    const write = {
      nutrition: nutritionWrite, allergens: allergensWrite, nutritionExempt: flagWrite,
      ...(sourceUrlWrite && { sourceUrl: sourceUrlWrite }),
      ...(resetStatus && { resetStatus }),
    }
    if (nutritionWrite === null) {
      plans.push({ ...matched, status: "DETAILS_ONLY", detail: resetStatus ? RESET_DETAIL : null, write })
      continue
    }
    const details = [anyValue ? null : "No nutrient values — every nutrient becomes unknown", resetStatus ? RESET_DETAIL : null].filter(Boolean)
    plans.push({
      ...matched,
      status: ing.nutrition ? "UPDATE" : "NEW",
      detail: details.length ? details.join(" · ") : null,
      write,
    })
  }
  return plans
}

// ─── Server side: load the org's ingredients and plan ─────────────────────────
// Kept here so preview and apply plan identically: apply RE-PLANS from the
// uploaded text and never trusts a plan sent back by the client.

export const MAX_CSV_BYTES = 2_000_000

export const NutritionUploadSchema = z.object({
  csv: z.string().min(1).max(MAX_CSV_BYTES),
  fileName: z.string().max(255).optional(),
})

type StoredNutritionRow = Record<NutrientKey, number | null> & {
  basisAmount: number | null
  basisUnit: string | null
  sourceNote: string | null
}

/** null for no record AND for a proof-only record (N1D-F1). */
export function storedNutritionInput(n: StoredNutritionRow | null): NutritionInput | null {
  if (!hasNutrition(n)) return null
  return {
    basisAmount: n.basisAmount,
    basisUnit: n.basisUnit,
    values: Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, n[k]])) as NutrientValues,
    sourceNote: n.sourceNote,
  }
}

export async function planNutritionForOrg(organizationId: string, csv: NutritionCsv): Promise<NutritionRowPlan[]> {
  const ingredients = await prisma.ingredient.findMany({
    where: { organizationId, deletedAt: null },
    select: {
      id: true, name: true, brand: true, reportingUnit: true, kind: true, allergens: true, nutritionExempt: true, nutrition: true,
    },
  })
  return planNutritionImport(
    csv,
    ingredients.map((i) => ({
      ...i,
      nutrition: storedNutritionInput(i.nutrition),
      sourceUrl: i.nutrition?.sourceUrl ?? null,
      status: i.nutrition?.status ?? null,
    }))
  )
}

export function summarizeNutritionPlan(plan: NutritionRowPlan[]): Record<NutritionRowStatus, number> {
  const out = { NEW: 0, UPDATE: 0, DETAILS_ONLY: 0, NOT_FOOD: 0, UNCHANGED: 0, UNMATCHED: 0, AMBIGUOUS: 0, DUPLICATE: 0, INVALID: 0 }
  for (const p of plan) out[p.status]++
  return out
}

// ─── Template export (N-1a) ──────────────────────────────────────────────────
// The org's ingredients as an import file: the import's columns in the
// import's order, pre-filled with what is stored, so an unedited file imports
// as zero changes (Gary, 2026-11-01). The helper columns go at the end; the
// parser keeps unknown columns and nothing reads them — which is exactly how
// N-1b's `status` is "exported for information, ignored on import".

export const TEMPLATE_HELPER_COLUMNS = ["category", "reporting_unit", "has_nutrition", "status"] as const

const STATUS_CELL: Record<ProofState, string> = { NONE: "", ESTIMATED: "estimated", VERIFIED: "verified", STALE: "re-check label" }

export type TemplateIngredient = {
  id: string
  name: string
  brand: string | null
  reportingUnit: string
  kind: string
  isActive: boolean
  isArchived: boolean
  category: string | null
  allergens: Allergen[]
  nutritionExempt: boolean
  nutrition: NutritionInput | null
  /** N-1b (absent = no link / no record) */
  sourceUrl?: string | null
  proof?: ProofState
}

/** Active, non-archived, non-PREPARED (those take nutrition from their recipe),
 *  sorted by category (uncategorized last), then display name. */
export function templateIngredients(all: TemplateIngredient[]): TemplateIngredient[] {
  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" })
  return all
    .filter((i) => i.isActive && !i.isArchived && i.kind !== "PREPARED")
    .sort((a, b) =>
      a.category === b.category ? cmp(ingredientDisplayName(a), ingredientDisplayName(b))
        : a.category === null ? 1 : b.category === null ? -1 : cmp(a.category, b.category)
    )
}

// String() round-trips a stored double exactly; blank stays blank, never 0.
const num = (v: number | null) => (v === null ? "" : String(v))

export function templateRow(i: TemplateIngredient): Record<string, string> {
  const n = i.nutritionExempt ? null : i.nutrition // not-food: basis and nutrients blank (Gary)
  const row: Record<string, string> = {
    name: i.name,
    brand: i.brand ?? "",
    basis_amount: i.nutritionExempt ? "" : n ? num(n.basisAmount) : "1",
    basis_unit: i.nutritionExempt ? "" : n ? n.basisUnit : i.reportingUnit,
    allergens: sortAllergens(i.allergens).map((a) => allergenLabel(a).toLowerCase()).join("; "),
    not_food: i.nutritionExempt ? "yes" : "",
    source: n?.sourceNote ?? "",
    // Not-food rows export it blank, and the import ignores a blank on them.
    // N-1d (E): a proof-only record (n null) still exports its link, so filling
    // its numbers later never erases it.
    source_url: i.nutritionExempt ? "" : i.sourceUrl ?? "",
    category: i.category ?? "",
    reporting_unit: i.reportingUnit,
    has_nutrition: i.nutrition ? "yes" : "no",
    status: STATUS_CELL[i.proof ?? (i.nutrition ? "ESTIMATED" : "NONE")],
  }
  for (const nt of NUTRIENTS) row[nt.csv] = n ? num(n.values[nt.key]) : ""
  return row
}

export function buildNutritionTemplate(all: TemplateIngredient[]): string {
  const fields = [...IMPORT_COLUMNS, ...TEMPLATE_HELPER_COLUMNS]
  const rows = templateIngredients(all).map(templateRow)
  return "﻿" + Papa.unparse({ fields, data: rows.map((r) => fields.map((f) => r[f])) })
}
