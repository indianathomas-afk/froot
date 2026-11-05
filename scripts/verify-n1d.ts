/**
 * N-1d — proof without numbers, Verified needs a document, printed bounds, pinned.
 *
 *   npx tsx scripts/verify-n1d.ts
 *
 * Rulings: docs/DECISIONS.md 2026-11-02 N-1d (Gary, DRAFT); audit
 * docs/prompts/N-1d_AUDIT.md.
 *
 * TWO PARTS.
 *   1–6 PURE: synthetic ingredients, graphs and CSVs BUILT IN CODE, run through
 *       the functions the routes, the import, the template and Menu Nutrition
 *       call. Every name is invented.
 *   7   DATABASE: against the database in local .env (dev), inside ONE
 *       transaction that is ALWAYS rolled back. It proves the APPLIED migration
 *       20261102220000_n1d_proof_only_nutrition: a proof-only row stores, the
 *       basis CHECK refuses half a basis, and the migration's own backfill
 *       statement resets VERIFIED-without-a-document and nothing else. The
 *       branch is printed from `neon.branch_id`, never typed.
 *
 * WHAT THIS CAN DETECT (the prompt's list):
 *   - A proof-only record counts as "No nutrition" everywhere: proof state,
 *     the engine's loader mapping and line status, "To fix", the template
 *     (empty row, link kept), the import (a row filling it is NEW).
 *   - Verify is refused without a document even with a link, and on a
 *     proof-only record even with a document.
 *   - Removing the document resets VERIFIED; clearing numbers keeps a
 *     proof-only record while a document or link remains.
 *   - The backfill logic (part 7, the migration's statement verbatim).
 *   - "<5 mg" cholesterol → 2 and "<1 g" → 0.5 (carb/fiber/sugars/added/
 *     protein), flagged; a fat "<1 g" blank + flagged; an unknown bound blank
 *     + flagged.
 *   - An unedited template, proof-only rows included, plans zero changes.
 *
 * WHAT IT CANNOT DETECT: the routes' ADMIN gate and HTTP shapes, the private
 * blob store (no Development connection), the dialog, the Ingredients table
 * layout, and loadNutritionGraph's database read (only the mapping it applies
 * is pinned here). Those are Gary's staging pass.
 */
import "dotenv/config"
import { readFileSync } from "node:fs"
import type { Allergen } from "@prisma/client"
import { prisma } from "../src/lib/prisma"
import { NUTRIENT_KEYS, PROOF_ONLY_NUMBERS, hasNutrition, type NutrientKey, type NutrientValues, type NutritionInput } from "../src/lib/nutrition"
import {
  APPLYABLE, buildNutritionTemplate, parseNutritionCsv, planNutritionImport, storedNutritionInput, summarizeNutritionPlan,
  type PlanIngredientRef, type TemplateIngredient,
} from "../src/lib/nutrition-import"
import { afterNumbersCleared, proofRefusal, proofState, resetsOnLabelRemoval, verifyRefusal } from "../src/lib/nutrition-proof"
import { FLAG_TEXT, parsePrintedValue } from "../src/lib/label-review"
import {
  computeRecipeNutrition, nutritionRecordOf, rankBlockers, type NutritionGraph, type NutritionIngredient,
} from "../src/lib/recipe-nutrition"
import type { GraphRecipe } from "../src/lib/recipe-cost"

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`}`)
}

function vals(partial: Partial<Record<NutrientKey, number | null>>): NutrientValues {
  return Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, k in partial ? partial[k]! : null])) as NutrientValues
}
const now = new Date("2026-11-02T18:00:00Z")
const DOC = "https://blob.example/n1d/coconut.pdf"
const LINK = "https://example.com/us-foods/coconut-milk"
// A stored row as Prisma returns it: proof-only = basis null, every nutrient null.
const proofOnlyRow = { ...PROOF_ONLY_NUMBERS, sourceNote: null, status: "ESTIMATED" as const, verifiedAt: null, sourceUrl: LINK, labelFileUrl: DOC }
// Every nutrient known, so the engine reads it as complete (not partial).
const numberedRow = { ...proofOnlyRow, basisAmount: 8, basisUnit: "fl. oz", ...Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, 0])), calories: 45 }

// ─── 1. A proof-only record is "No nutrition" ────────────────────────────────
check("1a. hasNutrition: proof-only false, numbered true, none false", [hasNutrition(proofOnlyRow), hasNutrition(numberedRow), hasNutrition(null)], [false, true, false])
check("1b. proofState: proof-only → NONE even with a document and link", proofState(proofOnlyRow, now), "NONE")
check("1c. … and even if a row somehow said VERIFIED", proofState({ ...proofOnlyRow, status: "VERIFIED", verifiedAt: now }, now), "NONE")
check("1d. storedNutritionInput: proof-only → null (template + import see no record)", storedNutritionInput(proofOnlyRow), null)
check("1e. engine loader mapping: proof-only → nutrition null", nutritionRecordOf(proofOnlyRow), null)
check("1f. engine loader mapping: numbered row maps through", nutritionRecordOf(numberedRow)?.basisAmount, 8)

type Row = Parameters<typeof nutritionRecordOf>[0] & Parameters<typeof proofState>[0]
const graphIng = (id: string, row: Row): NutritionIngredient => ({
  id, name: id, reportingUnit: "fl. oz", brand: null, costPerReportingUnit: 0, kind: "PURCHASED",
  preparedFromRecipeId: null, isActive: true, isArchived: false, nutritionExempt: false, allergens: [] as Allergen[],
  nutrition: nutritionRecordOf(row), proof: proofState(row, now),
})
const smoothie: GraphRecipe = {
  id: "smoothie", name: "N-1d Smoothie", salesItemId: "si", yieldQty: 1, yieldUnit: "serving", servingSizeQty: null, servingSizeUnit: null, isActive: true,
  lines: [
    { id: "l1", ingredientId: "coconut", subRecipeId: null, amount: 4, unit: "fl. oz", sortOrder: 1 },
    { id: "l2", ingredientId: "juice", subRecipeId: null, amount: 8, unit: "fl. oz", sortOrder: 2 },
  ],
}
const graph: NutritionGraph = {
  recipes: new Map([["smoothie", smoothie]]),
  ingredients: new Map([["coconut", graphIng("coconut", proofOnlyRow)], ["juice", graphIng("juice", numberedRow)]]),
}
const rn = computeRecipeNutrition(graph, "smoothie")
check("1g. engine: the proof-only line is 'missing', never partial or zero", [rn.lines[0].status, rn.lines[0].contribution], ["missing", null])
check("1h. engine: it is in missingIngredientIds and the totals are unknown, not low", [[...rn.missingIngredientIds], rn.totals.calories, rn.complete], [["coconut"], null, false])
const blockers = rankBlockers([rn], (id) => graph.ingredients.get(id)?.proof ?? "NONE")
check("1i. 'To fix': the proof-only ingredient is listed as missing", blockers.map((b) => [b.ingredientId, b.kind]), [["coconut", "missing"], ["juice", "unverified"]])

// ─── 2. Verified needs a document (N1D-F2) ───────────────────────────────────
const food = { kind: "PURCHASED", nutritionExempt: false }
check("2a. numbers + link, no document → refused", verifyRefusal(food, { ...numberedRow, labelFileUrl: null }), "Upload the label document before marking this verified")
check("2b. numbers + document → allowed", verifyRefusal(food, numberedRow), null)
check("2c. proof-only (document, no numbers) → refused", verifyRefusal(food, proofOnlyRow), "Save nutrition before verifying it")
check("2d. removing the document resets VERIFIED, and nothing to reset otherwise", [resetsOnLabelRemoval("VERIFIED"), resetsOnLabelRemoval("ESTIMATED")], [true, false])
check("2e. proof can be attached to any food ingredient; not to prepared or not-food", [
  proofRefusal(food), proofRefusal({ kind: "PREPARED", nutritionExempt: false }) !== null, proofRefusal({ kind: "PURCHASED", nutritionExempt: true }) !== null,
], [null, true, true])

// ─── 3. Clearing numbers keeps the proof (N1D-F1a, F1b) ──────────────────────
check("3a. document left → keep a proof-only record", afterNumbersCleared({ labelFileUrl: DOC }, null), "keep-proof-only")
check("3b. only a link left → keep it (F1b: a link saves with no numbers)", afterNumbersCleared({ labelFileUrl: null }, LINK), "keep-proof-only")
check("3c. no record yet, a link given → a proof-only record is created", afterNumbersCleared(null, LINK), "keep-proof-only")
check("3d. nothing left → the record goes; no record and nothing → nothing", [afterNumbersCleared({ labelFileUrl: null }, null), afterNumbersCleared(null, null)], ["delete", "nothing"])

// ─── 4. Template + import round trip with proof-only records ─────────────────
const rec = (basisAmount: number, basisUnit: string, values: NutrientValues): NutritionInput => ({ basisAmount, basisUnit, values, sourceNote: null })
const tIng = (id: string, name: string, o: Partial<TemplateIngredient> = {}): TemplateIngredient => ({
  id, name, reportingUnit: "fl. oz", brand: null, kind: "PURCHASED", isActive: true, isArchived: false,
  category: "Dairy", allergens: [], nutritionExempt: false, nutrition: null, ...o,
})
const tAll: TemplateIngredient[] = [
  // proof-only WITH a link (the E trap), proof-only with a document only, a numbered record, no record, not-food
  tIng("coconut", "Coconut Milk", { nutrition: storedNutritionInput(proofOnlyRow), sourceUrl: LINK, proof: "NONE" }),
  tIng("oat", "Oat Milk", { nutrition: storedNutritionInput(proofOnlyRow), sourceUrl: null, proof: "NONE" }),
  tIng("almond", "Almond Milk", { allergens: ["TREE_NUTS"], nutrition: rec(8, "fl. oz", vals({ calories: 60 })), sourceUrl: LINK, proof: "VERIFIED" }),
  tIng("honey", "Honey", { category: null }),
  tIng("cup", "Cup", { category: null, nutritionExempt: true, sourceUrl: LINK, proof: "NONE" }),
]
const tCsv = parseNutritionCsv(buildNutritionTemplate(tAll))
const byName = Object.fromEntries(tCsv.rows.map((r) => [r.cells.name, r.cells]))
const c = byName["Coconut Milk"]
check("4a. proof-only exports as an empty row: basis 1 / reporting unit, no numbers, has_nutrition no, status blank",
  [c.basis_amount, c.basis_unit, c.calories, c.has_nutrition, c.status], ["1", "fl. oz", "", "no", ""])
check("4b. E: …but its source link IS exported; not-food still blank", [c.source_url, byName["Cup"].source_url], [LINK, ""])
const refOf = (t: TemplateIngredient, status: "ESTIMATED" | "VERIFIED" | null): PlanIngredientRef => ({
  id: t.id, name: t.name, brand: t.brand, reportingUnit: t.reportingUnit, kind: t.kind, nutrition: t.nutrition,
  allergens: t.allergens, nutritionExempt: t.nutritionExempt, sourceUrl: t.sourceUrl ?? null, status,
})
const refs = [refOf(tAll[0], "ESTIMATED"), refOf(tAll[1], "ESTIMATED"), refOf(tAll[2], "VERIFIED"), refOf(tAll[3], null), refOf(tAll[4], null)]
const tPlan = planNutritionImport(tCsv, refs)
const tSum = summarizeNutritionPlan(tPlan)
check("4c. the UNEDITED template, proof-only rows included, plans zero changes", [tSum.NEW, tSum.UPDATE, tSum.DETAILS_ONLY, tSum.NOT_FOOD, tSum.UNCHANGED, tSum.INVALID], [0, 0, 0, 0, 5, 0])
check("4d. no row is applyable", tPlan.filter((p) => APPLYABLE.has(p.status)).length, 0)

const HEAD = "name,basis_amount,basis_unit,calories,protein_g,allergens,not_food,source,source_url"
const plan = (row: string) => planNutritionImport(parseNutritionCsv(`${HEAD}\n${row}`), [refs[0]])
const filled = plan(`Coconut Milk,8,fl. oz,45,0,,,,${LINK}`)
check("4e. filling a proof-only row's numbers → NEW, and the link is NOT rewritten (kept as stored)", [filled[0].status, filled[0].write?.nutrition?.values.calories, filled[0].write?.sourceUrl ?? null], ["NEW", 45, null])
const blanked = plan(`Coconut Milk,8,fl. oz,45,0,,,,`)
check("4f. filling numbers AND blanking the link clears it explicitly", [blanked[0].status, blanked[0].write?.sourceUrl], ["NEW", { url: null }])
const newLink = plan(`Coconut Milk,1,fl. oz,,,,,,https://example.com/other`)
check("4g. a CHANGED link with no numbers is still rejected (the import never builds a proof-only record)", [newLink[0].status, newLink[0].detail], ["INVALID", "Add nutrient values before a source link"])

// ─── 5. Printed bounds (N1D-F3, F3a) ─────────────────────────────────────────
check("5a. cholesterol \"<5 mg\" → 2, flagged LESS_THAN_5MG", parsePrintedValue("cholesterolMg", "<5 mg", ""), { value: 2, flag: "LESS_THAN_5MG" })
check("5b. … \"less than 5mg\" too", parsePrintedValue("cholesterolMg", "less than 5mg", ""), { value: 2, flag: "LESS_THAN_5MG" })
const lt1 = (["totalCarbG", "dietaryFiberG", "totalSugarsG", "addedSugarsG", "proteinG"] as NutrientKey[]).map((k) => parsePrintedValue(k, "<1g", ""))
check("5c. \"<1 g\" → 0.5, flagged, for carb, fiber, sugars, added sugars, protein", lt1, Array(5).fill({ value: 0.5, flag: "LESS_THAN_1G" }))
const fats = (["totalFatG", "saturatedFatG", "transFatG"] as NutrientKey[]).map((k) => parsePrintedValue(k, "<1 g", ""))
check("5d. F3a: a fat \"<1 g\" is left BLANK, flagged as not an FDA fat declaration", fats, Array(3).fill({ value: null, flag: "LESS_THAN_1G_FAT" }))
check("5e. the fat flag says to enter it from the label", /not a standard FDA fat declaration/.test(FLAG_TEXT.LESS_THAN_1G_FAT), true)
check("5f. an unrecognised bound stays blank + flagged: sodium <5 mg, calories <5, cholesterol <2 mg", [
  parsePrintedValue("sodiumMg", "<5mg", ""), parsePrintedValue("calories", "<5", ""), parsePrintedValue("cholesterolMg", "<2mg", ""),
], Array(3).fill({ value: null, flag: "LESS_THAN_OTHER" }))
check("5g. a printed 0 g and a plain value are unchanged", [parsePrintedValue("totalFatG", "0g", ""), parsePrintedValue("proteinG", "1g", "")], [{ value: 0, flag: "ZERO" }, { value: 1, flag: null }])

// ─── 6. The migration file says what the rulings say ─────────────────────────
const MIGRATION = "prisma/migrations_archive/20261102220000_n1d_proof_only_nutrition/migration.sql"
const sql = readFileSync(MIGRATION, "utf8")
const BACKFILL = `UPDATE "IngredientNutrition"
SET "status" = 'ESTIMATED', "verifiedAt" = NULL, "verifiedByUserId" = NULL
WHERE "status" = 'VERIFIED' AND "labelFileUrl" IS NULL`
check("6a. the migration relaxes both basis columns", /"basisAmount" DROP NOT NULL/.test(sql) && /"basisUnit" DROP NOT NULL/.test(sql), true)
check("6b. the migration carries the basis CHECK (F1c)", sql.includes(`CHECK (("basisAmount" IS NULL) = ("basisUnit" IS NULL))`), true)
check("6c. the migration's backfill is exactly the statement part 7 runs", sql.includes(`${BACKFILL};`), true)
check("6d. nothing is dropped (additive only)", /DROP (COLUMN|TABLE|CONSTRAINT)/i.test(sql), false)

// ─── 7. Against the applied schema (dev), rolled back ────────────────────────
class Rollback extends Error {}
async function dbPart() {
  const [{ branch }] = await prisma.$queryRaw<{ branch: string | null }[]>`SELECT current_setting('neon.branch_id', true) AS branch`
  console.log(`  (database part on neon.branch_id = ${branch ?? "null"})`)
  try {
    await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { clerkOrgId: `n1d-fixture-${Date.now()}`, name: "N-1d Fixture Org" } })
      const mk = (name: string) =>
        tx.ingredient.create({
          data: {
            organizationId: org.id, name, purchaseUnitLabel: "carton", purchaseCost: 1,
            reportingUnit: "fl. oz", unitsPerPurchase: 64, costPerReportingUnit: 1 / 64,
          },
        })
      const [a, b, d] = [await mk("N-1d Fixture Coconut Milk"), await mk("N-1d Fixture Linked Milk"), await mk("N-1d Fixture Labelled Milk")]

      const proofOnly = await tx.ingredientNutrition.create({ data: { ingredientId: a.id, ...PROOF_ONLY_NUMBERS, labelFileUrl: DOC, labelFileName: "coconut.pdf" } })
      check("7a. a proof-only row stores with a null basis and reads back as no nutrition", [proofOnly.basisAmount, proofOnly.basisUnit, proofState(proofOnly, now)], [null, null, "NONE"])

      await tx.$executeRawUnsafe(`SAVEPOINT n1d_check`)
      let code: string | null = null
      try {
        await tx.$executeRawUnsafe(`UPDATE "IngredientNutrition" SET "basisUnit" = 'fl. oz' WHERE "ingredientId" = $1`, a.id)
      } catch (e) {
        code = (e as { meta?: { code?: string } }).meta?.code ?? (String(e).includes("IngredientNutrition_basis_together") ? "23514" : String(e))
      }
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT n1d_check`)
      check("7b. F1c: half a basis is refused by IngredientNutrition_basis_together", code, "23514")

      // Backfill: VERIFIED with a link only → reset; VERIFIED with a document → kept.
      const verified = { basisAmount: 8, basisUnit: "fl. oz", calories: 60, status: "VERIFIED" as const, verifiedAt: now }
      await tx.ingredientNutrition.create({ data: { ingredientId: b.id, ...verified, sourceUrl: LINK } })
      await tx.ingredientNutrition.create({ data: { ingredientId: d.id, ...verified, labelFileUrl: DOC } })
      // The migration's statement verbatim, scoped to this fixture's rows so the
      // rolled-back run never even locks real ones.
      const touched = await tx.$executeRawUnsafe(`${BACKFILL} AND "ingredientId" IN ($1, $2, $3)`, a.id, b.id, d.id)
      const after = await tx.ingredientNutrition.findMany({
        where: { ingredientId: { in: [b.id, d.id] } },
        select: { ingredientId: true, status: true, verifiedAt: true },
      })
      const st = (id: string) => after.find((x) => x.ingredientId === id)
      check("7c. backfill: exactly the link-only VERIFIED row is reset", touched, 1)
      check("7d. … to ESTIMATED with the date cleared; the documented one stays VERIFIED",
        [st(b.id)?.status, st(b.id)?.verifiedAt, st(d.id)?.status], ["ESTIMATED", null, "VERIFIED"])
      throw new Rollback()
    })
  } catch (e) {
    if (!(e instanceof Rollback)) throw e
  }
  const leaked = await prisma.organization.count({ where: { name: "N-1d Fixture Org" } })
  check("7e. rolled back: no fixture rows left behind", leaked, 0)
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
