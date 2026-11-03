import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireAdmin, requireModule } from "@/lib/auth"
import { getSquareClient } from "@/lib/square"
import { writeSalesItemCatalogIn, type SquareCatalogObject } from "@/lib/square-catalog-sync"
import {
  mapModifierCatalog,
  writeModifierCatalog,
  type SquareModifierListObject,
  type SquareModifierObject,
} from "@/lib/square-modifier-sync"

// N-5-SYNC: back to the project default of 300 s (Fluid compute, Pro).
// N-5 had set 60, which LOWERED this route's limit — the sync timed out on
// staging 2026-11-03. The fix is the batched writes in square-catalog-sync.ts;
// this is the safety net (docs/prompts/N-5-SYNC.md).
export const maxDuration = 300

export async function POST() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  try {
    await requireModule("inventory")
  } catch {
    return NextResponse.json({ error: "MODULE_NOT_ACTIVE" }, { status: 403 })
  }

  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  if (!org.squareAccessToken) {
    return NextResponse.json({ error: "Square not connected" }, { status: 400 })
  }

  const client = await getSquareClient(org)

  const categoryObjects: SquareCatalogObject[] = []
  const itemObjects: SquareCatalogObject[] = []
  // N-5: modifier lists ride the same pages; items/categories are unchanged.
  const modifierListObjects: SquareModifierListObject[] = []
  const looseModifierObjects: SquareModifierObject[] = []

  let cursor: string | undefined
  do {
    const url = new URL(`${client.baseUrl}/v2/catalog/list`)
    url.searchParams.set("types", "ITEM,CATEGORY,MODIFIER_LIST")
    if (cursor) url.searchParams.set("cursor", cursor)

    const res = await fetch(url, { headers: client.headers })
    if (!res.ok) {
      return NextResponse.json({ error: "Square catalog list failed" }, { status: 502 })
    }

    const data: { objects?: (SquareCatalogObject & SquareModifierListObject & SquareModifierObject)[]; cursor?: string } =
      await res.json()
    for (const obj of data.objects ?? []) {
      if (obj.type === "CATEGORY") categoryObjects.push(obj)
      else if (obj.type === "ITEM") itemObjects.push(obj)
      else if (obj.type === "MODIFIER_LIST") modifierListObjects.push(obj)
      else if (obj.type === "MODIFIER") looseModifierObjects.push(obj)
    }
    cursor = data.cursor
  } while (cursor)

  // Categories, sales items and their deleted-row sweeps, batched (N-5-SYNC).
  const startedAt = Date.now()
  const catalog = await writeSalesItemCatalogIn(prisma, org.id, categoryObjects, itemObjects)

  // N-5: after every item/variation write above, so their behaviour is untouched.
  const modifierCounts = await writeModifierCatalog(
    org.id,
    mapModifierCatalog(modifierListObjects, looseModifierObjects, itemObjects)
  )

  await prisma.organization.update({
    where: { id: org.id },
    data: { lastCatalogSyncAt: new Date() },
  })

  console.log(
    `[sales-items/sync] org=${org.id} items created=${catalog.itemsCreated} updated=${catalog.itemsUpdated} unchanged=${catalog.itemsUnchanged} ` +
      `categories created=${catalog.categoriesCreated} updated=${catalog.categoriesUpdated} modifiers=${modifierCounts.modifiers} writeMs=${Date.now() - startedAt}`
  )

  return NextResponse.json({
    categories: catalog.categories,
    salesItems: catalog.salesItems,
    modifierLists: modifierCounts.modifierLists,
    modifiers: modifierCounts.modifiers,
  })
}
