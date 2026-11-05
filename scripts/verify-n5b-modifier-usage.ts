/**
 * N-5b — add-on (modifier) recipes counted in theoretical inventory usage.
 *
 *   npx tsx scripts/verify-n5b-modifier-usage.ts
 *
 * Square is STUBBED and COUNTED — globalThis.fetch is wrapped so that
 * /v2/orders/search answers from canned pages, and any other request to a
 * Square host throws. Real Square is never called. The database is the dev
 * branch (.env), as for every verify-* fixture; a throwaway org + store
 * ("ZZ N-5b Fixture …") is created and deleted.
 *
 * Asserts (rulings: docs/DECISIONS.md 2026-11-04 N-5b):
 *   M1  sync stores Σ (line qty × modifier qty) per modifier per day —
 *       an add-on on a 2-cup line counts twice
 *   M2  a missing modifier quantity counts as 1 (R4)
 *   M3  quantity 0 (a removed default-on modifier) writes no row and no usage
 *   M4  a modifier on a line with no catalog id still counts
 *   M5  refunds are not read (R2): `returns[]` changes nothing
 *   M6  THREE IDENTICAL SYNCS (sequential, then a concurrent burst of three)
 *       leave identical rows and identical usage — replaced, never appended
 *   M7  a modifier that drops out of the day on re-read loses its row
 *   U1  usage expands through modifier recipes: add-on adds, "No X" subtracts
 *   U2  an add-on with no recipe is skipped and COUNTED (R3); one not in the
 *       synced catalog counts too; NON_RECIPE is skipped silently
 *   U3  an on-by-default add-on is skipped even with a recipe (R5)
 *   U4  days synced before N-5b say they have no add-on data (R1b) — both a
 *       pre-migration row (default false) and a writer that read no modifiers
 *   U5  the consumer path: computeWeeklyUsage (sales basis) includes add-ons
 *   S1  both computation sites (salesUsageForWindow, variance) use the helper,
 *       in their own mode; the migration is additive only
 *
 * Proven able to fail (2026-11-04, dev): against the pre-N-5b
 * src/lib/sales-sync.ts (modifiers dropped) 19 of 36 checks fail — every M1,
 * M2, M4, M5, U1–U5 check and M6's row total. M3, M7 and M6's "identical"
 * checks pass there VACUOUSLY (nothing is written, so nothing differs); M6's
 * row total (6 rows, Σ 15) is the one that catches a missing write.
 */
import "dotenv/config"
import { readFileSync } from "fs"
import { prisma } from "../src/lib/prisma"
import { localDateStr, dbDate } from "../src/lib/reports"
import { syncSalesForStore, writeSalesCache, emptyDayAgg } from "../src/lib/sales-sync"
import { modifierUsageForWindow } from "../src/lib/modifier-usage"
import { loadCostGraph } from "../src/lib/recipe-cost"
import { computeWeeklyUsage } from "../src/lib/expected-inventory"

const TZ = "America/Los_Angeles"
const OZ = "oz (dry)"

let failures = 0
let passes = 0
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${detail ? ` — ${detail}` : ""}`)
  if (ok) passes += 1
  else failures += 1
}
const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 1e-9

// ── Square stub ──────────────────────────────────────────────────────────────
let squareSearches = 0
let pages: { orders: unknown[]; cursor?: string }[] = [{ orders: [] }]
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
  if (/squareup(sandbox)?\.com/.test(url)) {
    if (!url.endsWith("/v2/orders/search")) throw new Error(`FIXTURE: unexpected Square call ${url}`)
    squareSearches += 1
    const body = JSON.parse(String(init?.body ?? "{}")) as { cursor?: string }
    const page = body.cursor ? pages[Number(body.cursor)] : pages[0]
    return new Response(JSON.stringify(page), { status: 200, headers: { "Content-Type": "application/json" } })
  }
  return realFetch(input, init)
}) as typeof fetch

// The timing line is BUG-20's; silence it so this output stays readable.
const realLog = console.log
const quiet = <T>(fn: () => Promise<T>) => {
  console.log = () => {}
  return fn().finally(() => {
    console.log = realLog
  })
}

type Mod = { catalog_object_id?: string; quantity?: string }
function order(id: string, createdAt: string, lines: { variation?: string; qty: string; mods: Mod[] }[], extra: Record<string, unknown> = {}) {
  return {
    id,
    created_at: createdAt,
    state: "COMPLETED",
    tenders: [{ id: `t-${id}` }],
    total_money: { amount: 1000, currency: "USD" },
    total_tax_money: { amount: 0, currency: "USD" },
    total_tip_money: { amount: 0, currency: "USD" },
    total_discount_money: { amount: 0, currency: "USD" },
    line_items: lines.map((l) => ({
      ...(l.variation ? { catalog_object_id: l.variation } : {}),
      quantity: l.qty,
      gross_sales_money: { amount: 500 },
      modifiers: l.mods,
    })),
    ...extra,
  }
}

async function main() {
  const tag = Math.random().toString(36).slice(2, 8)
  const [{ branch }] = await prisma.$queryRaw<{ branch: string | null }[]>`SELECT current_setting('neon.branch_id', true) AS branch`
  const today = localDateStr(new Date(), TZ)
  const minus = (n: number) => {
    const d = new Date(`${today}T00:00:00.000Z`)
    d.setUTCDate(d.getUTCDate() - n)
    return d.toISOString().slice(0, 10)
  }
  const noon = (dateStr: string) => new Date(`${dateStr}T20:00:00.000Z`).toISOString()

  const org = await prisma.organization.create({
    data: {
      clerkOrgId: `fixture-n5b-${tag}`,
      name: "ZZ N-5b Fixture Org (safe to delete)",
      activeModules: ["inventory"],
      squareAccessToken: `fixture-n5b-not-a-token-${tag}`,
    },
  })
  const store = await prisma.store.create({
    data: { organizationId: org.id, name: "ZZ N-5b Fixture Store", timezone: TZ, squareLocationId: `FIXTURE-N5B-${tag}` },
  })
  realLog(`neon.branch_id = ${branch ?? "null"} · fixture org ${org.id} · store ${store.id} · today ${today} (${TZ})\n`)

  try {
    // ── Catalog + recipes ──
    const ing = (name: string) =>
      prisma.ingredient.create({
        data: {
          organizationId: org.id, name: `N-5b ${name}`, purchaseUnitLabel: "case", purchaseCost: 10,
          reportingUnit: OZ, unitsPerPurchase: 10, costPerReportingUnit: 1,
        },
      })
    const whey = await ing("Whey")
    const banana = await ing("Banana")
    const item = await prisma.salesItem.create({
      data: { organizationId: org.id, squareItemId: "N5B-ITEM", squareVariationId: "N5B-VAR", name: "N-5b Smoothie", variationName: "Regular", displayName: "N-5b Smoothie" },
    })
    await prisma.recipe.create({
      data: { organizationId: org.id, name: "N-5b Smoothie", salesItemId: item.id, lines: { create: [{ ingredientId: banana.id, amount: 4, unit: OZ }] } },
    })
    const list = await prisma.squareModifierList.create({ data: { organizationId: org.id, squareModifierListId: "N5B-LIST", name: "N-5b Boosts" } })
    const mod = (squareModifierId: string, name: string, extra: { onByDefault?: boolean; recipeStatus?: string } = {}) =>
      prisma.squareModifier.create({ data: { organizationId: org.id, squareModifierId, modifierListId: list.id, name, ...extra } })
    const mWhey = await mod("N5B-WHEY", "Whey boost", { recipeStatus: "MAPPED" })
    const mNoBan = await mod("N5B-NOBAN", "No Banana", { recipeStatus: "MAPPED" })
    const mDefault = await mod("N5B-DEFON", "Base blend", { onByDefault: true, recipeStatus: "MAPPED" })
    const mZero = await mod("N5B-ZERO", "Extra whey (removed)", { recipeStatus: "MAPPED" })
    await mod("N5B-UNMAPPED", "Chia")
    await mod("N5B-NONREC", "Light ice", { recipeStatus: "NON_RECIPE" })
    const modRecipe = (m: { id: string; name: string }, ingredientId: string, amount: number) =>
      prisma.recipe.create({ data: { organizationId: org.id, name: `N-5b ${m.name}`, squareModifierId: m.id, lines: { create: [{ ingredientId, amount, unit: OZ }] } } })
    await modRecipe(mWhey, whey.id, 1)
    await modRecipe(mNoBan, banana.id, -1.6)
    await modRecipe(mDefault, whey.id, 10) // R5: must never count
    await modRecipe(mZero, whey.id, 100) // quantity 0: must never count

    // ── The day's orders ──
    const dayOrders = [
      // 2 cups: whey ×1, No Banana ×1, default-on ×1, Chia (no recipe), a
      // modifier never synced, Light ice (NON_RECIPE), a removed add-on (qty 0)
      order("o1", noon(today), [
        {
          variation: "N5B-VAR", qty: "2",
          mods: [
            { catalog_object_id: "N5B-WHEY", quantity: "1" },
            { catalog_object_id: "N5B-NOBAN", quantity: "1" },
            { catalog_object_id: "N5B-DEFON", quantity: "1" },
            { catalog_object_id: "N5B-UNMAPPED", quantity: "1" },
            { catalog_object_id: "N5B-NOTSYNCED", quantity: "1" },
            { catalog_object_id: "N5B-NONREC", quantity: "1" },
            { catalog_object_id: "N5B-ZERO", quantity: "0" },
          ],
        },
      ]),
      // 1 cup, whey with NO quantity field (R4 → 1)
      order("o2", noon(today), [{ variation: "N5B-VAR", qty: "1", mods: [{ catalog_object_id: "N5B-WHEY" }] }]),
      // a custom-amount line (no catalog id) carrying whey ×2
      order("o3", noon(today), [{ qty: "1", mods: [{ catalog_object_id: "N5B-WHEY", quantity: "2" }] }]),
      // R2: a paid order carrying a return of 5 whey boosts — never read
      order("o4", noon(today), [], {
        returns: [{ return_line_items: [{ catalog_object_id: "N5B-VAR", quantity: "1", return_modifiers: [{ catalog_object_id: "N5B-WHEY", quantity: "5" }] }] }],
      }),
    ]
    pages = [{ orders: dayOrders }]

    const rowsToday = async () =>
      (await prisma.salesModifierCache.findMany({ where: { storeId: store.id, date: dbDate(today) }, orderBy: { squareModifierId: "asc" } })).map(
        (r) => `${r.squareModifierId}=${r.quantity}`
      )
    const usageToday = async (mode: "theoretical" | "consumption" = "theoretical") =>
      modifierUsageForWindow(org.id, store.id, today, today, await loadCostGraph(org.id), mode)
    const usageSig = (u: Awaited<ReturnType<typeof usageToday>>) =>
      JSON.stringify([[...u.usage.entries()].sort(), u.unmappedModifierSoldCount, u.modifierDataMissingDays])

    squareSearches = 0
    await quiet(() => syncSalesForStore(org, store, today, today, "fixture/n5b:first"))
    check("stub: one orders search, no other Square call", squareSearches === 1, `${squareSearches}`)
    const first = await rowsToday()
    const qty = (id: string) => {
      const r = first.find((x) => x.startsWith(`${id}=`))
      return r ? Number(r.split("=")[1]) : undefined
    }
    check("M1 add-on × cup count: whey on 2 cups + 1 cup + custom line ×2 = 5", near(qty("N5B-WHEY"), 5), String(qty("N5B-WHEY")))
    check("M1 a removal on a 2-cup line counts twice (No Banana = 2)", near(qty("N5B-NOBAN"), 2), String(qty("N5B-NOBAN")))
    check("M2 a missing modifier quantity counts as 1 (o2's whey is in the 5)", near(qty("N5B-WHEY"), 5))
    check("M3 quantity 0 writes no row", qty("N5B-ZERO") === undefined, first.join(" "))
    check("M4 a custom-amount line's add-on still counts (o3's 2 whey are in the 5)", near(qty("N5B-WHEY"), 5))
    check("M5 returns[] is never read (whey is 5, not 0 and not 10)", near(qty("N5B-WHEY"), 5))
    check(
      "M1 raw rows kept for every sold modifier, mapped or not (6 rows)",
      JSON.stringify(first) ===
        JSON.stringify(["N5B-DEFON=2", "N5B-NOBAN=2", "N5B-NONREC=2", "N5B-NOTSYNCED=2", "N5B-UNMAPPED=2", "N5B-WHEY=5"]),
      first.join(" ")
    )
    const period = await prisma.salesPeriodCache.findUnique({ where: { storeId_date: { storeId: store.id, date: dbDate(today) } } })
    check("M1 the day is marked modifiersCaptured", period?.modifiersCaptured === true)
    const lineRow = await prisma.salesLineCache.findFirst({ where: { storeId: store.id, date: dbDate(today), squareVariationId: "N5B-VAR" } })
    check("item line totals unchanged by N-5b (3 smoothies)", near(lineRow?.quantitySold, 3), String(lineRow?.quantitySold))

    const u1 = await usageToday()
    check("U1 whey boost adds whey: 5 × 1 oz = 5 oz", near(u1.usage.get(whey.id), 5), String(u1.usage.get(whey.id)))
    check("U1 No Banana subtracts: 2 × −1.6 oz = −3.2 oz", near(u1.usage.get(banana.id), -3.2), String(u1.usage.get(banana.id)))
    check(
      "U1 contributions name the add-on, its sold qty and signed effect (variance hover)",
      JSON.stringify(u1.contributions.get(banana.id)) === JSON.stringify([{ squareModifierId: "N5B-NOBAN", name: "No Banana", qtySold: 2, qty: -3.2 }]),
      JSON.stringify(u1.contributions.get(banana.id))
    )
    check("U2 no-recipe add-ons skipped and counted: Chia + never-synced = 2; Light ice not counted", u1.unmappedModifierSoldCount === 2, String(u1.unmappedModifierSoldCount))
    check("U3 on-by-default add-on skipped despite its recipe (whey not 25)", near(u1.usage.get(whey.id), 5))
    check("U3 quantity-0 add-on contributes nothing (whey not 105)", near(u1.usage.get(whey.id), 5))
    check("U1 consumption mode gives the same numbers for raw ingredients", usageSig(await usageToday("consumption")) === usageSig(u1))
    check("U4 a fully post-N-5b window reports 0 days without add-on data", u1.modifierDataMissingDays === 0)

    // ── M6: three identical syncs ──
    const baseRows = JSON.stringify(first)
    const baseUsage = usageSig(u1)
    for (let i = 2; i <= 3; i++) {
      await quiet(() => syncSalesForStore(org, store, today, today, `fixture/n5b:repeat-${i}`))
      check(`M6 sequential sync ${i}: identical rows`, JSON.stringify(await rowsToday()) === baseRows)
      check(`M6 sequential sync ${i}: identical usage`, usageSig(await usageToday()) === baseUsage)
    }
    squareSearches = 0
    const burst = await quiet(() =>
      Promise.all([1, 2, 3].map((i) => syncSalesForStore(org, store, today, today, `fixture/n5b:burst-${i}`)))
    )
    check("M6 burst: three concurrent syncs all read Square", squareSearches === 3, `${squareSearches}`)
    check(
      "M6 burst: every sync either wrote the day or was discarded as superseded; at least one wrote",
      burst.reduce((s, r) => s + r.days, 0) >= 1 && burst.every((r) => r.days + r.discardedDays === 1),
      JSON.stringify(burst.map((r) => [r.days, r.discardedDays]))
    )
    check("M6 burst: identical rows (no append)", JSON.stringify(await rowsToday()) === baseRows, (await rowsToday()).join(" "))
    check("M6 burst: identical usage", usageSig(await usageToday()) === baseUsage)
    const total = await prisma.salesModifierCache.aggregate({ where: { storeId: store.id }, _sum: { quantity: true }, _count: true })
    check("M6 after 6 syncs the store holds 6 rows totalling 15", total._count === 6 && near(total._sum.quantity ?? undefined, 15), `${total._count} rows, Σ ${total._sum.quantity}`)

    // ── M7: Light ice drops out of the day on re-read ──
    pages = [{ orders: dayOrders.map((o) => ({ ...o, line_items: o.line_items.map((l) => ({ ...l, modifiers: l.modifiers.filter((m) => m.catalog_object_id !== "N5B-NONREC") })) })) }]
    await quiet(() => syncSalesForStore(org, store, today, today, "fixture/n5b:edited"))
    check("M7 a modifier gone from the re-read loses its row", !(await rowsToday()).some((r) => r.startsWith("N5B-NONREC=")))
    pages = [{ orders: dayOrders }]
    await quiet(() => syncSalesForStore(org, store, today, today, "fixture/n5b:restore"))

    // ── U4: days with no add-on data ──
    // A row as it stood before the migration (column default false)…
    await prisma.salesPeriodCache.create({ data: { organizationId: org.id, storeId: store.id, date: dbDate(minus(2)), netSales: 1, orderCount: 1 } })
    // …and a writer that read no modifiers (byModifier omitted).
    const old = new Date(Date.now() - 60_000)
    await writeSalesCache(org, store, old, [minus(1)], new Map([[minus(1), { ...emptyDayAgg(), net: 1, orders: 1 }]]), new Map(), new Map())
    const flags = await prisma.salesPeriodCache.findMany({ where: { storeId: store.id }, orderBy: { date: "asc" }, select: { date: true, modifiersCaptured: true } })
    check(
      "U4 pre-N-5b rows read modifiersCaptured=false; the N-5b day reads true",
      JSON.stringify(flags.map((f) => f.modifiersCaptured)) === JSON.stringify([false, false, true]),
      JSON.stringify(flags.map((f) => [f.date.toISOString().slice(0, 10), f.modifiersCaptured]))
    )
    const u4 = await modifierUsageForWindow(org.id, store.id, minus(2), today, await loadCostGraph(org.id), "theoretical")
    check("U4 the window says 2 days have no add-on data", u4.modifierDataMissingDays === 2, String(u4.modifierDataMissingDays))

    // ── U5: the consumer path — weekly usage, sales basis (no counts exist) ──
    pages = [{ orders: [] }] // gap-fill of the other 25 days of the 28-day lookback: no sales
    const weekly = await quiet(() => computeWeeklyUsage(org, store))
    // 28 cached days; whey 5 oz; banana = 3 smoothies × 4 oz − 3.2 oz = 8.8 oz.
    check("U5 weekly usage is sales-based", weekly.basis === "sales", weekly.basis)
    check("U5 weekly usage includes add-on whey: 5/28 × 7 = 1.25 oz/wk", near(weekly.usage.get(whey.id), 1.25), String(weekly.usage.get(whey.id)))
    check("U5 weekly usage nets the removal: (12 − 3.2)/28 × 7 = 2.2 oz/wk", near(weekly.usage.get(banana.id), 2.2), String(weekly.usage.get(banana.id)))

    // ── S1: wiring and migration ──
    const src = (p: string) => readFileSync(p, "utf8")
    check(
      "S1 salesUsageForWindow (expected, weekly usage, alerts, order guide) calls the helper in consumption mode",
      /modifierUsageForWindow\(org\.id, storeId, start, end, graph, "consumption"\)/.test(src("src/lib/expected-inventory.ts"))
    )
    check(
      "S1 the variance report calls the helper in theoretical mode and returns both counts",
      /modifierUsageForWindow\([^)]*"theoretical"\)/.test(src("src/app/api/inventory/reports/variance/route.ts")) &&
        /unmappedModifierSoldCount: mods\.unmappedModifierSoldCount/.test(src("src/app/api/inventory/reports/variance/route.ts")) &&
        /modifierDataMissingDays: mods\.modifierDataMissingDays/.test(src("src/app/api/inventory/reports/variance/route.ts"))
    )
    const migration = src("prisma/migrations_archive/20261104010000_n5b_sales_modifier_cache/migration.sql")
    check("S1 the migration is additive only", !/DROP (COLUMN|TABLE|CONSTRAINT|INDEX)/i.test(migration) && !/ALTER COLUMN/i.test(migration))
  } finally {
    await prisma.salesModifierCache.deleteMany({ where: { storeId: store.id } })
    await prisma.salesHourlyCache.deleteMany({ where: { storeId: store.id } })
    await prisma.salesLineCache.deleteMany({ where: { storeId: store.id } })
    await prisma.salesPeriodCache.deleteMany({ where: { storeId: store.id } })
    await prisma.recipe.deleteMany({ where: { organizationId: org.id } })
    await prisma.squareModifier.deleteMany({ where: { organizationId: org.id } })
    await prisma.squareModifierList.deleteMany({ where: { organizationId: org.id } })
    await prisma.salesItem.deleteMany({ where: { organizationId: org.id } })
    await prisma.ingredient.deleteMany({ where: { organizationId: org.id } })
    await prisma.store.deleteMany({ where: { organizationId: org.id } })
    await prisma.organization.delete({ where: { id: org.id } })
    realLog("\nFixture org + store deleted.")
  }

  if (failures > 0) {
    console.error(`\nN-5b: ${failures} check(s) FAILED, ${passes} passed`)
    process.exit(1)
  }
  realLog(`\nN-5b: all ${passes} checks passed.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
