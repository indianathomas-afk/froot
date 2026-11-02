import type { Allergen, NutritionStatus } from "@prisma/client"
import { NUTRIENT_KEYS, sortAllergens, type NutritionInput } from "@/lib/nutrition"

// ─── Nutrition proof and Estimated/Verified (N-1b) ───────────────────────────
// PURE — no database. Shared by the dialog's routes, the CSV import, Menu
// Nutrition and the fixture, so they can never disagree on what "verified"
// means. Rulings: docs/DECISIONS.md 2026-11-01 N-1b (Gary), in his words:
//   F1 "Status lives on the nutrition record."
//   F2 "Verified needs a label document or a source link, set by ADMIN only.
//       Removing the last proof resets to Estimated."
//   F3 "Import changes reset to Estimated; dialog changes ask "Still
//       verified?". A change means the basis, any number, the allergens, or the
//       proof; not the source note or the not-food flag."
//   F4 "Stale after 12 months from the verified date"
//   F8 "Items with no food ingredients are not counted as verified and are left
//       out of "N of M items verified"."

export const STALE_AFTER_MONTHS = 12

/** NONE = no nutrition record (F1: an ingredient with allergens but no record has no status). */
export type ProofState = "NONE" | "ESTIMATED" | "VERIFIED" | "STALE"

export type ProofRecord = {
  status: NutritionStatus
  verifiedAt: Date | null
  sourceUrl: string | null
  labelFileUrl: string | null
}

export function staleAt(verifiedAt: Date): Date {
  const t = new Date(verifiedAt)
  t.setUTCMonth(t.getUTCMonth() + STALE_AFTER_MONTHS)
  return t
}

export function isStale(verifiedAt: Date, now: Date): boolean {
  return now.getTime() >= staleAt(verifiedAt).getTime()
}

export function proofState(r: ProofRecord | null, now: Date): ProofState {
  if (!r) return "NONE"
  if (r.status !== "VERIFIED") return "ESTIMATED"
  // A VERIFIED row with no date cannot be dated; treat it as needing a re-check.
  if (!r.verifiedAt || isStale(r.verifiedAt, now)) return "STALE"
  return "VERIFIED"
}

export function hasProof(r: { sourceUrl: string | null; labelFileUrl: string | null }): boolean {
  return Boolean(r.sourceUrl) || Boolean(r.labelFileUrl)
}

/** Why a record cannot be marked verified, or null when it can (F2). */
export function verifyRefusal(
  ing: { kind: string; nutritionExempt: boolean },
  r: { sourceUrl: string | null; labelFileUrl: string | null } | null
): string | null {
  if (ing.kind === "PREPARED") return "A prepared ingredient's nutrition is computed from its recipe"
  if (ing.nutritionExempt) return "Not-food items carry no nutrition to verify"
  if (!r) return "Save nutrition before verifying it"
  if (!hasProof(r)) return "Add a label document or a source link before marking this verified"
  return null
}

// ─── What counts as a change (F3) ────────────────────────────────────────────
// Basis and numbers only. The source NOTE is free text and deliberately absent.
export function numbersChanged(a: NutritionInput, b: NutritionInput): boolean {
  return a.basisAmount !== b.basisAmount || a.basisUnit !== b.basisUnit || NUTRIENT_KEYS.some((k) => a.values[k] !== b.values[k])
}

export function allergensChanged(a: Allergen[], b: Allergen[]): boolean {
  const x = sortAllergens(a), y = sortAllergens(b)
  return x.length !== y.length || x.some((v, i) => v !== y[i])
}

// ─── Source link ─────────────────────────────────────────────────────────────
export const SOURCE_URL_MAX = 2000

/** Blank → null (no link). http/https only. */
export function parseSourceUrl(raw: string | null | undefined): { url: string | null } | { error: string } {
  const v = (raw ?? "").trim()
  if (v === "") return { url: null }
  if (v.length > SOURCE_URL_MAX) return { error: `Source link must be ${SOURCE_URL_MAX} characters or fewer` }
  let u: URL
  try {
    u = new URL(v)
  } catch {
    return { error: `Source link "${v}" isn't a web address` }
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { error: "Source link must start with http:// or https://" }
  return { url: v }
}

// ─── Menu items (deliverable 6) ──────────────────────────────────────────────
/** VERIFIED only when every food ingredient reached is VERIFIED and not stale.
 *  NO_FOOD (F8) = nothing to verify; left out of "N of M". A recipe error is
 *  NOT_VERIFIED — the ingredient set it reached may be incomplete. */
export type ItemVerification = "VERIFIED" | "NOT_VERIFIED" | "NO_FOOD"

export function itemVerification(
  item: { foodIngredientIds: Iterable<string>; error: string | null },
  proofOf: (ingredientId: string) => ProofState
): ItemVerification {
  const ids = [...item.foodIngredientIds]
  if (item.error) return "NOT_VERIFIED"
  if (ids.length === 0) return "NO_FOOD"
  return ids.every((id) => proofOf(id) === "VERIFIED") ? "VERIFIED" : "NOT_VERIFIED"
}

export const PROOF_LABEL: Record<ProofState, string> = {
  NONE: "No nutrition",
  ESTIMATED: "Estimated",
  VERIFIED: "Verified",
  STALE: "Re-check label",
}

/** What a VERIFIED → ESTIMATED reset writes. verifiedAt/By are cleared: the
 *  AuditLog row keeps who verified it and when. */
export const RESET_TO_ESTIMATED = { status: "ESTIMATED", verifiedAt: null, verifiedByUserId: null } as const
