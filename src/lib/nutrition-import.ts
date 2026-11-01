import Papa from "papaparse"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import type { Allergen } from "@prisma/client"
import { normName } from "@/lib/bevspot/plan-import"
import {
  NUTRIENTS, NUTRIENT_KEYS, emptyNutrients, ingredientDisplayName, nutritionInputError, sortAllergens,
  type NutritionInput,
} from "@/lib/nutrition"

// ─── CSV import (N-1 deliverable 4) ───────────────────────────────────────────
// Columns (header case/spacing/punctuation ignored):
//   name (required) · brand (optional) · basis_amount · basis_unit ·
//   one column per nutrient (NUTRIENTS[].csv) · allergens (optional, "milk;
//   tree nuts") · not_food (optional, yes/no) · source (optional)
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
  hasNutrition: boolean
}

export type NutritionRowStatus = "NEW" | "UPDATE" | "NOT_FOOD" | "UNMATCHED" | "AMBIGUOUS" | "DUPLICATE" | "INVALID"

export type NutritionRowPlan = {
  rowNumber: number
  label: string // the name as written (brand + name when both columns given)
  status: NutritionRowStatus
  detail: string | null
  ingredientId: string | null
  ingredientName: string | null
  /** set when status is NEW / UPDATE / NOT_FOOD */
  write: {
    nutrition: NutritionInput | null // null on NOT_FOOD rows
    allergens: Allergen[] | null // null = the file has no allergens column; leave as is
    nutritionExempt: boolean | null // null = the file left it blank; leave as is
  } | null
}

export const APPLYABLE: ReadonlySet<NutritionRowStatus> = new Set(["NEW", "UPDATE", "NOT_FOOD"])

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

    if (notFood === true) {
      if (anyValue || basisGiven) { plans.push(invalid("Not-food rows carry no nutrition — clear the values or not_food", ing)); continue }
      plans.push({
        ...base, status: "NOT_FOOD", detail: null, ingredientId: ing.id, ingredientName: ingredientDisplayName(ing),
        write: { nutrition: null, allergens, nutritionExempt: true },
      })
      continue
    }

    const nutrition: NutritionInput = {
      basisAmount: Number((c.basis_amount ?? "").replace(/,/g, "")),
      basisUnit: c.basis_unit ?? "",
      values,
      sourceNote: (c.source ?? "") || null,
    }
    if (!basisGiven) { plans.push(invalid("basis_amount and basis_unit are required", ing)); continue }
    const err = nutritionInputError(nutrition, ing.reportingUnit)
    if (err) { plans.push(invalid(err, ing)); continue }
    plans.push({
      ...base,
      status: ing.hasNutrition ? "UPDATE" : "NEW",
      detail: anyValue ? null : "No nutrient values — every nutrient stays unknown",
      ingredientId: ing.id,
      ingredientName: ingredientDisplayName(ing),
      write: { nutrition, allergens, nutritionExempt: notFood === false ? false : null },
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

export async function planNutritionForOrg(organizationId: string, csv: NutritionCsv): Promise<NutritionRowPlan[]> {
  const ingredients = await prisma.ingredient.findMany({
    where: { organizationId, deletedAt: null },
    select: { id: true, name: true, brand: true, reportingUnit: true, kind: true, nutrition: { select: { id: true } } },
  })
  return planNutritionImport(
    csv,
    ingredients.map((i) => ({ ...i, hasNutrition: i.nutrition !== null }))
  )
}

export function summarizeNutritionPlan(plan: NutritionRowPlan[]): Record<NutritionRowStatus, number> {
  const out = { NEW: 0, UPDATE: 0, NOT_FOOD: 0, UNMATCHED: 0, AMBIGUOUS: 0, DUPLICATE: 0, INVALID: 0 }
  for (const p of plan) out[p.status]++
  return out
}
