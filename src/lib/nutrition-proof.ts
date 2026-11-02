import type { Allergen, NutritionStatus } from "@prisma/client"
import { NUTRIENT_KEYS, hasNutrition, sortAllergens, type NutritionInput } from "@/lib/nutrition"

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
// N-1d (Gary, 2026-11-02, DRAFT), superseding F2 and F6 above:
//   N1D-F1 "Accept the unlock as in item 1." — proof (document, link) on any
//       non-PREPARED ingredient; a record with proof and no basis is "No
//       nutrition" everywhere (hasNutrition, src/lib/nutrition.ts).
//   N1D-F2 "Verified requires an uploaded label document; the link is
//       reference only. Removing the last document resets to Estimated without
//       asking."
//   N1D-F2a "editing the link no longer asks "Still verified?" and no longer
//       resets on import."

export const STALE_AFTER_MONTHS = 12

/** NONE = no nutrition (F1: an ingredient with allergens but no record has no
 *  status; N-1d: nor has a proof-only record). */
export type ProofState = "NONE" | "ESTIMATED" | "VERIFIED" | "STALE"

export type ProofRecord = {
  basisAmount: number | null
  basisUnit: string | null
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
  if (!hasNutrition(r)) return "NONE"
  if (r.status !== "VERIFIED") return "ESTIMATED"
  // A VERIFIED row with no date cannot be dated; treat it as needing a re-check.
  if (!r.verifiedAt || isStale(r.verifiedAt, now)) return "STALE"
  return "VERIFIED"
}

/** Anything a clear or a delete would lose — the link counts here even though
 *  it no longer proves anything (N1D-F2). */
export function hasProof(r: { sourceUrl: string | null; labelFileUrl: string | null }): boolean {
  return Boolean(r.sourceUrl) || Boolean(r.labelFileUrl)
}

/** Why a record cannot be marked verified, or null when it can (N1D-F2). */
export function verifyRefusal(
  ing: { kind: string; nutritionExempt: boolean },
  r: { basisAmount: number | null; basisUnit: string | null; labelFileUrl: string | null } | null
): string | null {
  if (ing.kind === "PREPARED") return "A prepared ingredient's nutrition is computed from its recipe"
  if (ing.nutritionExempt) return "Not-food items carry no nutrition to verify"
  if (!hasNutrition(r)) return "Save nutrition before verifying it"
  if (!r.labelFileUrl) return "Upload the label document before marking this verified"
  return null
}

/** Why proof (a document, a link) can't be attached here, or null (N1D-F1). */
export function proofRefusal(ing: { kind: string; nutritionExempt: boolean }): string | null {
  if (ing.kind === "PREPARED") return "A prepared ingredient's nutrition is computed from its recipe"
  if (ing.nutritionExempt) return "Not-food items carry no nutrition label"
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

// ─── N-1d decisions the routes make, kept pure so the fixture can pin them ───
/** N1D-F2: "Removing the last document resets to Estimated without asking."
 *  One document per record, so removing it on a VERIFIED record always resets. */
export function resetsOnLabelRemoval(status: NutritionStatus): boolean {
  return status === "VERIFIED"
}

/** N1D-F1a / F1b: a save with no numbers keeps a proof-only record while a
 *  document or a link remains; only with nothing left does the record go. */
export function afterNumbersCleared(
  existing: { labelFileUrl: string | null } | null,
  nextSourceUrl: string | null
): "keep-proof-only" | "delete" | "nothing" {
  if (existing?.labelFileUrl || nextSourceUrl) return "keep-proof-only"
  return existing ? "delete" : "nothing"
}
