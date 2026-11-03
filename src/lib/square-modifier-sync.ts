import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

// ─── Square modifier sync (N-5) ──────────────────────────────────────────────
// Modifier lists, their modifiers, and which items offer which list, read from
// the same /v2/catalog/list pages the sales-items sync already walks. Read-only
// toward Square, like everything else (CLAUDE.md § Square Integration).
//
// Shape (docs/prompts/N-5_AUDIT.md § A2): a MODIFIER_LIST carries its modifiers
// nested in modifier_list_data.modifiers[] as { id, type: "MODIFIER",
// modifier_data }. Top-level MODIFIER objects are also accepted in case a page
// returns them unnested — the audit could not observe a live payload.
// item_data.modifier_list_info[] hangs off the ITEM, not the variation.
//
// Deletes: ListCatalog never returns deleted objects, so — as for SalesItem —
// anything not seen this run is swept to isDeleted and keeps its recipe.

type Money = { amount?: number } | null | undefined

export type SquareModifierObject = {
  id: string
  type: string
  is_deleted?: boolean
  modifier_data?: { name?: string; price_money?: Money; ordinal?: number; modifier_list_id?: string; on_by_default?: boolean }
}

export type SquareModifierListObject = {
  id: string
  type: string
  is_deleted?: boolean
  modifier_list_data?: {
    name?: string
    ordinal?: number
    modifier_type?: string
    modifiers?: SquareModifierObject[]
  }
}

export type SquareItemWithModifierLists = {
  id: string
  is_deleted?: boolean
  item_data?: { modifier_list_info?: { modifier_list_id?: string; enabled?: boolean }[] }
}

export type MappedModifierList = { squareModifierListId: string; name: string; ordinal: number | null }
export type MappedModifier = {
  squareModifierId: string
  squareModifierListId: string
  name: string
  priceCents: number | null
  ordinal: number | null
  onByDefault: boolean
}
export type MappedItemLink = { squareItemId: string; squareModifierListId: string; enabled: boolean }

export type MappedModifierCatalog = {
  lists: MappedModifierList[]
  modifiers: MappedModifier[]
  links: MappedItemLink[]
}

// Pure: catalog objects in, rows to write out. No DB.
export function mapModifierCatalog(
  listObjects: SquareModifierListObject[],
  looseModifiers: SquareModifierObject[],
  items: SquareItemWithModifierLists[]
): MappedModifierCatalog {
  const lists = new Map<string, MappedModifierList>()
  const modifiers = new Map<string, MappedModifier>()

  const addModifier = (m: SquareModifierObject, listId: string | undefined) => {
    const md = m.modifier_data ?? {}
    const squareModifierListId = md.modifier_list_id ?? listId
    if (m.is_deleted || !squareModifierListId || !lists.has(squareModifierListId)) return
    modifiers.set(m.id, {
      squareModifierId: m.id,
      squareModifierListId,
      name: md.name ?? "Unnamed modifier",
      priceCents: md.price_money?.amount ?? null,
      ordinal: md.ordinal ?? null,
      onByDefault: !!md.on_by_default,
    })
  }

  for (const l of listObjects) {
    const ld = l.modifier_list_data ?? {}
    // TEXT lists are free-text notes ("Name on cup") — no modifiers to cost.
    if (l.is_deleted || ld.modifier_type === "TEXT") continue
    lists.set(l.id, { squareModifierListId: l.id, name: ld.name ?? "Unnamed modifier list", ordinal: ld.ordinal ?? null })
  }
  for (const l of listObjects) {
    if (!lists.has(l.id)) continue
    for (const m of l.modifier_list_data?.modifiers ?? []) addModifier(m, l.id)
  }
  for (const m of looseModifiers) if (!modifiers.has(m.id)) addModifier(m, undefined)

  const links = new Map<string, MappedItemLink>()
  for (const item of items) {
    if (item.is_deleted) continue
    for (const info of item.item_data?.modifier_list_info ?? []) {
      const listId = info.modifier_list_id
      if (!listId || !lists.has(listId)) continue
      links.set(`${item.id}|${listId}`, { squareItemId: item.id, squareModifierListId: listId, enabled: info.enabled !== false })
    }
  }

  return { lists: [...lists.values()], modifiers: [...modifiers.values()], links: [...links.values()] }
}

const CHUNK = 200

function chunks<T>(xs: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK))
  return out
}

export type ModifierCatalogCounts = { modifierLists: number; modifiers: number; itemLinks: number }

// Writes one org's modifier catalog in one transaction.
export async function writeModifierCatalog(organizationId: string, mapped: MappedModifierCatalog): Promise<ModifierCatalogCounts> {
  return prisma.$transaction((tx) => writeModifierCatalogIn(tx, organizationId, mapped), { timeout: 60_000 })
}

// The body, on a caller's transaction (the fixture runs it inside one it
// rolls back). Batched rather than one awaited upsert per row (audit § B: a
// few hundred modifiers on top of the variation upserts): new rows go in with
// createMany, existing rows are updated only when a synced field changed.
// recipeStatus is Froot's and is never touched here.
export async function writeModifierCatalogIn(
  tx: Prisma.TransactionClient,
  organizationId: string,
  mapped: MappedModifierCatalog
): Promise<ModifierCatalogCounts> {
  // Lists
  const existingLists = await tx.squareModifierList.findMany({ where: { organizationId } })
  const listByKey = new Map(existingLists.map((l) => [l.squareModifierListId, l]))
  const newLists = mapped.lists.filter((l) => !listByKey.has(l.squareModifierListId))
  for (const part of chunks(newLists)) {
    await tx.squareModifierList.createMany({ data: part.map((l) => ({ organizationId, ...l })) })
  }
  // Changed rows: one UPDATE … FROM (VALUES …) per chunk, not one per row
  // (N-5-SYNC R2, Gary 2026-11-03). Same rule for which rows change.
  const changedLists: { id: string; name: string; ordinal: number | null }[] = []
  for (const l of mapped.lists) {
    const row = listByKey.get(l.squareModifierListId)
    if (row && (row.name !== l.name || row.ordinal !== l.ordinal || row.isDeleted)) {
      changedLists.push({ id: row.id, name: l.name, ordinal: l.ordinal })
    }
  }
  for (const part of chunks(changedLists)) {
    const n = await tx.$executeRaw`
      UPDATE "SquareModifierList" AS t SET
        "name" = v."name", "ordinal" = v."ordinal", "isDeleted" = false,
        "updatedAt" = (NOW() AT TIME ZONE 'UTC')
      FROM (VALUES ${Prisma.join(part.map((u) => Prisma.sql`(${u.id}::text, ${u.name}::text, ${u.ordinal}::int)`))})
        AS v("id", "name", "ordinal")
      WHERE t."id" = v."id" AND t."organizationId" = ${organizationId}`
    if (n !== part.length) throw new Error(`SquareModifierList batch update touched ${n} rows, expected ${part.length}`)
  }
  const seenListIds = mapped.lists.map((l) => l.squareModifierListId)
  await tx.squareModifierList.updateMany({
    where: { organizationId, isDeleted: false, squareModifierListId: { notIn: seenListIds } },
    data: { isDeleted: true },
  })
  const listIdOf = new Map(
    (await tx.squareModifierList.findMany({ where: { organizationId }, select: { id: true, squareModifierListId: true } })).map(
      (l) => [l.squareModifierListId, l.id]
    )
  )

  // Modifiers
  const existingMods = await tx.squareModifier.findMany({ where: { organizationId } })
  const modByKey = new Map(existingMods.map((m) => [m.squareModifierId, m]))
  const rowData = (m: MappedModifier) => ({
    modifierListId: listIdOf.get(m.squareModifierListId)!,
    name: m.name,
    priceCents: m.priceCents,
    ordinal: m.ordinal,
    onByDefault: m.onByDefault,
  })
  const newMods = mapped.modifiers.filter((m) => !modByKey.has(m.squareModifierId))
  for (const part of chunks(newMods)) {
    await tx.squareModifier.createMany({
      data: part.map((m) => ({ organizationId, squareModifierId: m.squareModifierId, ...rowData(m) })),
    })
  }
  const changedMods: (ReturnType<typeof rowData> & { id: string })[] = []
  for (const m of mapped.modifiers) {
    const row = modByKey.get(m.squareModifierId)
    if (!row) continue
    const d = rowData(m)
    if (
      row.isDeleted ||
      row.modifierListId !== d.modifierListId ||
      row.name !== d.name ||
      row.priceCents !== d.priceCents ||
      row.ordinal !== d.ordinal ||
      row.onByDefault !== d.onByDefault
    ) {
      changedMods.push({ id: row.id, ...d })
    }
  }
  for (const part of chunks(changedMods)) {
    const n = await tx.$executeRaw`
      UPDATE "SquareModifier" AS t SET
        "modifierListId" = v."modifierListId", "name" = v."name", "priceCents" = v."priceCents",
        "ordinal" = v."ordinal", "onByDefault" = v."onByDefault", "isDeleted" = false,
        "updatedAt" = (NOW() AT TIME ZONE 'UTC')
      FROM (VALUES ${Prisma.join(
        part.map(
          (u) =>
            Prisma.sql`(${u.id}::text, ${u.modifierListId}::text, ${u.name}::text, ${u.priceCents}::int, ${u.ordinal}::int, ${u.onByDefault}::boolean)`
        )
      )}) AS v("id", "modifierListId", "name", "priceCents", "ordinal", "onByDefault")
      WHERE t."id" = v."id" AND t."organizationId" = ${organizationId}`
    if (n !== part.length) throw new Error(`SquareModifier batch update touched ${n} rows, expected ${part.length}`)
  }
  const seenModIds = mapped.modifiers.map((m) => m.squareModifierId)
  await tx.squareModifier.updateMany({
    where: { organizationId, isDeleted: false, squareModifierId: { notIn: seenModIds } },
    data: { isDeleted: true },
  })

  // Item ↔ list links carry no Froot-side data: replace wholesale.
  await tx.squareItemModifierList.deleteMany({ where: { organizationId } })
  for (const part of chunks(mapped.links)) {
    await tx.squareItemModifierList.createMany({
      data: part.map((k) => ({
        organizationId,
        squareItemId: k.squareItemId,
        modifierListId: listIdOf.get(k.squareModifierListId)!,
        enabled: k.enabled,
      })),
    })
  }

  return { modifierLists: mapped.lists.length, modifiers: mapped.modifiers.length, itemLinks: mapped.links.length }
}
