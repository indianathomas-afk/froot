/**
 * N-1b — nutrition proof and Estimated/Verified, pinned.
 *
 *   npx tsx scripts/verify-n1b-proof.ts
 *
 * TWO PARTS.
 *   1–6 PURE: synthetic ingredients and CSVs BUILT IN CODE, run through the
 *       same functions the routes, the import and Menu Nutrition call
 *       (verifyRefusal, numbersChanged, parseSourceUrl, proofState,
 *       itemVerification, planNutritionImport, buildNutritionTemplate,
 *       rankBlockers, sniffLabelType). Every name is invented.
 *   7   DATABASE: against the database in local .env (dev), inside ONE
 *       transaction that is ALWAYS rolled back. It proves the applied migration:
 *       the new columns exist, `status` defaults to ESTIMATED (the backfill),
 *       VERIFIED round-trips, and the planner reads a stored VERIFIED record and
 *       resets it. The branch is printed from `neon.branch_id`, never typed.
 *
 * WHAT THIS CAN DETECT, so a green run means something (the prompt's list):
 *   - VERIFIED refused without a document or a source link (F2).
 *   - The import never sets VERIFIED; a number change resets VERIFIED →
 *     ESTIMATED; so do allergen and source-link changes; a source-NOTE-only
 *     change and a not-food flag change do not (F3).
 *   - An unedited N-1a template, with the new source_url and status columns,
 *     still plans zero changes — including a VERIFIED row with a stored link.
 *   - A link with no values on an ingredient with no record is rejected (F6).
 *   - An item is Verified only when every food line is VERIFIED; not-food lines
 *     are ignored; an item with no food ingredients is NO_FOOD (F8).
 *   - Stale at 12 months counts as not verified (F4).
 *   - The first-bytes file-type check (Gary, N-1b).
 *
 * WHAT IT CANNOT DETECT: the routes' ADMIN gate, the private store (there is
 * no Development connection, so no blob is written here), the dialog's
 * "Still verified?" question, or Menu Nutrition's rendering. Those are Gary's
 * staging pass.
 */
import "dotenv/config"
import type { Allergen } from "@prisma/client"
import { prisma } from "../src/lib/prisma"
import { NUTRIENT_KEYS, type NutrientKey, type NutrientValues, type NutritionInput } from "../src/lib/nutrition"
import {
  APPLYABLE, RESET_DETAIL, buildNutritionTemplate, parseNutritionCsv, planNutritionImport, storedNutritionInput,
  summarizeNutritionPlan, type PlanIngredientRef, type TemplateIngredient,
} from "../src/lib/nutrition-import"
import {
  hasProof, isStale, itemVerification, numbersChanged, parseSourceUrl, proofState, verifyRefusal, type ProofState,
} from "../src/lib/nutrition-proof"
import { sniffLabelType, sniffMatches } from "../src/lib/nutrition-files"
import { rankBlockers, type RecipeNutrition } from "../src/lib/recipe-nutrition"

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`}`)
}

function vals(partial: Partial<Record<NutrientKey, number | null>>): NutrientValues {
  return Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, k in partial ? partial[k]! : null])) as NutrientValues
}
const rec = (values: NutrientValues, sourceNote: string | null = null, basisAmount = 1, basisUnit = "fl. oz"): NutritionInput =>
  ({ basisAmount, basisUnit, values, sourceNote })
const milk = vals({ calories: 7.5, totalSugarsG: 0.9, proteinG: 0.13 })
const URL_A = "https://example.com/almond-breeze-original"
const URL_B = "https://example.com/spec-sheet.pdf"
const now = new Date("2026-11-01T18:00:00Z")

// ─── 1. VERIFIED refused without a document or a source link (F2) ───────────
check("1a. no proof → refused", verifyRefusal({ kind: "PURCHASED", nutritionExempt: false }, { sourceUrl: null, labelFileUrl: null }),
  "Add a label document or a source link before marking this verified")
check("1b. a source link alone is enough", verifyRefusal({ kind: "PURCHASED", nutritionExempt: false }, { sourceUrl: URL_A, labelFileUrl: null }), null)
check("1c. a document alone is enough", verifyRefusal({ kind: "PURCHASED", nutritionExempt: false }, { sourceUrl: null, labelFileUrl: "https://blob/x.pdf" }), null)
check("1d. no record → refused (F6: proof needs nutrition)", verifyRefusal({ kind: "PURCHASED", nutritionExempt: false }, null), "Save nutrition before verifying it")
check("1e. not-food → refused", verifyRefusal({ kind: "PURCHASED", nutritionExempt: true }, { sourceUrl: URL_A, labelFileUrl: null }), "Not-food items carry no nutrition to verify")
check("1f. prepared → refused", verifyRefusal({ kind: "PREPARED", nutritionExempt: false }, { sourceUrl: URL_A, labelFileUrl: null }) !== null, true)
check("1g. hasProof is link OR document", [hasProof({ sourceUrl: null, labelFileUrl: null }), hasProof({ sourceUrl: URL_A, labelFileUrl: null })], [false, true])

// ─── 2. Stale at 12 months (F4) ──────────────────────────────────────────────
const verifiedOn = new Date("2025-11-01T18:00:00Z")
check("2a. one second short of 12 months → not stale", isStale(verifiedOn, new Date("2026-11-01T17:59:59Z")), false)
check("2b. exactly 12 months → stale", isStale(verifiedOn, now), true)
const ver = (verifiedAt: Date | null) => ({ status: "VERIFIED" as const, verifiedAt, sourceUrl: URL_A, labelFileUrl: null })
check("2c. proof states", [
  proofState(null, now),
  proofState({ status: "ESTIMATED", verifiedAt: null, sourceUrl: URL_A, labelFileUrl: null }, now),
  proofState(ver(new Date("2026-06-01T00:00:00Z")), now),
  proofState(ver(verifiedOn), now),
  proofState(ver(null), now),
], ["NONE", "ESTIMATED", "VERIFIED", "STALE", "STALE"])

// ─── 3. What counts as a change (F3) ─────────────────────────────────────────
check("3a. a number → changed", numbersChanged(rec(milk), rec({ ...milk, calories: 8 })), true)
check("3b. the basis → changed", [numbersChanged(rec(milk), rec(milk, null, 2)), numbersChanged(rec(milk), rec(milk, null, 1, "cups"))], [true, true])
check("3c. the source NOTE only → not a change", numbersChanged(rec(milk, "label"), rec(milk, "label, 2026 carton")), false)
check("3d. source links: http/https only, blank clears", [
  parseSourceUrl(""), parseSourceUrl(` ${URL_A} `), "error" in parseSourceUrl("ftp://x.com/a"), "error" in parseSourceUrl("not a link"),
], [{ url: null }, { url: URL_A }, true, true])

// ─── 4. The import: never verifies; resets VERIFIED on a change ──────────────
const ref = (id: string, name: string, o: Partial<PlanIngredientRef> = {}): PlanIngredientRef => ({
  id, name, brand: null, reportingUnit: "fl. oz", kind: "PURCHASED", nutrition: null, allergens: [], nutritionExempt: false,
  sourceUrl: null, status: null, ...o,
})
const verifiedMilk = (o: Partial<PlanIngredientRef> = {}) =>
  ref("milk", "Almond Milk", { nutrition: rec(milk, "label"), allergens: ["TREE_NUTS"], sourceUrl: URL_A, status: "VERIFIED", ...o })
const HEAD = "name,basis_amount,basis_unit,calories,total_sugars_g,protein_g,allergens,not_food,source,source_url"
const plan = (rows: string[], refs: PlanIngredientRef[]) => planNutritionImport(parseNutritionCsv([HEAD, ...rows].join("\n")), refs)
const same = "Almond Milk,1,fl. oz,7.5,0.9,0.13,tree nuts,,label"

const p0 = plan([`${same},${URL_A}`], [verifiedMilk()])
check("4a. identical row on a VERIFIED record → UNCHANGED, nothing written", [p0[0].status, p0[0].write], ["UNCHANGED", null])
const p1 = plan([`Almond Milk,1,fl. oz,8,0.9,0.13,tree nuts,,label,${URL_A}`], [verifiedMilk()])
check("4b. a number change → UPDATE with resetStatus, detail says so", [p1[0].status, p1[0].write?.resetStatus, p1[0].detail], ["UPDATE", true, RESET_DETAIL])
const p2 = plan([`Almond Milk,1,fl. oz,7.5,0.9,0.13,tree nuts,,label — 2026 carton,${URL_A}`], [verifiedMilk()])
check("4c. a source-note-only change is written but resets nothing", [p2[0].status, p2[0].write?.resetStatus ?? false], ["UPDATE", false])
const p3 = plan([`Almond Milk,1,fl. oz,7.5,0.9,0.13,tree nuts; soy,,label,${URL_A}`], [verifiedMilk()])
check("4d. an allergen change → DETAILS_ONLY with resetStatus (B3: status lives on the record)", [p3[0].status, p3[0].write?.resetStatus], ["DETAILS_ONLY", true])
const p4 = plan([`${same},${URL_B}`], [verifiedMilk()])
check("4e. a new source link → DETAILS_ONLY, link written, resetStatus", [p4[0].status, p4[0].write?.sourceUrl, p4[0].write?.resetStatus], ["DETAILS_ONLY", { url: URL_B }, true])
const p5 = plan([`${same},`], [verifiedMilk()])
check("4f. a blank source_url clears the link and resets", [p5[0].write?.sourceUrl, p5[0].write?.resetStatus], [{ url: null }, true])
const p6 = plan([`Almond Milk,,,,,,tree nuts,yes,,`], [verifiedMilk()])
check("4g. the not-food flag alone does not reset", [p6[0].status, p6[0].write?.resetStatus ?? false], ["NOT_FOOD", false])
const p7 = plan([`Almond Milk,1,fl. oz,8,0.9,0.13,tree nuts,,label,${URL_A}`], [verifiedMilk({ status: "ESTIMATED" })])
check("4h. an ESTIMATED record is never 'reset' (nothing to undo)", p7[0].write?.resetStatus ?? false, false)
const everyWrite = [p0, p1, p2, p3, p4, p5, p6, p7].flat().map((p) => JSON.stringify(p.write ?? {}))
check("4i. the import NEVER writes VERIFIED (no plan carries a status other than a reset flag)", everyWrite.some((w) => w.includes("VERIFIED") || w.includes("\"status\"")), false)
const p8 = plan([`Almond Milk,,,,,,,,,${URL_A}`], [ref("milk", "Almond Milk")])
check("4j. F6: a link with no values and no record is rejected", [p8[0].status, p8[0].detail], ["INVALID", "Add nutrient values before a source link"])
const p9 = plan([`Almond Milk,1,fl. oz,7.5,,,,,,${URL_A}`], [ref("milk", "Almond Milk")])
check("4k. a link WITH values on a new record is fine → NEW with the link", [p9[0].status, p9[0].write?.sourceUrl], ["NEW", { url: URL_A }])
const p10 = plan([`Almond Milk,,,,,,,yes,,${URL_A}`], [verifiedMilk()])
check("4l. a not-food row carrying a link is rejected", p10[0].status, "INVALID")
const p11 = planNutritionImport(parseNutritionCsv([HEAD.replace(",source_url", ""), "Almond Milk,1,fl. oz,7.5,0.9,0.13,tree nuts,,label"].join("\n")), [verifiedMilk()])
check("4m. a file without the source_url column leaves the link alone (N-1-era files)", [p11[0].status, p11[0].write], ["UNCHANGED", null])
const p12 = plan([`Almond Milk,1,fl. oz,7.5,0.9,0.13,tree nuts,,label,${URL_A}`], [verifiedMilk()]).concat(
  planNutritionImport(parseNutritionCsv(`${HEAD},status\nAlmond Milk,1,fl. oz,8,0.9,0.13,tree nuts,,label,${URL_A},verified`), [verifiedMilk({ status: "ESTIMATED" })])
)
check("4n. a status cell saying 'verified' changes nothing about status", [p12[1].status, p12[1].write?.resetStatus ?? false, JSON.stringify(p12[1].write).includes("VERIFIED")], ["UPDATE", false, false])

// ─── 5. The N-1a round trip still holds with the new columns ─────────────────
const tIng = (id: string, name: string, o: Partial<TemplateIngredient> = {}): TemplateIngredient => ({
  id, name, reportingUnit: "fl. oz", brand: null, kind: "PURCHASED", isActive: true, isArchived: false,
  category: "Dairy", allergens: [], nutritionExempt: false, nutrition: null, ...o,
})
const tAll: TemplateIngredient[] = [
  tIng("milk", "Almond Milk", { allergens: ["TREE_NUTS"], nutrition: rec(milk, "label"), sourceUrl: URL_A, proof: "VERIFIED" }),
  tIng("oat", "Oat Milk", { nutrition: rec(vals({ calories: 15 })), sourceUrl: null, proof: "ESTIMATED" }),
  tIng("old", "Old Label Milk", { nutrition: rec(vals({ calories: 9 })), sourceUrl: URL_B, proof: "STALE" }),
  tIng("honey", "Honey", { category: null }),
  tIng("cup", "Cup", { category: null, nutritionExempt: true, nutrition: rec(vals({ calories: 1 })), sourceUrl: URL_B, proof: "ESTIMATED" }),
]
const tText = buildNutritionTemplate(tAll)
const tCsv = parseNutritionCsv(tText)
check("5a. template header ends with source, source_url … status", [tCsv.headers.includes("source_url"), tCsv.headers[tCsv.headers.length - 1]], [true, "status"])
const byName = Object.fromEntries(tCsv.rows.map((r) => [r.cells.name, r.cells]))
check("5b. source_url pre-filled; not-food exported blank", [byName["Almond Milk"].source_url, byName["Oat Milk"].source_url, byName["Cup"].source_url], [URL_A, "", ""])
check("5c. status exported for information", [byName["Almond Milk"].status, byName["Oat Milk"].status, byName["Old Label Milk"].status, byName["Honey"].status], ["verified", "estimated", "re-check label", ""])
const tRefs: PlanIngredientRef[] = tAll.map((t) => ({
  id: t.id, name: t.name, brand: t.brand, reportingUnit: t.reportingUnit, kind: t.kind, nutrition: t.nutrition,
  allergens: t.allergens, nutritionExempt: t.nutritionExempt, sourceUrl: t.sourceUrl ?? null,
  status: t.proof === "VERIFIED" || t.proof === "STALE" ? "VERIFIED" : t.nutrition ? "ESTIMATED" : null,
}))
const tPlan = planNutritionImport(tCsv, tRefs)
const tSum = summarizeNutritionPlan(tPlan)
check("5d. the UNEDITED template plans zero changes", [tSum.NEW, tSum.UPDATE, tSum.DETAILS_ONLY, tSum.NOT_FOOD, tSum.UNCHANGED, tSum.INVALID], [0, 0, 0, 0, 5, 0])
check("5e. no row is applyable", tPlan.filter((p) => APPLYABLE.has(p.status)).length, 0)

// ─── 6. Menu items, Stale, "To fix" (deliverable 6, F8) ──────────────────────
const proofs: Record<string, ProofState> = { milk: "VERIFIED", banana: "VERIFIED", oat: "ESTIMATED", old: "STALE" }
const proofOf = (id: string): ProofState => proofs[id] ?? "NONE"
const item = (ids: string[], error: string | null = null) => ({ foodIngredientIds: new Set(ids), error })
check("6a. every food line VERIFIED → Verified", itemVerification(item(["milk", "banana"]), proofOf), "VERIFIED")
check("6b. one ESTIMATED line → not verified", itemVerification(item(["milk", "oat"]), proofOf), "NOT_VERIFIED")
check("6c. one STALE line → not verified", itemVerification(item(["milk", "old"]), proofOf), "NOT_VERIFIED")
check("6d. not-food lines are never in foodIngredientIds, so a cup does not block", itemVerification(item(["milk"]), proofOf), "VERIFIED")
check("6e. F8: no food ingredients → NO_FOOD (left out of N of M)", itemVerification(item([]), proofOf), "NO_FOOD")
check("6f. a recipe error is never Verified", itemVerification(item(["milk"], "loop"), proofOf), "NOT_VERIFIED")
const r = (ids: string[], missing: string[] = [], partial: [string, NutrientKey[]][] = []): RecipeNutrition => ({
  recipeId: ids.join("+"), totals: vals({}), allergens: [] as Allergen[], foodIngredientIds: new Set(ids),
  missingIngredientIds: new Set(missing), partialIngredients: new Map(partial), lines: [], error: null, loop: null, complete: false,
})
const blockers = rankBlockers([r(["milk", "oat", "honey"], ["honey"]), r(["oat", "old"]), r(["oat", "banana"], [], [["banana", ["ironMg"]]])], proofOf)
check("6g. 'not verified' ranks after missing and partial, by item count", blockers.map((b) => [b.ingredientId, b.kind, b.itemCount, b.stale ?? false]),
  [["honey", "missing", 1, false], ["banana", "partial", 1, false], ["oat", "unverified", 3, false], ["old", "unverified", 1, true]])
check("6h. without proofOf the N-1 ranking is unchanged", rankBlockers([r(["oat", "old"])]).length, 0)

// ─── 6b. File-type check by first bytes ──────────────────────────────────────
const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)))
check("6i. signatures", [
  sniffLabelType(bytes("%PDF-1.7")), sniffLabelType(bytes([0x89], "PNG\r\n\x1a\n")), sniffLabelType(bytes([0xff, 0xd8, 0xff, 0xe0])),
  sniffLabelType(bytes("RIFF", [0, 0, 0, 0], "WEBP")), sniffLabelType(bytes([0, 0, 0, 0x18], "ftypheic")), sniffLabelType(bytes("MZ\x90\x00")),
], ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/heic", null])
check("6j. a renamed .exe claiming to be a PDF is refused; HEIC/HEIF are one family", [
  sniffMatches("application/pdf", sniffLabelType(bytes("MZ"))), sniffMatches("image/heif", "image/heic"), sniffMatches("image/png", "image/jpeg"),
], [false, true, false])

// ─── 7. Against the applied schema (dev), rolled back ────────────────────────
class Rollback extends Error {}
async function dbPart() {
  const [{ branch }] = await prisma.$queryRaw<{ branch: string | null }[]>`SELECT current_setting('neon.branch_id', true) AS branch`
  console.log(`  (database part on neon.branch_id = ${branch ?? "null"})`)
  try {
    await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { clerkOrgId: `n1b-fixture-${Date.now()}`, name: "N-1b Fixture Org" } })
      const ing = await tx.ingredient.create({
        data: {
          organizationId: org.id, name: "N-1b Fixture Almond Milk", purchaseUnitLabel: "carton", purchaseCost: 1,
          reportingUnit: "fl. oz", unitsPerPurchase: 64, costPerReportingUnit: 1 / 64, allergens: ["TREE_NUTS"],
        },
      })
      const created = await tx.ingredientNutrition.create({
        data: { ingredientId: ing.id, basisAmount: 1, basisUnit: "fl. oz", calories: 7.5, totalSugarsG: 0.9, proteinG: 0.13, sourceNote: "label" },
      })
      check("7a. a new record defaults to ESTIMATED with no proof (the backfill's DEFAULT)", [created.status, created.verifiedAt, created.sourceUrl, created.labelFileUrl], ["ESTIMATED", null, null, null])
      const verified = await tx.ingredientNutrition.update({
        where: { ingredientId: ing.id },
        data: { sourceUrl: URL_A, status: "VERIFIED", verifiedAt: new Date(), labelFileName: "almond-breeze.pdf", labelSizeBytes: 123456 },
      })
      check("7b. VERIFIED, the link and the label columns round-trip", [verified.status, verified.sourceUrl, verified.labelFileName, verified.labelSizeBytes], ["VERIFIED", URL_A, "almond-breeze.pdf", 123456])
      const stored = await tx.ingredient.findUniqueOrThrow({ where: { id: ing.id }, include: { nutrition: true } })
      const dbRef: PlanIngredientRef = {
        id: stored.id, name: stored.name, brand: stored.brand, reportingUnit: stored.reportingUnit, kind: stored.kind,
        nutrition: storedNutritionInput(stored.nutrition), allergens: stored.allergens, nutritionExempt: stored.nutritionExempt,
        sourceUrl: stored.nutrition?.sourceUrl ?? null, status: stored.nutrition?.status ?? null,
      }
      const dbPlan = plan([`N-1b Fixture Almond Milk,1,fl. oz,8,0.9,0.13,tree nuts,,label,${URL_A}`], [dbRef])
      check("7c. the planner reads the stored VERIFIED row and resets it on a number change", [dbPlan[0].status, dbPlan[0].write?.resetStatus], ["UPDATE", true])
      throw new Rollback()
    })
  } catch (e) {
    if (!(e instanceof Rollback)) throw e
  }
  const leaked = await prisma.organization.count({ where: { name: "N-1b Fixture Org" } })
  check("7d. rolled back: no fixture rows left behind", leaked, 0)
}

dbPart()
  .catch((e) => {
    failures++
    console.log(`✗ 7. database part threw: ${e instanceof Error ? e.message : e}`)
  })
  .finally(async () => {
    await prisma.$disconnect()
    console.log(failures === 0 ? "\n✓ ALL PASS" : `\n✗ ${failures} CHECK(S) FAILED`)
    process.exit(failures === 0 ? 0 : 1)
  })
