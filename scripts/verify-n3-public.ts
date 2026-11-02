/**
 * N-3 — the public nutrition menu's payload, pinned.
 *
 *   npx tsx scripts/verify-n3-public.ts
 *
 * Rulings: docs/DECISIONS.md 2026-11-02 N-3 (Gary, DRAFT): "Accept all leans"
 * — forks N3-F1–F8 and R-1–R-3 as written in docs/prompts/N-3_AUDIT.md.
 *
 * Parts 1–8 PURE. A synthetic org — graph, sales items, serving settings and publish
 * settings BUILT IN CODE — run through buildPublicMenu, menuIsLive and
 * publishCounts (src/lib/public-menu.ts), which are exactly what /menu/[slug]
 * and /nutrition/publish call. No database, no Next. Every name is invented;
 * everything that must never leave the app carries the word SECRET, so one
 * search of the serialized payload proves none of it did.
 * Part 9 DATABASE: against the database in local .env (dev), inside ONE
 * transaction that is ALWAYS rolled back — the APPLIED migration
 * 20261103000000_n3_public_menu (off by default, slug unique across orgs, one
 * menu per org, group FK, cascades). The branch is printed from
 * `neon.branch_id`, never typed.
 */

import "dotenv/config"
import { readFileSync } from "node:fs"
import type { Allergen, NutritionStatus, Prisma } from "@prisma/client"
import { prisma } from "../src/lib/prisma"
import { NUTRIENT_KEYS, type NutrientKey, type NutrientValues } from "../src/lib/nutrition"
import { buildLabel, resolveServing } from "../src/lib/nutrition-label"
import { proofState, type ProofState } from "../src/lib/nutrition-proof"
import { computeRecipeNutrition, type NutritionGraph, type NutritionIngredient } from "../src/lib/recipe-nutrition"
import type { GraphRecipe } from "../src/lib/recipe-cost"
import type { ServingSettings } from "../src/lib/nutrition-serving"
import {
  buildPublicMenu, menuIsLive, normalizeSlug, publishCounts, sizeStatuses, slugError, summarizeItems, suggestedInclude,
  DEFAULT_CROSS_CONTACT, DEFAULT_DISCLAIMER, type PublicMenuInput, type PublicMenuSalesItem,
} from "../src/lib/public-menu"

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`}`)
}

const NOW = new Date("2026-11-02T12:00:00Z")
function vals(partial: Partial<Record<NutrientKey, number | null>>, fill: number | null = 1): NutrientValues {
  return Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, k in partial ? partial[k]! : fill])) as NutrientValues
}

// ─── The synthetic org ────────────────────────────────────────────────────────
type IngSpec = { id: string; status?: NutritionStatus; verifiedAt?: Date | null; values?: NutrientValues | null; allergens?: Allergen[]; exempt?: boolean }
const verifiedAt = new Map<string, Date>()
function ing(s: IngSpec): NutritionIngredient {
  const values = s.values === undefined ? vals({ calories: 100 }) : s.values
  const rec = values ? { basisAmount: 100, basisUnit: "g", status: s.status ?? "ESTIMATED", verifiedAt: s.verifiedAt ?? null, sourceUrl: "https://SECRET-LINK.example", labelFileUrl: "https://SECRET-DOCUMENT.example" } : null
  if (s.verifiedAt) verifiedAt.set(s.id, s.verifiedAt)
  const proof: ProofState = proofState(rec, NOW)
  return {
    id: s.id, name: `SECRET-INGREDIENT-${s.id}`, reportingUnit: "g", costPerReportingUnit: 9.99, kind: "PURCHASED",
    preparedFromRecipeId: null, isActive: true, isArchived: false,
    brand: "SECRET-BRAND", nutritionExempt: s.exempt ?? false, allergens: s.allergens ?? [],
    nutrition: values ? { basisAmount: 100, basisUnit: "g", values } : null, proof,
  }
}
const ingredients = [
  ing({ id: "V1", status: "VERIFIED", verifiedAt: new Date("2026-10-01T09:00:00Z"), allergens: ["MILK"] }),
  ing({ id: "V2", status: "VERIFIED", verifiedAt: new Date("2026-09-15T09:00:00Z") }),
  ing({ id: "E1", status: "ESTIMATED" }),
  // 13 months old → STALE
  ing({ id: "S1", status: "VERIFIED", verifiedAt: new Date("2025-10-01T09:00:00Z") }),
  // Verified, but its label lacks vitamin D → the item is incomplete (N3-F6). Newer date than V1 — must NOT set "last updated".
  ing({ id: "P1", status: "VERIFIED", verifiedAt: new Date("2026-10-20T09:00:00Z"), values: vals({ calories: 100, vitaminDMcg: null }) }),
  ing({ id: "X1", exempt: true, values: null, allergens: [] }),
]

let lineN = 0
const recipe = (id: string, lines: { ingredientId: string; amount: number; unit?: string }[]): GraphRecipe => ({
  id, name: `SECRET-RECIPE-${id}`, salesItemId: null, yieldQty: 1, yieldUnit: "each", servingSizeQty: null, servingSizeUnit: null, isActive: true,
  lines: lines.map((l, i) => ({ id: `L${lineN++}`, ingredientId: l.ingredientId, subRecipeId: null, amount: l.amount, unit: l.unit ?? "g", sortOrder: i })),
})
const recipes = [
  recipe("rec-SECRET-A-M", [{ ingredientId: "V1", amount: 200 }, { ingredientId: "X1", amount: 1 }]),
  recipe("rec-SECRET-A-L", [{ ingredientId: "V1", amount: 300 }]),
  recipe("rec-SECRET-B-M", [{ ingredientId: "V2", amount: 200 }]),
  recipe("rec-SECRET-B-L", [{ ingredientId: "V2", amount: 200 }, { ingredientId: "E1", amount: 50 }]),
  recipe("rec-SECRET-C", [{ ingredientId: "S1", amount: 100 }]),
  recipe("rec-SECRET-D", [{ ingredientId: "P1", amount: 100 }]),
  recipe("rec-SECRET-E", [{ ingredientId: "V1", amount: 100 }]),
  recipe("rec-SECRET-F", [{ ingredientId: "V1", amount: 100 }]),
  recipe("rec-SECRET-G", [{ ingredientId: "X1", amount: 1 }]),
  recipe("rec-SECRET-J", [{ ingredientId: "V1", amount: 1, unit: "each" }]), // can't convert each → g: an engine error
]
const graph: NutritionGraph = { recipes: new Map(recipes.map((r) => [r.id, r])), ingredients: new Map(ingredients.map((i) => [i.id, i])) }
const serving: ServingSettings = { orgServingFlOz: null, sizeTable: new Map([["M", 24], ["L", 32]]) }

const si = (squareItemId: string, name: string, variationName: string, squareCategoryId: string | null, recipeId: string | null, recipeStatus = recipeId ? "MAPPED" : "UNMAPPED"): PublicMenuSalesItem =>
  ({ squareItemId, name, variationName, squareCategoryId, recipeStatus, recipeId, override: null })
const salesItems: PublicMenuSalesItem[] = [
  si("sq-SECRET-A", "Mango Tango", "L", "cat-SECRET-1", "rec-SECRET-A-L"), // listed L first to prove size ordering
  si("sq-SECRET-A", "Mango Tango", "M", "cat-SECRET-1", "rec-SECRET-A-M"),
  si("sq-SECRET-B", "Berry Blast", "M", "cat-SECRET-1", "rec-SECRET-B-M"),
  si("sq-SECRET-B", "Berry Blast", "L", "cat-SECRET-1", "rec-SECRET-B-L"),
  si("sq-SECRET-C", "Stale Shake", "M", "cat-SECRET-1", "rec-SECRET-C"),
  si("sq-SECRET-D", "Partial Panel", "M", "cat-SECRET-1", "rec-SECRET-D"),
  si("sq-SECRET-E", "Hidden Smoothie", "M", "cat-SECRET-1", "rec-SECRET-E"),
  si("sq-SECRET-F", "Logo Shirt", "M", "cat-SECRET-2", "rec-SECRET-F"),
  si("sq-SECRET-G", "Bottled Water", "Regular", "cat-SECRET-1", "rec-SECRET-G"),
  si("sq-SECRET-H", "Unmapped Smoothie", "M", "cat-SECRET-1", null),
  si("sq-SECRET-I", "Gift Card", "Regular", "cat-SECRET-1", null, "NON_RECIPE"),
  si("sq-SECRET-J", "Broken Recipe", "M", "cat-SECRET-1", "rec-SECRET-J"),
  si("sq-SECRET-K", "No Category", "M", null, "rec-SECRET-E"),
]

const input: PublicMenuInput = {
  orgName: "Fixture Juice Co",
  disclaimer: null,
  crossContactNotice: "  ",
  includedCategoryIds: new Set(["cat-SECRET-1"]),
  hiddenSquareItemIds: new Set(["sq-SECRET-E"]),
  categories: new Map([["cat-SECRET-1", "Smoothies"], ["cat-SECRET-2", "Retail"]]),
  salesItems,
  graph,
  serving,
  verifiedAtOf: (id) => verifiedAt.get(id) ?? null,
}
const menu = buildPublicMenu(input)
const items = new Map(menu.groups.flatMap((g) => g.items).map((i) => [i.name, i]))
const sizes = (name: string) => items.get(name)?.sizes.map((s) => [s.name, s.calories, s.label !== null])

// ─── 1. Nothing app-side leaves (prompt item 4) ───────────────────────────────
const FORBIDDEN_KEY = /price|cost|ingredient|recipe|vendor|url|link|document|file|user|amount|basis|square|sales|organization|^id$|Id$|actual|^spec$|^servings$|verif|proof|source|missing/i
function keysDeep(v: unknown, path = "", out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x, i) => keysDeep(x, `${path}[${i}]`, out))
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.push(k); keysDeep(x, `${path}.${k}`, out) }
  return out
}
// LabelValue carries `missing: false` on every line by type; that key is the
// N-2 panel's own shape, not data. Every OTHER key is checked.
const allKeys = [...new Set(keysDeep(menu))].filter((k) => k !== "missing")
check("1a. no key in the payload names a price, cost, ingredient, recipe, vendor, link, document, file, user, id or proof field (recursive)",
  allKeys.filter((k) => FORBIDDEN_KEY.test(k)), [])
check("1b. the payload's keys are exactly the public shape", allKeys.sort(),
  ["allergens", "columns", "contains", "crossContactNotice", "disclaimer", "dual", "dv", "groups", "heading", "items", "label", "lastUpdated", "name", "orgName", "servingSize", "servingsPerContainer", "sizes", "text", "values", ...NUTRIENT_KEYS].sort())
check("1c. no SECRET value (ingredient or brand name, recipe, Square or category id, link, document) appears anywhere in the serialized payload",
  JSON.stringify(menu).includes("SECRET"), false)
check("1d. the payload survives a JSON round trip unchanged (what the cache stores)", JSON.parse(JSON.stringify(menu)), menu)

// ─── 2. Verified sizes show numbers; everything else "coming soon" (N3-F1, F6, F8) ──
check("2a. fully Verified item: both sizes show calories and a label, ordered by volume (M 24 before L 32)",
  sizes("Mango Tango"), [["M", "200", true], ["L", "300", true]])
check("2b. … and its allergens (every size Verified, N3-F7)", items.get("Mango Tango")?.allergens, ["Milk"])
check("2c. N3-F7 per size: Berry Blast M shows numbers, L (an Estimated ingredient) is coming soon", sizes("Berry Blast"), [["M", "200", true], ["L", null, false]])
check("2d. … and NO allergens at item level, since not every size is Verified", items.get("Berry Blast")?.allergens, null)
check("2e. a stale-verified ingredient (13 months) counts as unverified → coming soon, no allergens",
  [sizes("Stale Shake"), items.get("Stale Shake")?.allergens], [[["M", null, false]], null])
check("2f. N3-F6: Verified but incomplete (vitamin D unknown) → coming soon, no numbers", sizes("Partial Panel"), [["M", null, false]])
check("2g. N3-F8: only not-food lines (NO_FOOD) → coming soon", sizes("Bottled Water"), [["Regular", null, false]])
check("2h. N3-F8: no recipe yet → coming soon", sizes("Unmapped Smoothie"), [["M", null, false]])
check("2i. a recipe with an engine error → coming soon", sizes("Broken Recipe"), [["M", null, false]])
const unverifiedNames = ["Stale Shake", "Partial Panel", "Bottled Water", "Unmapped Smoothie", "Broken Recipe"]
check("2j. no unverified item carries a number or an allergen anywhere",
  unverifiedNames.map((n) => JSON.stringify(items.get(n)).match(/"calories":"|"label":\{|"allergens":\[/) !== null), unverifiedNames.map(() => false))

// ─── 3. What is left off ──────────────────────────────────────────────────────
check("3a. hidden item absent", items.has("Hidden Smoothie"), false)
check("3b. item in an excluded group absent", items.has("Logo Shirt"), false)
check("3c. NON_RECIPE item absent (N3-F8)", items.has("Gift Card"), false)
check("3d. item with no Square category absent", items.has("No Category"), false)
check("3e. groups: only the included one, by its name", menu.groups.map((g) => g.name), ["Smoothies"])
check("3f. nothing included → empty menu", buildPublicMenu({ ...input, includedCategoryIds: new Set() }).groups, [])

// ─── 4. Calories per size = the N-2 label's per-container value (N3-F2) ───────
function n2PerContainer(recipeId: string, variationName: string): string {
  const n = computeRecipeNutrition(graph, recipeId)
  const spec = resolveServing({ variationName, orgServingFlOz: serving.orgServingFlOz, sizeTable: serving.sizeTable, override: null })
  const l = buildLabel({ totals: n.totals, allergens: n.allergens, error: n.error, verification: "VERIFIED" }, spec)
  if (!l.ok) throw new Error(l.error)
  return l.label.columns[l.label.columns.length - 1].values.calories.text
}
check("4a. Mango Tango M and L list calories equal N-2's per-container value",
  sizes("Mango Tango")?.map((s) => s[1]), [n2PerContainer("rec-SECRET-A-M", "M"), n2PerContainer("rec-SECRET-A-L", "L")])
const mtM = items.get("Mango Tango")!.sizes[0].label!
check("4b. … the M label is the N-2 panel: 2 servings per container, 12 fl oz (360 mL), per serving 100 / per container 200",
  [mtM.servingsPerContainer, mtM.servingSize, mtM.dual, mtM.columns.map((c) => c.values.calories.text), mtM.contains],
  ["2 servings per container", "12 fl oz (360 mL)", true, ["100", "200"], "Contains: Milk"])

// ─── 5. Texts and "last updated" ──────────────────────────────────────────────
check("5a. null disclaimer and blank cross-contact text → the defaults", [menu.disclaimer, menu.crossContactNotice], [DEFAULT_DISCLAIMER, DEFAULT_CROSS_CONTACT])
check("5b. custom texts pass through trimmed", (() => { const m = buildPublicMenu({ ...input, disclaimer: "  Ours.  ", crossContactNotice: "Shared blenders." }); return [m.disclaimer, m.crossContactNotice] })(), ["Ours.", "Shared blenders."])
check("5c. last updated = newest verification among SHOWN sizes (V1 2026-10-01; not P1's 2026-10-20 — that item is not shown)", menu.lastUpdated, "2026-10-01")
check("5d. nothing verified shown → no last-updated date", buildPublicMenu({ ...input, hiddenSquareItemIds: new Set(["sq-SECRET-A", "sq-SECRET-B", "sq-SECRET-E"]) }).lastUpdated, null)
check("5e. the org's display name", menu.orgName, "Fixture Juice Co")

// ─── 6. Off / unknown → not found (prompt item 6, R-2) ────────────────────────
const both = { activeModules: ["inventory", "nutrition"] }
check("6a. no row (unknown slug) → not live", menuIsLive(null, both), false)
check("6b. menu turned off → not live", menuIsLive({ enabled: false }, both), false)
check("6c. nutrition module off → not live", menuIsLive({ enabled: true }, { activeModules: ["inventory"] }), false)
check("6d. inventory module off → not live", menuIsLive({ enabled: true }, { activeModules: ["nutrition"] }), false)
check("6e. on, both modules → live", menuIsLive({ enabled: true }, both), true)

// ─── 7. Slug ──────────────────────────────────────────────────────────────────
check("7a. normalizeSlug trims and lowercases", normalizeSlug("  Keva-Juice "), "keva-juice")
check("7b. valid slugs", ["keva-juice", "abc", "keva2"].map(slugError), [null, null, null])
check("7c. refused: too short, uppercase, space, leading/trailing/double hyphen, slash",
  ["ab", "Keva", "keva juice", "-keva", "keva-", "keva--juice", "keva/juice"].map((s) => slugError(s) !== null), [true, true, true, true, true, true, true])

// ─── 8. Publish-page counts (prompt item 1) — ITEMS, same test as the page ────
const summaries = summarizeItems(salesItems, sizeStatuses(input))
check("8a. counts: 2 items show nutrition (Mango, Berry) · 5 coming soon · 1 hidden; NON_RECIPE, excluded and uncategorized not counted",
  publishCounts(summaries, input.includedCategoryIds, input.hiddenSquareItemIds), { showing: 2, comingSoon: 5, hidden: 1 })
check("8b. counts agree with the payload", [...items.values()].filter((i) => i.sizes.some((s) => s.calories !== null)).length, 2)
check("8c. suggested set leaves Archived / Retail / Shirts / Bouquets / Services / Fundraising unticked, keeps Smoothies",
  ["Archived", "Retail", "Keva Shirts", "Fruit Bouquets", "Services", "Fundraising", "Smoothies", "Keva Coffee"].map(suggestedInclude),
  [false, false, false, false, false, false, true, true])

// ─── 9. The migration file, and the APPLIED schema (dev), rolled back ─────────
const sql = readFileSync("prisma/migrations/20261103000000_n3_public_menu/migration.sql", "utf8")
check("9a. the migration only adds: three CREATE TABLEs, no DROP, no ALTER COLUMN",
  [["\"PublicMenu\"", "\"PublicMenuCategory\"", "\"PublicMenuHiddenItem\""].map((t) => sql.includes(`CREATE TABLE ${t}`)), /DROP|ALTER COLUMN/i.test(sql)], [[true, true, true], false])

class Rollback extends Error {}
async function dbPart() {
  const [{ branch }] = await prisma.$queryRaw<{ branch: string | null }[]>`SELECT current_setting('neon.branch_id', true) AS branch`
  console.log(`  (database part on neon.branch_id = ${branch ?? "null"})`)
  const code = async (tx: Prisma.TransactionClient, name: string, fn: () => Promise<unknown>) => {
    await tx.$executeRawUnsafe(`SAVEPOINT ${name}`)
    let c: string | null = null
    try { await fn() } catch (e) { c = (e as { code?: string }).code ?? String(e) }
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`)
    return c
  }
  try {
    await prisma.$transaction(async (tx) => {
      const stamp = Date.now()
      const a = await tx.organization.create({ data: { clerkOrgId: `n3-fixture-a-${stamp}`, name: "N-3 Fixture Org", activeModules: ["inventory", "nutrition"] } })
      const b = await tx.organization.create({ data: { clerkOrgId: `n3-fixture-b-${stamp}`, name: "N-3 Fixture Org" } })
      const cat = await tx.squareCategory.create({ data: { organizationId: a.id, squareCategoryId: `n3-cat-${stamp}`, name: "N-3 Fixture Smoothies" } })

      const menu = await tx.publicMenu.create({ data: { organizationId: a.id, slug: `n3-fixture-${stamp}` } })
      check("9b. a new PublicMenu is OFF by default (N3-F3) and its texts default to null (= the code defaults)", [menu.enabled, menu.disclaimer, menu.crossContactNotice], [false, null, null])
      check("9c. a slug is unique ACROSS orgs", await code(tx, "n3_slug", () => tx.publicMenu.create({ data: { organizationId: b.id, slug: menu.slug } })), "P2002")
      check("9d. one menu per org", await code(tx, "n3_org", () => tx.publicMenu.create({ data: { organizationId: a.id, slug: `n3-other-${stamp}` } })), "P2002")

      await tx.publicMenuCategory.create({ data: { publicMenuId: menu.id, squareCategoryId: cat.id } })
      await tx.publicMenuHiddenItem.create({ data: { publicMenuId: menu.id, squareItemId: "n3-item" } })
      check("9e. an included group is listed once", await code(tx, "n3_cat", () => tx.publicMenuCategory.create({ data: { publicMenuId: menu.id, squareCategoryId: cat.id } })), "P2002")
      check("9f. an included group must be a real SquareCategory row (FK)", await code(tx, "n3_fk", () => tx.publicMenuCategory.create({ data: { publicMenuId: menu.id, squareCategoryId: "no-such-category" } })), "P2003")

      const live = await tx.publicMenu.update({ where: { id: menu.id }, data: { enabled: true }, select: { enabled: true, organization: { select: { activeModules: true } } } })
      check("9g. turned on, both modules → live; the same row with the module off → not live",
        [menuIsLive(live, live.organization), menuIsLive(live, { activeModules: ["inventory"] })], [true, false])

      await tx.publicMenu.delete({ where: { id: menu.id } })
      check("9h. deleting the menu removes its groups and hidden items (cascade)",
        [await tx.publicMenuCategory.count({ where: { publicMenuId: menu.id } }), await tx.publicMenuHiddenItem.count({ where: { publicMenuId: menu.id } })], [0, 0])
      throw new Rollback()
    })
  } catch (e) {
    if (!(e instanceof Rollback)) throw e
  }
  const leaked = await prisma.organization.count({ where: { name: "N-3 Fixture Org" } })
  check("9i. rolled back: no fixture rows left behind", leaked, 0)
}

dbPart()
  .catch((e) => {
    failures++
    console.log(`✗ 9. database part threw: ${e instanceof Error ? e.message : e}`)
  })
  .finally(async () => {
    await prisma.$disconnect()
    console.log(failures === 0 ? "\n✓ ALL PASS" : `\n✗ ${failures} CHECK(S) FAILED`)
    process.exit(failures === 0 ? 0 : 1)
  })
