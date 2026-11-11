import { Prisma } from "@prisma/client"
import type { Db as AppDb } from "@/lib/prisma"

// ─── Square catalog → SquareCategory / SalesItem (N-5-SYNC) ──────────────────
// The item/variation half of POST /api/square/sales-items/sync, batched.
//
// Why batched: the route used to await one upsert per category and per
// variation. Functions run in iad1 and the database is in us-west-2, so every
// round trip is ~70 ms; ~1,179 variations alone came to ~80–250 s
// (docs/prompts/N-5-SYNC.md, Phase 1). Now: one read of what exists, createMany
// for new rows, one UPDATE … FROM (VALUES …) per 200 changed rows, and nothing
// at all for rows that already match.
//
// WHAT IT WRITES IS UNCHANGED from the old per-row upserts:
//   - the same fields (squareItemId is set on create only, as before);
//   - a category/variation seen twice in one run ends as the old loop left it
//     (first occurrence creates, last occurrence's fields win);
//   - a variation's category resolves only through categories seen THIS run;
//   - the deleted-row sweeps are the old statements, verbatim, including
//     `notIn: undefined` sweeping everything when nothing was seen.
// The one difference (Gary, 2026-11-03, R1): a row whose synced fields already
// match is not written, so its updatedAt no longer moves on every sync.
// Read-only toward Square (CLAUDE.md § Square Integration).

export type SquareCatalogObject = {
  id: string
  type: string
  is_deleted?: boolean
  category_data?: { name?: string }
  item_data?: {
    name?: string
    category_id?: string
    categories?: { id: string }[]
    modifier_list_info?: { modifier_list_id?: string; enabled?: boolean }[]
    variations?: {
      id: string
      item_variation_data?: {
        name?: string
        price_money?: { amount?: number }
      }
    }[]
  }
}

// TAB-4: was Prisma.TransactionClient; see Db in src/lib/prisma.ts.
type Db = AppDb

export const CHUNK = 200

export function chunks<T>(xs: T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size))
  return out
}

// ─── Pure mapping ────────────────────────────────────────────────────────────

export type MappedCategory = { squareCategoryId: string; name: string; isDeleted: boolean }

// Last occurrence wins, as the old sequential upserts did.
export function mapCatalogCategories(objects: SquareCatalogObject[]): Map<string, MappedCategory> {
  const out = new Map<string, MappedCategory>()
  for (const obj of objects) {
    out.set(obj.id, { squareCategoryId: obj.id, name: obj.category_data?.name ?? "Unnamed Category", isDeleted: !!obj.is_deleted })
  }
  return out
}

/** The fields a sync writes on update. squareItemId is create-only. */
export type SalesItemFields = {
  name: string
  variationName: string
  displayName: string
  squareCategoryId: string | null // Froot SquareCategory.id
  menuGroup: string | null
  priceCents: number | null
  isDeleted: boolean
}
export type MappedSalesItem = SalesItemFields & { squareItemId: string; squareVariationId: string }

/**
 * ITEM objects → one row per variation. `categoryRowIds` maps a Square category
 * id to its Froot row id and must hold only categories seen this run.
 * `seenVariationIds` keeps duplicates, as the old loop's array did (the route
 * reports its length).
 */
export function mapCatalogItems(
  itemObjects: SquareCatalogObject[],
  categories: Map<string, MappedCategory>,
  categoryRowIds: Map<string, string>
): { rows: MappedSalesItem[]; seenVariationIds: string[] } {
  const rows = new Map<string, MappedSalesItem>()
  const seenVariationIds: string[] = []
  for (const obj of itemObjects) {
    const itemData = obj.item_data ?? {}
    const squareCategoryId = itemData.categories?.[0]?.id ?? itemData.category_id ?? null
    const categoryId = squareCategoryId ? (categoryRowIds.get(squareCategoryId) ?? null) : null
    const menuGroup = squareCategoryId ? (categories.get(squareCategoryId)?.name ?? null) : null
    const itemName = itemData.name ?? "Unnamed Item"

    for (const v of itemData.variations ?? []) {
      const vd = v.item_variation_data ?? {}
      const variationName = vd.name ?? "Regular"
      seenVariationIds.push(v.id)
      const fields: SalesItemFields = {
        name: itemName,
        variationName,
        displayName: `${itemName} (${variationName})`,
        squareCategoryId: categoryId,
        menuGroup,
        priceCents: vd.price_money?.amount ?? null,
        isDeleted: !!obj.is_deleted,
      }
      const first = rows.get(v.id)
      // A repeat keeps the FIRST squareItemId (the old create) and the LAST fields (the old update).
      rows.set(v.id, { squareItemId: first?.squareItemId ?? obj.id, squareVariationId: v.id, ...fields })
    }
  }
  return { rows: [...rows.values()], seenVariationIds }
}

// ─── Pure planning ───────────────────────────────────────────────────────────

export type ExistingSalesItem = SalesItemFields & { id: string; squareVariationId: string }

export function salesItemChanged(row: SalesItemFields, next: SalesItemFields): boolean {
  return (
    row.name !== next.name ||
    row.variationName !== next.variationName ||
    row.displayName !== next.displayName ||
    row.squareCategoryId !== next.squareCategoryId ||
    row.menuGroup !== next.menuGroup ||
    row.priceCents !== next.priceCents ||
    row.isDeleted !== next.isDeleted
  )
}

export type SalesItemPlan = {
  creates: MappedSalesItem[]
  updates: (SalesItemFields & { id: string })[]
  unchanged: number
}

export function planSalesItemWrites(existing: ExistingSalesItem[], rows: MappedSalesItem[]): SalesItemPlan {
  const byVariation = new Map(existing.map((r) => [r.squareVariationId, r]))
  const plan: SalesItemPlan = { creates: [], updates: [], unchanged: 0 }
  for (const m of rows) {
    const row = byVariation.get(m.squareVariationId)
    if (!row) plan.creates.push(m)
    else if (salesItemChanged(row, m)) {
      plan.updates.push({
        id: row.id,
        name: m.name,
        variationName: m.variationName,
        displayName: m.displayName,
        squareCategoryId: m.squareCategoryId,
        menuGroup: m.menuGroup,
        priceCents: m.priceCents,
        isDeleted: m.isDeleted,
      })
    } else plan.unchanged++
  }
  return plan
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export type CatalogWriteCounts = {
  categories: number // objects seen (the route's existing response key)
  salesItems: number // variations seen, duplicates included (ditto)
  categoriesCreated: number
  categoriesUpdated: number
  itemsCreated: number
  itemsUpdated: number
  itemsUnchanged: number
}

/**
 * Writes one org's categories and sales items, then sweeps unseen rows to
 * isDeleted. Not wrapped in a transaction — the old loop wasn't either, and a
 * partial run is caught up by the next one (every write is idempotent and the
 * sweeps only run after all rows are written). Pass a transaction client to
 * run it inside one (the fixture does, and rolls back).
 */
export async function writeSalesItemCatalogIn(
  db: Db,
  organizationId: string,
  categoryObjects: SquareCatalogObject[],
  itemObjects: SquareCatalogObject[]
): Promise<CatalogWriteCounts> {
  // Categories — tens of rows; changed ones are updated one by one.
  const categories = mapCatalogCategories(categoryObjects)
  const existingCats = await db.squareCategory.findMany({
    where: { organizationId },
    select: { id: true, squareCategoryId: true, name: true, isDeleted: true },
  })
  const catByKey = new Map(existingCats.map((c) => [c.squareCategoryId, c]))
  const categoryRowIds = new Map<string, string>()
  const newCats = [...categories.values()].filter((c) => !catByKey.has(c.squareCategoryId))
  for (const part of chunks(newCats)) {
    const created = await db.squareCategory.createManyAndReturn({
      data: part.map((c) => ({ organizationId, ...c })),
      select: { id: true, squareCategoryId: true },
    })
    for (const c of created) categoryRowIds.set(c.squareCategoryId, c.id)
  }
  let categoriesUpdated = 0
  for (const c of categories.values()) {
    const row = catByKey.get(c.squareCategoryId)
    if (!row) continue
    categoryRowIds.set(c.squareCategoryId, row.id)
    if (row.name !== c.name || row.isDeleted !== c.isDeleted) {
      await db.squareCategory.update({ where: { id: row.id }, data: { name: c.name, isDeleted: c.isDeleted } })
      categoriesUpdated++
    }
  }

  // Sales items
  const { rows, seenVariationIds } = mapCatalogItems(itemObjects, categories, categoryRowIds)
  const existing = await db.salesItem.findMany({
    where: { organizationId },
    select: {
      id: true, squareVariationId: true, name: true, variationName: true, displayName: true,
      squareCategoryId: true, menuGroup: true, priceCents: true, isDeleted: true,
    },
  })
  const plan = planSalesItemWrites(existing, rows)
  for (const part of chunks(plan.creates)) {
    await db.salesItem.createMany({ data: part.map((m) => ({ organizationId, ...m })) })
  }
  for (const part of chunks(plan.updates)) {
    const n = await db.$executeRaw`
      UPDATE "SalesItem" AS s SET
        "name" = v."name",
        "variationName" = v."variationName",
        "displayName" = v."displayName",
        "squareCategoryId" = v."squareCategoryId",
        "menuGroup" = v."menuGroup",
        "priceCents" = v."priceCents",
        "isDeleted" = v."isDeleted",
        "updatedAt" = (NOW() AT TIME ZONE 'UTC')
      FROM (VALUES ${Prisma.join(
        part.map(
          (u) =>
            Prisma.sql`(${u.id}::text, ${u.name}::text, ${u.variationName}::text, ${u.displayName}::text, ${u.squareCategoryId}::text, ${u.menuGroup}::text, ${u.priceCents}::int, ${u.isDeleted}::boolean)`
        )
      )}) AS v("id", "name", "variationName", "displayName", "squareCategoryId", "menuGroup", "priceCents", "isDeleted")
      WHERE s."id" = v."id" AND s."organizationId" = ${organizationId}`
    if (n !== part.length) throw new Error(`SalesItem batch update touched ${n} rows, expected ${part.length}`)
  }

  // Sweeps — the old route's two statements, unchanged.
  const seenCategoryIds = [...categoryRowIds.keys()]
  await db.squareCategory.updateMany({
    where: {
      organizationId,
      isDeleted: false,
      squareCategoryId: seenCategoryIds.length > 0 ? { notIn: seenCategoryIds } : undefined,
    },
    data: { isDeleted: true },
  })
  await db.salesItem.updateMany({
    where: {
      organizationId,
      isDeleted: false,
      squareVariationId: seenVariationIds.length > 0 ? { notIn: seenVariationIds } : undefined,
    },
    data: { isDeleted: true },
  })

  return {
    categories: categoryObjects.length,
    salesItems: seenVariationIds.length,
    categoriesCreated: newCats.length,
    categoriesUpdated,
    itemsCreated: plan.creates.length,
    itemsUpdated: plan.updates.length,
    itemsUnchanged: plan.unchanged,
  }
}
