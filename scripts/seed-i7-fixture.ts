/**
 * Phase I-7 acceptance fixture — pars, alerts & Smart Cart, layered on the
 * I-6 Razz ingredients (created here if missing). Three modes:
 *
 *   npx tsx scripts/seed-i7-fixture.ts --seed --org <organizationId> [--store <storeId>]
 *     Seeds: FIXTURE vendor (minimums $200 / 5 cases, Mon+Thu delivery days,
 *     standing $5 fuel-surcharge adjustment with a GL code), vendor prices for
 *     every fixture ingredient, pars + reorder points on all 8, and a
 *     finalized full count that leaves Strawberries below their reorder point
 *     so one alert fires out of the box.
 *
 *   npx tsx scripts/seed-i7-fixture.ts --verify --org <organizationId> [--store <storeId>]
 *     End-to-end smoke test: expected inventory is sane → the strawberry
 *     alert fires with the correctly rounded suggested order → Smart Cart
 *     fill-to-par math builds a 1-case draft PO → receiving it clears the
 *     alert → deleting the smoke PO brings the alert back (demoable state).
 *
 *   npx tsx scripts/seed-i7-fixture.ts --cleanup --org <organizationId>
 *     Removes everything this script created (fixture ingredients stay —
 *     they belong to seed-razz-fixture.ts).
 */
import "dotenv/config"
import { prisma } from "../src/lib/prisma"
import { computeExpectedInventory, computeLowStockAlerts } from "../src/lib/expected-inventory"

const FIXTURE_VENDOR = "FIXTURE Produce Co"
const FIXTURE_COUNT = "I-7 Fixture Count"
const FIXTURE_PO_NOTE = "FIXTURE-I7-SMOKE"

// Mirrors seed-razz-fixture.ts — created here too so this script stands alone.
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

// Counted quantities and pars (reporting units). Strawberry is the low one:
// expected 5 < reorder 20 → alert; fill-to-par needs 35 more → 1 case of 100.
const PLAN: Record<string, { counted: number; par: number; reorder: number }> = {
  juice: { counted: 150, par: 100, reorder: 50 },
  sherbet: { counted: 300, par: 200, reorder: 100 },
  banana: { counted: 120, par: 80, reorder: 40 },
  strawberry: { counted: 5, par: 40, reorder: 20 },
  cup32: { counted: 400, par: 300, reorder: 150 },
  lid32: { counted: 400, par: 300, reorder: 150 },
  spoon: { counted: 500, par: 300, reorder: 150 },
  napkin: { counted: 800, par: 500, reorder: 250 },
}

let failures = 0
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures++
}

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag)
  return i !== -1 ? process.argv[i + 1] ?? null : null
}

async function resolveContext(orgId: string, storeIdArg: string | null) {
  const org = await prisma.organization.findUnique({ where: { id: orgId } })
  if (!org) throw new Error(`Organization ${orgId} not found`)
  const store = storeIdArg
    ? await prisma.store.findFirst({ where: { id: storeIdArg, organizationId: orgId } })
    : await prisma.store.findFirst({ where: { organizationId: orgId, isActive: true }, orderBy: { name: "asc" } })
  if (!store) throw new Error("No store found — pass --store <storeId>")
  const user = await prisma.user.findFirst({ where: { organizationId: orgId } })
  return { org, store, userId: user?.id ?? "fixture" }
}

async function ensureIngredients(orgId: string): Promise<Map<string, { id: string; costPerReportingUnit: number; unitsPerPurchase: number; purchaseCost: number; name: string; reportingUnit: string }>> {
  const byKey = new Map<string, { id: string; costPerReportingUnit: number; unitsPerPurchase: number; purchaseCost: number; name: string; reportingUnit: string }>()
  for (const f of FIXTURE_INGREDIENTS) {
    const sku = `FIXTURE-${f.key.toUpperCase()}`
    const row =
      (await prisma.ingredient.findFirst({ where: { organizationId: orgId, sku } })) ??
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
          notes: "I-6/I-7 acceptance fixture (safe to delete)",
        },
      }))
    byKey.set(f.key, {
      id: row.id,
      costPerReportingUnit: row.costPerReportingUnit,
      unitsPerPurchase: row.unitsPerPurchase,
      purchaseCost: row.purchaseCost,
      name: row.name,
      reportingUnit: row.reportingUnit,
    })
  }
  return byKey
}

async function seed(orgId: string, storeIdArg: string | null) {
  const { org, store } = await resolveContext(orgId, storeIdArg)
  const ingredients = await ensureIngredients(orgId)

  // Vendor with minimums, delivery days, and a standing adjustment (Part 5).
  const vendor =
    (await prisma.vendor.findFirst({ where: { organizationId: orgId, name: FIXTURE_VENDOR } })) ??
    (await prisma.vendor.create({
      data: {
        organizationId: orgId,
        name: FIXTURE_VENDOR,
        contactName: "Sam Fixture",
        email: "orders@fixture.example",
        leadTimeDays: 2,
        minOrderCases: 5,
        minOrderDollars: 200,
        deliveryDays: [1, 4], // Mon + Thu
        notes: "I-7 acceptance fixture (safe to delete)",
      },
    }))
  const existingAdj = await prisma.vendorAdjustment.findFirst({ where: { vendorId: vendor.id, name: "Fuel Surcharge" } })
  if (!existingAdj) {
    await prisma.vendorAdjustment.create({
      data: { vendorId: vendor.id, name: "Fuel Surcharge", type: "FLAT", value: 5, glCode: "5510" },
    })
  }

  for (const [, ing] of ingredients) {
    await prisma.vendorIngredient.upsert({
      where: { vendorId_ingredientId: { vendorId: vendor.id, ingredientId: ing.id } },
      create: { vendorId: vendor.id, ingredientId: ing.id, casePrice: ing.purchaseCost, unitsPerCase: ing.unitsPerPurchase },
      update: { casePrice: ing.purchaseCost, unitsPerCase: ing.unitsPerPurchase },
    })
  }

  // Pars + reorder points (Part 2).
  for (const [key, ing] of ingredients) {
    const plan = PLAN[key]
    await prisma.storeIngredientPar.upsert({
      where: { storeId_ingredientId: { storeId: store.id, ingredientId: ing.id } },
      create: {
        organizationId: orgId,
        storeId: store.id,
        ingredientId: ing.id,
        parLevel: plan.par,
        reorderPoint: plan.reorder,
      },
      update: { parLevel: plan.par, reorderPoint: plan.reorder },
    })
  }

  // Finalized full count 2h ago — the expected engine's starting point.
  const existingCount = await prisma.inventoryCount.findFirst({
    where: { organizationId: orgId, storeId: store.id, name: FIXTURE_COUNT },
  })
  if (!existingCount) {
    const finalizedAt = new Date(Date.now() - 2 * 3600_000)
    const value = [...ingredients.entries()].reduce(
      (s, [key, ing]) => s + PLAN[key].counted * ing.costPerReportingUnit,
      0
    )
    await prisma.inventoryCount.create({
      data: {
        organizationId: orgId,
        storeId: store.id,
        name: FIXTURE_COUNT,
        status: "Finalized",
        isPartial: false,
        startedAt: finalizedAt,
        finalizedAt,
        sittingInventoryVal: value,
        lines: {
          create: [...ingredients.entries()].map(([key, ing], i) => ({
            ingredientId: ing.id,
            ingredientName: ing.name,
            reportingUnit: ing.reportingUnit,
            quantityCounted: PLAN[key].counted,
            costPerReportingUnit: ing.costPerReportingUnit,
            lineValue: PLAN[key].counted * ing.costPerReportingUnit,
            sortOrder: i,
            countedAt: finalizedAt,
          })),
        },
      },
    })
  }

  console.log(`🌱 I-7 fixture seeded into "${org.name}" at store "${store.name}".`)
  console.log("   Vendor minimums: 5 cases / $200 · delivery Mon+Thu · standing $5 fuel surcharge (GL 5510)")
  console.log("   Pars on 8 ingredients; Strawberries (5 on hand < reorder 20) should be alerting.")
}

async function verify(orgId: string, storeIdArg: string | null) {
  const { org, store, userId } = await resolveContext(orgId, storeIdArg)
  const ingredients = await ensureIngredients(orgId)
  const strawberry = ingredients.get("strawberry")!
  const vendor = await prisma.vendor.findFirst({ where: { organizationId: orgId, name: FIXTURE_VENDOR } })
  if (!vendor) throw new Error("Fixture vendor missing — run --seed first")

  // 1. Expected inventory is sane.
  const expected = await computeExpectedInventory(org, store)
  check("Expected inventory has a base count", expected.baseCount !== null)
  const strawRow = expected.rows.find((r) => r.ingredientId === strawberry.id)
  check(
    "Strawberry expected ≈ counted 5 (no movement since count)",
    strawRow !== undefined && Math.abs(strawRow.expectedQty - PLAN.strawberry.counted) < 0.01,
    `expected ${strawRow?.expectedQty}`
  )

  // 2. The alert fires with a correctly rounded suggestion.
  let alerts = await computeLowStockAlerts(org, store)
  const strawAlert = alerts.alerts.find((a) => a.ingredientId === strawberry.id)
  check("Strawberry low-stock alert fires (5 < reorder 20)", strawAlert !== undefined)
  check(
    "Suggested order = 1 case (par 40 − 5 = 35 → rounds up to 100-unit case)",
    strawAlert?.suggestedOrderUnits === 1,
    `got ${strawAlert?.suggestedOrderUnits}`
  )
  check("Only strawberry is alerting", alerts.alerts.length === 1, `got ${alerts.alerts.length}`)

  // 3. Smart Cart fill-to-par math → one draft PO for the vendor.
  const deficit = Math.max(0, PLAN.strawberry.par - (strawRow?.expectedQty ?? 0))
  const cases = Math.ceil(deficit / strawberry.unitsPerPurchase - 1e-9)
  check("Fill-to-par computes 1 case", cases === 1, `got ${cases}`)
  const poCount = await prisma.purchaseOrder.count({ where: { organizationId: orgId } })
  const po = await prisma.purchaseOrder.create({
    data: {
      organizationId: orgId,
      storeId: store.id,
      vendorId: vendor.id,
      poNumber: `PO-FIXTURE-${String(poCount + 1).padStart(5, "0")}`,
      status: "DRAFT",
      totalAmount: cases * strawberry.purchaseCost,
      enteredByUserId: userId === "fixture" ? null : userId,
      invoiceNumber: FIXTURE_PO_NOTE,
      lines: {
        create: [
          {
            ingredientId: strawberry.id,
            ingredientName: strawberry.name,
            quantityOrdered: cases,
            unitCost: strawberry.purchaseCost,
            lineTotal: cases * strawberry.purchaseCost,
          },
        ],
      },
    },
    include: { lines: true },
  })
  check("Draft PO created for the fixture vendor", po.status === "DRAFT" && po.lines.length === 1)

  // 4. Receive it (the same stock effect the receive route records).
  const now = new Date()
  await prisma.purchaseOrderLine.update({
    where: { id: po.lines[0].id },
    data: { quantityReceived: cases, receivedAt: now },
  })
  await prisma.purchaseOrder.update({
    where: { id: po.id },
    data: { status: "RECEIVED", orderedAt: now, receivedAt: now },
  })

  // 5. The alert clears on the next expected calc.
  alerts = await computeLowStockAlerts(org, store)
  const cleared = !alerts.alerts.some((a) => a.ingredientId === strawberry.id)
  check("Alert clears after receiving (expected 5 + 100 = 105 > trigger 20)", cleared)

  // 6. Remove the smoke PO so the seeded demo state (alert firing) returns.
  await prisma.purchaseOrder.delete({ where: { id: po.id } })
  alerts = await computeLowStockAlerts(org, store)
  check(
    "Smoke PO removed — alert fires again for the demo",
    alerts.alerts.some((a) => a.ingredientId === strawberry.id)
  )
}

async function cleanup(orgId: string) {
  const vendor = await prisma.vendor.findFirst({ where: { organizationId: orgId, name: FIXTURE_VENDOR } })
  if (vendor) {
    await prisma.purchaseOrder.deleteMany({ where: { vendorId: vendor.id } })
    await prisma.vendor.delete({ where: { id: vendor.id } }) // cascades VendorIngredient + VendorAdjustment
  }
  const skus = FIXTURE_INGREDIENTS.map((f) => `FIXTURE-${f.key.toUpperCase()}`)
  const fixtureIngredients = await prisma.ingredient.findMany({ where: { organizationId: orgId, sku: { in: skus } } })
  await prisma.storeIngredientPar.deleteMany({
    where: { organizationId: orgId, ingredientId: { in: fixtureIngredients.map((i) => i.id) } },
  })
  await prisma.inventoryCount.deleteMany({ where: { organizationId: orgId, name: FIXTURE_COUNT } })
  console.log("🧹 I-7 fixture removed (Razz ingredients/recipes left for seed-razz-fixture.ts --cleanup).")
}

async function main() {
  console.log("— I-7 acceptance fixture: pars, alerts & Smart Cart —")
  const orgId = arg("--org")
  if (!orgId) {
    console.log("Usage: npx tsx scripts/seed-i7-fixture.ts (--seed | --verify | --cleanup) --org <orgId> [--store <storeId>]")
    process.exit(1)
  }
  const storeId = arg("--store")
  if (process.argv.includes("--cleanup")) await cleanup(orgId)
  else if (process.argv.includes("--verify")) await verify(orgId, storeId)
  else await seed(orgId, storeId)

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`)
    process.exit(1)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
