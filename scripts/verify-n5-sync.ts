/**
 * N-5-SYNC — the Square catalog sync, batched (it timed out at 60 s on staging).
 *
 *   npx tsx scripts/verify-n5-sync.ts
 *
 * Prompt: docs/prompts/N-5-SYNC.md. Rulings (Gary, 2026-11-03, "Go as
 * planned"): R1 unchanged rows are not written, so their updatedAt stays put;
 * R2 changed modifier rows are batch-updated too.
 *
 * TWO PARTS.
 *   1–2 PURE: the mapper's duplicate rule, the planner, and source checks on
 *       the route.
 *   3–4 DATABASE: against the database in local .env (dev), inside ONE
 *       transaction that is ALWAYS rolled back. A canned catalog of 1,200+
 *       variations is synced through the NEW writer, and the rows are compared
 *       with a transcription of the OLD route's per-row upsert loop run in
 *       memory on the same inputs — first sync, a changed catalog (prices,
 *       names, category moves, a renamed and a vanished category, removed and
 *       new items), an unchanged re-run, items coming back, and an empty
 *       catalog. Every database call the writers make is counted.
 *       The branch is printed from `neon.branch_id`, never typed.
 *
 * WHAT THIS CAN DETECT: the batched writer storing different rows from the old
 * loop; an unchanged row being written; a duplicate variation or a category
 * missing from the run handled differently; a sweep that changed; modifier
 * batch updates writing the wrong values; the write count growing with the
 * catalog instead of with the chunk count.
 *
 * WHAT IT CANNOT DETECT: a real Square payload, the route's HTTP shape and
 * gates, and the time on Vercel (iad1 → us-west-2). That is Gary's staging
 * pass: Sync from Square completes, with the duration from the Vercel log.
 */
import "dotenv/config"
import { readFileSync } from "node:fs"
import type { Prisma } from "@prisma/client"
import { prisma } from "../src/lib/prisma"
import {
  mapCatalogCategories,
  mapCatalogItems,
  planSalesItemWrites,
  writeSalesItemCatalogIn,
  type SquareCatalogObject,
} from "../src/lib/square-catalog-sync"
import { mapModifierCatalog, writeModifierCatalogIn, type SquareModifierListObject } from "../src/lib/square-modifier-sync"

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  const show = (x: unknown) => {
    const s = JSON.stringify(x)
    return s && s.length > 400 ? `${s.slice(0, 400)}…` : s
  }
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `\n    expected ${show(expected)}\n    actual   ${show(actual)}`}`)
}

// ─── Canned catalog ──────────────────────────────────────────────────────────
const cat = (id: string, name: string): SquareCatalogObject => ({ id, type: "CATEGORY", category_data: { name } })
const pad = (n: number) => String(n).padStart(4, "0")
type ItemSpec = { i: number; name?: string; category?: string | null; price?: (v: number) => number | null }
function item({ i, name, category, price }: ItemSpec): SquareCatalogObject {
  const c = category === undefined ? (i % 50 === 0 ? null : i % 37 === 0 ? "C-MISSING" : `C${i % 20}`) : category
  const sizes = ["Small", "Medium", "Large"]
  return {
    id: `ITEM-${pad(i)}`,
    type: "ITEM",
    item_data: {
      name: name ?? `N5S Item ${pad(i)}`,
      // Both shapes Square uses: categories[] on even items, category_id on odd.
      ...(c === null ? {} : i % 2 === 0 ? { categories: [{ id: c }] } : { category_id: c }),
      variations: sizes.map((s, v) => ({
        id: `VAR-${pad(i)}-${v}`,
        item_variation_data: {
          // Variation 2 of every 11th item has no name → "Regular".
          ...(i % 11 === 0 && v === 2 ? {} : { name: s }),
          ...((price ? price(v) : i % 13 === 0 && v === 0 ? null : 300 + i + v * 100) === null
            ? {}
            : { price_money: { amount: (price ? price(v) : 300 + i + v * 100)! } }),
        },
      })),
    },
  }
}
const CATS_A = Array.from({ length: 20 }, (_, k) => cat(`C${k}`, `N5S Category ${k}`))
const ITEMS_A = Array.from({ length: 400 }, (_, i) => item({ i }))
// A variation listed under two items: the old loop created it from the first
// and updated it from the second.
const DUP: SquareCatalogObject = {
  id: "ITEM-DUP", type: "ITEM",
  item_data: { name: "N5S Duplicate Holder", category_id: "C3", variations: [{ id: "VAR-0001-0", item_variation_data: { name: "Dup", price_money: { amount: 999 } } }] },
}
const CATALOG_A = { categories: CATS_A, items: [...ITEMS_A, DUP] }

// B: prices on items 0–99, names on 100–104, category moves on 105–124,
// items 300–329 gone, 10 new items, C5 renamed, C19 gone (its items keep
// pointing at it → category null, as the old loop did).
const CATS_B = CATS_A.filter((c) => c.id !== "C19").map((c) => (c.id === "C5" ? cat("C5", "N5S Category 5 renamed") : c))
const ITEMS_B = [
  ...ITEMS_A.filter((o, i) => i < 300 || i >= 330).map((o) => {
    const i = Number(o.id.slice(5))
    if (i < 100) return item({ i, price: (v) => 1000 + i + v })
    if (i < 105) return item({ i, name: `N5S Item ${pad(i)} renamed` })
    if (i < 125) return item({ i, category: `C${(i + 1) % 18}` })
    return o
  }),
  ...Array.from({ length: 10 }, (_, k) => item({ i: 400 + k })),
]
const CATALOG_B = { categories: CATS_B, items: ITEMS_B }

// ─── The OLD route, transcribed (per-row upsert semantics, in memory) ────────
type SimCat = { name: string; isDeleted: boolean }
type SimItem = {
  squareItemId: string; name: string; variationName: string; displayName: string
  category: string | null // Square category id of the linked row
  menuGroup: string | null; priceCents: number | null; isDeleted: boolean; recipeStatus: string
}
type Sim = { cats: Map<string, SimCat>; items: Map<string, SimItem> }
function oldSync(sim: Sim, categoryObjects: SquareCatalogObject[], itemObjects: SquareCatalogObject[]) {
  const categoryIdMap = new Map<string, string>()
  const categoryNameMap = new Map<string, string>()
  for (const obj of categoryObjects) {
    const name = obj.category_data?.name ?? "Unnamed Category"
    sim.cats.set(obj.id, { name, isDeleted: !!obj.is_deleted })
    categoryIdMap.set(obj.id, obj.id)
    categoryNameMap.set(obj.id, name)
  }
  const seenVariationIds: string[] = []
  for (const obj of itemObjects) {
    const itemData = obj.item_data ?? {}
    const squareCategoryId = itemData.categories?.[0]?.id ?? itemData.category_id ?? null
    const categoryId = squareCategoryId ? (categoryIdMap.get(squareCategoryId) ?? null) : null
    const menuGroup = squareCategoryId ? (categoryNameMap.get(squareCategoryId) ?? null) : null
    const itemName = itemData.name ?? "Unnamed Item"
    for (const v of itemData.variations ?? []) {
      const vd = v.item_variation_data ?? {}
      const variationName = vd.name ?? "Regular"
      seenVariationIds.push(v.id)
      const fields = {
        name: itemName, variationName, displayName: `${itemName} (${variationName})`,
        category: categoryId, menuGroup, priceCents: vd.price_money?.amount ?? null, isDeleted: !!obj.is_deleted,
      }
      const existing = sim.items.get(v.id)
      if (existing) Object.assign(existing, fields)
      else sim.items.set(v.id, { squareItemId: obj.id, recipeStatus: "UNMAPPED", ...fields })
    }
  }
  const seenCategoryIds = [...categoryIdMap.keys()]
  for (const [id, c] of sim.cats) if (!c.isDeleted && (seenCategoryIds.length === 0 || !seenCategoryIds.includes(id))) c.isDeleted = true
  const seen = new Set(seenVariationIds)
  for (const [id, r] of sim.items) if (!r.isDeleted && (seenVariationIds.length === 0 || !seen.has(id))) r.isDeleted = true
}
const simRows = (sim: Sim) =>
  [...sim.items.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, r]) => [id, r.squareItemId, r.name, r.variationName, r.displayName, r.category, r.menuGroup, r.priceCents, r.isDeleted, r.recipeStatus])
const simCats = (sim: Sim) => [...sim.cats.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, c]) => [id, c.name, c.isDeleted])

// ─── 1. Pure ─────────────────────────────────────────────────────────────────
{
  const cats = mapCatalogCategories(CATS_A)
  const ids = new Map([...cats.keys()].map((k) => [k, `row-${k}`]))
  const { rows, seenVariationIds } = mapCatalogItems(CATALOG_A.items, cats, ids)
  const dup = rows.find((r) => r.squareVariationId === "VAR-0001-0")!
  check("1a. duplicate variation: FIRST item's squareItemId, LAST occurrence's fields", [dup.squareItemId, dup.name, dup.variationName, dup.priceCents, dup.squareCategoryId], ["ITEM-0001", "N5S Duplicate Holder", "Dup", 999, "row-C3"])
  check("1b. seenVariationIds keeps the duplicate (the route's salesItems count)", [rows.length, seenVariationIds.length], [1200, 1201])
  const missing = rows.find((r) => r.squareVariationId === "VAR-0074-0")! // 74 = 2 × 37
  check("1c. a category missing from this run → no category, no menu group", [missing.squareCategoryId, missing.menuGroup], [null, null])
  const existing = rows.map((r, k) => ({ id: `si-${k}`, ...r }))
  const same = planSalesItemWrites(existing, rows)
  check("1d. planner: everything already matches → nothing to write", [same.creates.length, same.updates.length, same.unchanged], [0, 0, 1200])
  const one = planSalesItemWrites(existing.map((r) => (r.squareVariationId === "VAR-0002-1" ? { ...r, priceCents: 1 } : r)), rows)
  check("1e. planner: one changed price → exactly one update, carrying the row id", [one.updates.length, one.updates[0]?.id], [1, existing.find((r) => r.squareVariationId === "VAR-0002-1")!.id])
}

// ─── 2. Source checks on the route ───────────────────────────────────────────
{
  const route = readFileSync("src/app/api/square/sales-items/sync/route.ts", "utf8")
  check("2a. maxDuration = 300", /export const maxDuration = 300\b/.test(route), true)
  const iItems = route.indexOf("writeSalesItemCatalogIn(")
  const iMods = route.indexOf("writeModifierCatalog(")
  const iStamp = route.indexOf("lastCatalogSyncAt")
  check("2b. items (and their sweeps) → modifiers → lastCatalogSyncAt, in that order", [iItems > 0, iMods > iItems, iStamp > iMods], [true, true, true])
  check("2c. no per-row upsert left in the route", /\.upsert\(/.test(route), false)
  check("2d. still asks Square for ITEM, CATEGORY, MODIFIER_LIST", /types", "ITEM,CATEGORY,MODIFIER_LIST"/.test(route), true)
}

// ─── 3–4. Against the database (dev), rolled back ────────────────────────────
type Calls = Record<string, number>
function counted(tx: Prisma.TransactionClient, calls: Calls): Prisma.TransactionClient {
  return new Proxy(tx, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof prop !== "string") return value
      if (prop.startsWith("$executeRaw")) {
        return (...args: unknown[]) => {
          calls[prop] = (calls[prop] ?? 0) + 1
          return (value as (...a: unknown[]) => unknown).apply(target, args)
        }
      }
      if (value && typeof value === "object" && "findMany" in (value as object)) {
        return new Proxy(value as object, {
          get(d, m, r) {
            const fn = Reflect.get(d, m, r)
            if (typeof fn !== "function" || typeof m !== "string") return fn
            return (...args: unknown[]) => {
              const k = `${prop}.${m}`
              calls[k] = (calls[k] ?? 0) + 1
              return (fn as (...a: unknown[]) => unknown).apply(d, args)
            }
          },
        })
      }
      return value
    },
  }) as Prisma.TransactionClient
}
const total = (c: Calls) => Object.values(c).reduce((a, b) => a + b, 0)

class Rollback extends Error {}
async function dbPart() {
  const [{ branch }] = await prisma.$queryRaw<{ branch: string | null }[]>`SELECT current_setting('neon.branch_id', true) AS branch`
  console.log(`  (database part on neon.branch_id = ${branch ?? "null"})`)
  try {
    await prisma.$transaction(
      async (tx) => {
        const org = await tx.organization.create({ data: { clerkOrgId: `n5-sync-fixture-${Date.now()}`, name: "N-5-SYNC Fixture Org" } })
        const sim: Sim = { cats: new Map(), items: new Map() }

        const dbRows = async () => {
          const cats = new Map((await tx.squareCategory.findMany({ where: { organizationId: org.id } })).map((c) => [c.id, c.squareCategoryId]))
          const rows = await tx.salesItem.findMany({ where: { organizationId: org.id }, orderBy: { squareVariationId: "asc" } })
          return rows.map((r) => [r.squareVariationId, r.squareItemId, r.name, r.variationName, r.displayName, r.squareCategoryId ? cats.get(r.squareCategoryId)! : null, r.menuGroup, r.priceCents, r.isDeleted, r.recipeStatus])
        }
        const dbCats = async () =>
          (await tx.squareCategory.findMany({ where: { organizationId: org.id }, orderBy: { squareCategoryId: "asc" } })).map((c) => [c.squareCategoryId, c.name, c.isDeleted])
        const stamps = async () => new Map((await tx.salesItem.findMany({ where: { organizationId: org.id }, select: { squareVariationId: true, updatedAt: true } })).map((r) => [r.squareVariationId, r.updatedAt.getTime()]))
        const run = async (label: string, catalog: { categories: SquareCatalogObject[]; items: SquareCatalogObject[] }) => {
          const calls: Calls = {}
          const t0 = Date.now()
          const counts = await writeSalesItemCatalogIn(counted(tx, calls), org.id, catalog.categories, catalog.items)
          const ms = Date.now() - t0
          oldSync(sim, catalog.categories, catalog.items)
          check(`${label}: sales items identical to the old loop's (${sim.items.size} rows)`, await dbRows(), simRows(sim))
          check(`${label}: categories identical to the old loop's`, await dbCats(), simCats(sim))
          console.log(`    ${label}: ${total(calls)} database calls ${JSON.stringify(calls)}, ${ms} ms (local → dev)`)
          return { counts, calls }
        }

        // 3a. First sync — every row new.
        const a = await run("3a. first sync", CATALOG_A)
        check("3a. counts: 1,200 created, 0 updated; 20 categories created", [a.counts.itemsCreated, a.counts.itemsUpdated, a.counts.categoriesCreated, a.counts.salesItems], [1200, 0, 20, 1201])
        check("3a. 1,200 rows in 6 createMany calls, no per-row writes", [a.calls["salesItem.createMany"], a.calls["salesItem.upsert"] ?? 0, a.calls["salesItem.update"] ?? 0], [6, 0, 0])

        // Froot-side state the sync must never touch.
        const mappedIds = ["VAR-0000-0", "VAR-0310-1", "VAR-0150-2"]
        await tx.salesItem.updateMany({ where: { organizationId: org.id, squareVariationId: { in: mappedIds } }, data: { recipeStatus: "MAPPED" } })
        for (const id of mappedIds) sim.items.get(id)!.recipeStatus = "MAPPED"

        // 3b. Changed catalog.
        const before = await stamps()
        const simBefore = new Map([...sim.items].map(([k, v]) => [k, JSON.stringify({ ...v, recipeStatus: "" })]))
        await new Promise((r) => setTimeout(r, 20))
        const b = await run("3b. changed catalog", CATALOG_B)
        const after = await stamps()
        const fieldChanged = [...sim.items].filter(([k, v]) => simBefore.has(k) && simBefore.get(k) !== JSON.stringify({ ...v, recipeStatus: "" })).map(([k]) => k)
        const swept = new Set([...sim.items].filter(([k, v]) => v.isDeleted && simBefore.has(k) && !JSON.parse(simBefore.get(k)!).isDeleted).map(([k]) => k))
        const created = [...sim.items.keys()].filter((k) => !simBefore.has(k))
        check("3b. updates = rows whose synced fields changed and were seen (not swept)", b.counts.itemsUpdated, fieldChanged.filter((k) => !swept.has(k)).length)
        check("3b. creates = the 30 new variations", [b.counts.itemsCreated, created.length], [30, 30])
        check(
          "3b. updatedAt moved ONLY on changed or swept rows (R1)",
          [...before.keys()].filter((k) => before.get(k) !== after.get(k)).sort(),
          [...new Set([...fieldChanged])].sort()
        )
        check("3b. updates went in ≤200-row batches", b.calls["$executeRaw"], Math.ceil(b.counts.itemsUpdated / 200))
        check("3b. a renamed category and a vanished one", [b.counts.categoriesUpdated, sim.cats.get("C19")!.isDeleted], [1, true])

        // 3c. Same catalog again — nothing to write.
        const before2 = await stamps()
        const c = await run("3c. unchanged re-run", CATALOG_B)
        const after2 = await stamps()
        check("3c. counts: nothing created or updated", [c.counts.itemsCreated, c.counts.itemsUpdated, c.counts.categoriesCreated, c.counts.categoriesUpdated], [0, 0, 0, 0])
        check("3c. calls: two reads and the two sweeps, nothing else", c.calls, { "squareCategory.findMany": 1, "salesItem.findMany": 1, "squareCategory.updateMany": 1, "salesItem.updateMany": 1 })
        check("3c. no updatedAt moved", [...before2.keys()].filter((k) => before2.get(k) !== after2.get(k)), [])

        // 3d. Catalog A again — vanished items and C19 come back.
        await run("3d. items come back", CATALOG_A)
        check("3d. MAPPED recipeStatus survived every sync", (await tx.salesItem.findMany({ where: { organizationId: org.id, recipeStatus: "MAPPED" }, select: { squareVariationId: true }, orderBy: { squareVariationId: "asc" } })).map((r) => r.squareVariationId), [...mappedIds].sort())

        // 3e. Empty catalog — the old sweep marks everything deleted.
        await run("3e. empty catalog", { categories: [], items: [] })

        // 4. Modifiers (R2): 30 lists × 10 modifiers.
        const lists: SquareModifierListObject[] = Array.from({ length: 30 }, (_, l) => ({
          id: `ML-${l}`, type: "MODIFIER_LIST",
          modifier_list_data: { name: `N5S List ${l}`, ordinal: l, modifiers: Array.from({ length: 10 }, (_, m) => ({ id: `MOD-${l}-${m}`, type: "MODIFIER", modifier_data: { name: `N5S Mod ${l}-${m}`, ordinal: m, price_money: { amount: 50 + m } } })) },
        }))
        const items = ITEMS_A.slice(0, 60).map((o, k) => ({ id: o.id, item_data: { modifier_list_info: [{ modifier_list_id: `ML-${k % 30}` }] } }))
        const m1 = mapModifierCatalog(lists, [], items)
        await writeModifierCatalogIn(tx, org.id, m1)
        const callsSame: Calls = {}
        await writeModifierCatalogIn(counted(tx, callsSame), org.id, m1)
        check("4a. unchanged modifier re-sync: no update of any kind", [callsSame["$executeRaw"] ?? 0, callsSame["squareModifier.update"] ?? 0, callsSame["squareModifierList.update"] ?? 0], [0, 0, 0])
        const repriced = lists.map((l, i) => ({
          ...l,
          modifier_list_data: { ...l.modifier_list_data!, name: i < 5 ? `${l.modifier_list_data!.name} v2` : l.modifier_list_data!.name, modifiers: l.modifier_list_data!.modifiers!.map((m) => ({ ...m, modifier_data: { ...m.modifier_data!, price_money: { amount: 500 } } })) },
        }))
        const callsPrice: Calls = {}
        const m2 = mapModifierCatalog(repriced, [], items)
        await writeModifierCatalogIn(counted(tx, callsPrice), org.id, m2)
        check("4b. 300 repriced modifiers + 5 renamed lists: 3 batch updates, no per-row update", [callsPrice["$executeRaw"], callsPrice["squareModifier.update"] ?? 0, callsPrice["squareModifierList.update"] ?? 0], [3, 0, 0])
        const mods = await tx.squareModifier.findMany({ where: { organizationId: org.id }, include: { modifierList: true } })
        check("4c. every modifier now 500 cents, list names as mapped", [mods.length, mods.every((m) => m.priceCents === 500), mods.filter((m) => m.modifierList.name.endsWith(" v2")).length], [300, true, 50])
        // A modifier that moves list and comes back from deleted, through the batch path.
        const target = mods.find((m) => m.squareModifierId === "MOD-0-0")!
        await tx.squareModifier.update({ where: { id: target.id }, data: { isDeleted: true } })
        const moved = mapModifierCatalog(repriced, [{ id: "MOD-0-0", type: "MODIFIER", modifier_data: { modifier_list_id: "ML-1", name: "N5S Moved", price_money: { amount: 500 }, ordinal: 0 } }], items)
        moved.modifiers = moved.modifiers.map((m) => (m.squareModifierId === "MOD-0-0" ? { ...m, squareModifierListId: "ML-1", name: "N5S Moved" } : m))
        await writeModifierCatalogIn(tx, org.id, moved)
        const back = await tx.squareModifier.findUnique({ where: { id: target.id }, include: { modifierList: true } })
        check("4d. batch path un-deletes and moves a modifier", [back?.isDeleted, back?.modifierList.squareModifierListId, back?.name], [false, "ML-1", "N5S Moved"])

        throw new Rollback()
      },
      { timeout: 600_000, maxWait: 20_000 }
    )
  } catch (e) {
    if (!(e instanceof Rollback)) throw e
  }
  const leaked = await prisma.organization.count({ where: { name: "N-5-SYNC Fixture Org" } })
  check("5. rolled back: no fixture rows left behind", leaked, 0)
}

dbPart()
  .catch((e) => {
    failures++
    console.log(`✗ database part threw: ${e instanceof Error ? e.stack : e}`)
  })
  .finally(async () => {
    await prisma.$disconnect()
    console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`)
    process.exit(failures === 0 ? 0 : 1)
  })
