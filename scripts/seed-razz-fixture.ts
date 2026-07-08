/**
 * Phase I-6 acceptance fixture — All That Razz (L), rebuilt from the Keva
 * export. Two modes:
 *
 *   npx tsx scripts/seed-razz-fixture.ts
 *     Pure in-memory verification (no DB): asserts the cost engine produces
 *     ≈ $2.14 / ≈ 25.2% at $8.49, rejects recipe loops with the named chain,
 *     shows N/A (never $0) for looped or dimension-broken recipes, and
 *     propagates sub-recipe edits through 2+ levels of nesting.
 *
 *   npx tsx scripts/seed-razz-fixture.ts --seed --org <organizationId>
 *     Additionally seeds the fixture into that org (ingredients carry
 *     sku FIXTURE-*; the sales item uses squareVariationId FIXTURE-RAZZ-L)
 *     so it can be exercised in the UI. --cleanup removes it again.
 */
import { PrismaClient } from "@prisma/client"
import { PrismaNeon } from "@prisma/adapter-neon"
import { neonConfig } from "@neondatabase/serverless"
import ws from "ws"
import * as dotenv from "dotenv"
import {
  computeRecipeCost,
  costPct,
  findLoop,
  loopErrorMessage,
  type CostGraph,
  type GraphIngredient,
  type GraphRecipe,
} from "../src/lib/recipe-cost"

dotenv.config()

let failures = 0
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures++
}

// ─── Fixture data (from the Keva export) ─────────────────────────────────────

const FIXTURE_INGREDIENTS = [
  { key: "juice", name: "Raspberry Juice Blend", reportingUnit: "fl. oz", cost: 0.2241 },
  { key: "sherbet", name: "Rainbow Sherbet", reportingUnit: "fl. oz", cost: 0.0562 },
  { key: "banana", name: "Bananas (sliced)", reportingUnit: "oz (dry)", cost: 0.0648 },
  { key: "strawberry", name: "Strawberries (sliced)", reportingUnit: "oz (dry)", cost: 0.0937 },
  { key: "cup32", name: "Cup - 32oz", reportingUnit: "each", cost: 0.28 },
  { key: "lid32", name: "Lid - 32oz", reportingUnit: "each", cost: 0.09 },
  { key: "spoon", name: "Spoon (long)", reportingUnit: "each", cost: 0.055 },
  { key: "napkin", name: "Napkin", reportingUnit: "each", cost: 0.0375 },
] as const

const RAZZ_PRICE_CENTS = 849

function ing(id: string, name: string, reportingUnit: string, cost: number): GraphIngredient {
  return {
    id,
    name,
    reportingUnit,
    costPerReportingUnit: cost,
    kind: "PURCHASED",
    preparedFromRecipeId: null,
    isActive: true,
    isArchived: false,
  }
}

function buildFixtureGraph(): CostGraph {
  const ingredients = new Map(FIXTURE_INGREDIENTS.map((i) => [i.key, ing(i.key, i.name, i.reportingUnit, i.cost)]))
  const cupKit: GraphRecipe = {
    id: "cup-kit",
    name: "Cup Kit - 32oz",
    salesItemId: null,
    yieldQty: 1,
    yieldUnit: "serving",
    servingSizeQty: 1,
    servingSizeUnit: "serving",
    isActive: true,
    lines: [
      { id: "ck1", ingredientId: "cup32", subRecipeId: null, amount: 1, unit: "each", sortOrder: 0 },
      { id: "ck2", ingredientId: "lid32", subRecipeId: null, amount: 1, unit: "each", sortOrder: 1 },
      { id: "ck3", ingredientId: "spoon", subRecipeId: null, amount: 1, unit: "each", sortOrder: 2 },
      { id: "ck4", ingredientId: "napkin", subRecipeId: null, amount: 1, unit: "each", sortOrder: 3 },
    ],
  }
  const razz: GraphRecipe = {
    id: "razz-l",
    name: "All That Razz (L)",
    salesItemId: "razz-l-item",
    yieldQty: 1,
    yieldUnit: "serving",
    servingSizeQty: null,
    servingSizeUnit: null,
    isActive: true,
    lines: [
      { id: "r1", ingredientId: "juice", subRecipeId: null, amount: 2.3, unit: "fl. oz", sortOrder: 0 },
      { id: "r2", ingredientId: "sherbet", subRecipeId: null, amount: 8, unit: "fl. oz", sortOrder: 1 },
      { id: "r3", ingredientId: "banana", subRecipeId: null, amount: 2.32, unit: "oz (dry)", sortOrder: 2 },
      { id: "r4", ingredientId: "strawberry", subRecipeId: null, amount: 6, unit: "oz (dry)", sortOrder: 3 },
      { id: "r5", ingredientId: null, subRecipeId: "cup-kit", amount: 1, unit: "serving", sortOrder: 4 },
    ],
  }
  return {
    recipes: new Map([
      [cupKit.id, cupKit],
      [razz.id, razz],
    ]),
    ingredients,
    preparedByRecipeId: new Map(),
  }
}

// ─── 1. Cost + cost% ─────────────────────────────────────────────────────────

function verifyCost() {
  const graph = buildFixtureGraph()
  const razz = computeRecipeCost(graph, "razz-l")
  const juiceLine = razz.lines.find((l) => l.lineId === "r1")
  check(
    "Juice line costs ≈ $0.52 (2.3 fl. oz @ $0.2241)",
    juiceLine?.cost !== null && Math.abs((juiceLine?.cost ?? 0) - 0.5154) < 0.005,
    `got ${juiceLine?.cost?.toFixed(4)}`
  )
  check("All That Razz (L) total ≈ $2.14", razz.cost !== null && Math.abs(razz.cost - 2.14) < 0.005, `got $${razz.cost?.toFixed(4)}`)
  const pctVal = costPct(razz.cost, RAZZ_PRICE_CENTS)
  check("Cost % ≈ 25.2% at $8.49", pctVal !== null && Math.abs(pctVal * 100 - 25.2) < 0.1, `got ${(pctVal! * 100).toFixed(2)}%`)
  check("costPct is null when price is absent", costPct(razz.cost, null) === null && costPct(razz.cost, 0) === null)
}

// ─── 2. Loop rejection + N/A (never $0) ──────────────────────────────────────

function verifyLoops() {
  const graph = buildFixtureGraph()
  const mk = (id: string, name: string, subId: string): GraphRecipe => ({
    id,
    name,
    salesItemId: null,
    yieldQty: 1,
    yieldUnit: "serving",
    servingSizeQty: null,
    servingSizeUnit: null,
    isActive: true,
    lines: [{ id: `${id}-l`, ingredientId: null, subRecipeId: subId, amount: 1, unit: "serving", sortOrder: 0 }],
  })
  graph.recipes.set("A", mk("A", "Recipe A", "B"))
  graph.recipes.set("B", mk("B", "Recipe B", "C"))
  graph.recipes.set("C", mk("C", "Recipe C", "A"))

  const loop = findLoop(graph, "A")
  check("Loop A → B → C → A is detected on save-validation", loop !== null)
  const msg = loop ? loopErrorMessage(loop) : ""
  check(
    "Loop error names the full chain",
    msg.includes("Recipe A → Recipe B → Recipe C → Recipe A") && msg.includes("remove one of these references"),
    msg
  )
  const costA = computeRecipeCost(graph, "A")
  check("Looped recipe cost is N/A (null), never $0", costA.cost === null && costA.error !== null)
  check("Non-looped recipes are unaffected by the loop", computeRecipeCost(graph, "razz-l").cost !== null)

  // Dimension mismatch → null, never silent 0.
  const broken = buildFixtureGraph()
  broken.recipes.get("razz-l")!.lines[0].unit = "oz (dry)" // juice is volume-based
  const costBroken = computeRecipeCost(broken, "razz-l")
  check("Dimension mismatch (dry oz of a fl.-oz ingredient) → cost N/A with a named error",
    costBroken.cost === null && (costBroken.error ?? "").includes("Can't convert"))
}

// ─── 3. Propagation through nesting ──────────────────────────────────────────

function verifyPropagation() {
  const graph = buildFixtureGraph()
  // Nest one level deeper: Cup Kit gains a "Topper Pack" sub-recipe holding the
  // napkin, so napkin → Topper Pack → Cup Kit → Razz is 3 levels.
  const topper: GraphRecipe = {
    id: "topper",
    name: "Topper Pack",
    salesItemId: null,
    yieldQty: 1,
    yieldUnit: "serving",
    servingSizeQty: null,
    servingSizeUnit: null,
    isActive: true,
    lines: [{ id: "t1", ingredientId: "napkin", subRecipeId: null, amount: 1, unit: "each", sortOrder: 0 }],
  }
  graph.recipes.set("topper", topper)
  const cupKit = graph.recipes.get("cup-kit")!
  cupKit.lines = cupKit.lines.map((l) =>
    l.ingredientId === "napkin" ? { ...l, ingredientId: null, subRecipeId: "topper", unit: "serving" } : l
  )

  const before = computeRecipeCost(graph, "razz-l").cost!
  check("Deep-nested fixture still totals ≈ $2.14", Math.abs(before - 2.14) < 0.005, `got $${before.toFixed(4)}`)

  // Raise the napkin cost by $0.10 → every level above must move by exactly $0.10.
  graph.ingredients.get("napkin")!.costPerReportingUnit += 0.1
  const after = computeRecipeCost(graph, "razz-l").cost!
  check(
    "Editing a 3rd-level ingredient propagates to the sales item's recipe cost",
    Math.abs(after - before - 0.1) < 1e-9,
    `Δ = $${(after - before).toFixed(4)}`
  )
  const cupAfter = computeRecipeCost(graph, "cup-kit").cost!
  check("…and to the intermediate sub-recipe", Math.abs(cupAfter - 0.4625 - 0.1) < 1e-9, `cup kit now $${cupAfter.toFixed(4)}`)
}

// ─── Optional DB seed ────────────────────────────────────────────────────────

async function seed(orgId: string, cleanup: boolean) {
  neonConfig.webSocketConstructor = ws
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! })
  const prisma = new PrismaClient({ adapter })

  const org = await prisma.organization.findUnique({ where: { id: orgId } })
  if (!org) throw new Error(`Organization ${orgId} not found`)

  if (cleanup) {
    const recipes = await prisma.recipe.findMany({
      where: { organizationId: orgId, name: { in: ["All That Razz (L)", "Cup Kit - 32oz"] } },
    })
    // Razz references Cup Kit — delete in dependency order.
    for (const name of ["All That Razz (L)", "Cup Kit - 32oz"]) {
      const r = recipes.find((x) => x.name === name)
      if (r) await prisma.recipe.delete({ where: { id: r.id } })
    }
    await prisma.salesItem.deleteMany({ where: { organizationId: orgId, squareVariationId: "FIXTURE-RAZZ-L" } })
    await prisma.ingredient.deleteMany({ where: { organizationId: orgId, sku: { startsWith: "FIXTURE-" } } })
    console.log("🧹 Fixture removed.")
    return
  }

  const ingredientIds = new Map<string, string>()
  for (const f of FIXTURE_INGREDIENTS) {
    const sku = `FIXTURE-${f.key.toUpperCase()}`
    const existing = await prisma.ingredient.findFirst({ where: { organizationId: orgId, sku } })
    const row =
      existing ??
      (await prisma.ingredient.create({
        data: {
          organizationId: orgId,
          name: f.name,
          sku,
          purchaseUnitLabel: "case",
          purchaseCost: f.cost * 100,
          reportingUnit: f.reportingUnit,
          unitsPerPurchase: 100,
          costPerReportingUnit: f.cost,
          notes: "I-6 acceptance fixture (safe to delete)",
        },
      }))
    ingredientIds.set(f.key, row.id)
  }

  const salesItem =
    (await prisma.salesItem.findFirst({ where: { organizationId: orgId, squareVariationId: "FIXTURE-RAZZ-L" } })) ??
    (await prisma.salesItem.create({
      data: {
        organizationId: orgId,
        squareItemId: "FIXTURE-RAZZ",
        squareVariationId: "FIXTURE-RAZZ-L",
        name: "All That Razz",
        variationName: "Large",
        displayName: "All That Razz (L)",
        menuGroup: "Smoothies",
        priceCents: RAZZ_PRICE_CENTS,
      },
    }))

  let cupKit = await prisma.recipe.findFirst({ where: { organizationId: orgId, name: "Cup Kit - 32oz" } })
  if (!cupKit) {
    cupKit = await prisma.recipe.create({
      data: {
        organizationId: orgId,
        name: "Cup Kit - 32oz",
        yieldQty: 1,
        yieldUnit: "serving",
        servingSizeQty: 1,
        servingSizeUnit: "serving",
        lines: {
          create: ["cup32", "lid32", "spoon", "napkin"].map((key, i) => ({
            ingredientId: ingredientIds.get(key)!,
            amount: 1,
            unit: "each",
            sortOrder: i,
          })),
        },
      },
    })
  }

  const razzExisting = await prisma.recipe.findFirst({ where: { organizationId: orgId, name: "All That Razz (L)" } })
  if (!razzExisting) {
    await prisma.recipe.create({
      data: {
        organizationId: orgId,
        name: "All That Razz (L)",
        salesItemId: salesItem.id,
        yieldQty: 1,
        yieldUnit: "serving",
        lines: {
          create: [
            { ingredientId: ingredientIds.get("juice")!, amount: 2.3, unit: "fl. oz", sortOrder: 0 },
            { ingredientId: ingredientIds.get("sherbet")!, amount: 8, unit: "fl. oz", sortOrder: 1 },
            { ingredientId: ingredientIds.get("banana")!, amount: 2.32, unit: "oz (dry)", sortOrder: 2 },
            { ingredientId: ingredientIds.get("strawberry")!, amount: 6, unit: "oz (dry)", sortOrder: 3 },
            { subRecipeId: cupKit.id, amount: 1, unit: "serving", sortOrder: 4 },
          ],
        },
      },
    })
    await prisma.salesItem.update({ where: { id: salesItem.id }, data: { recipeStatus: "MAPPED" } })
  }

  // Verify against the REAL database rows via a hand-built graph (mirrors loadCostGraph
  // without importing the app's prisma singleton).
  const [dbRecipes, dbIngredients] = await Promise.all([
    prisma.recipe.findMany({ where: { organizationId: orgId }, include: { lines: { orderBy: { sortOrder: "asc" } } } }),
    prisma.ingredient.findMany({ where: { organizationId: orgId, deletedAt: null } }),
  ])
  const graph: CostGraph = {
    recipes: new Map(dbRecipes.map((r) => [r.id, r])),
    ingredients: new Map(dbIngredients.map((i) => [i.id, i])),
    preparedByRecipeId: new Map(),
  }
  for (const i of dbIngredients) if (i.preparedFromRecipeId) graph.preparedByRecipeId.set(i.preparedFromRecipeId, i)

  const razzId = dbRecipes.find((r) => r.name === "All That Razz (L)")!.id
  const seeded = computeRecipeCost(graph, razzId)
  check("Seeded DB recipe totals ≈ $2.14", seeded.cost !== null && Math.abs(seeded.cost - 2.14) < 0.005, `got $${seeded.cost?.toFixed(4)}`)
  console.log(`🌱 Fixture seeded into "${org.name}" (${orgId}).`)
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("— I-6 acceptance fixture: All That Razz (L) —")
  verifyCost()
  verifyLoops()
  verifyPropagation()

  const orgFlag = process.argv.indexOf("--org")
  if (process.argv.includes("--seed") || process.argv.includes("--cleanup")) {
    if (orgFlag === -1 || !process.argv[orgFlag + 1]) {
      console.error("❌ --seed/--cleanup require --org <organizationId>")
      process.exit(1)
    }
    await seed(process.argv[orgFlag + 1], process.argv.includes("--cleanup"))
  }

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed.`)
    process.exit(1)
  }
  console.log("\nAll assertions passed.")
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e)
  process.exit(1)
})
