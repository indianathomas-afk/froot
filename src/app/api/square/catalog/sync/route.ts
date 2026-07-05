import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireAdmin, requireModule } from "@/lib/auth"
import { getSquareClient } from "@/lib/square"

type SquareCatalogObject = {
  id: string
  type: string
  is_deleted?: boolean
  category_data?: { name?: string }
  item_data?: {
    name?: string
    description?: string
    product_type?: string
    category_id?: string
    categories?: { id: string }[]
    variations?: {
      id: string
      item_variation_data?: {
        name?: string
        sku?: string
        ordinal?: number
        price_money?: { amount?: number }
      }
    }[]
  }
}

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

  let cursor: string | undefined
  do {
    const url = new URL(`${client.baseUrl}/v2/catalog/list`)
    url.searchParams.set("types", "ITEM,CATEGORY")
    if (cursor) url.searchParams.set("cursor", cursor)

    const res = await fetch(url, { headers: client.headers })
    if (!res.ok) {
      return NextResponse.json({ error: "Square catalog list failed" }, { status: 502 })
    }

    const data: { objects?: SquareCatalogObject[]; cursor?: string } = await res.json()
    for (const obj of data.objects ?? []) {
      if (obj.type === "CATEGORY") categoryObjects.push(obj)
      else if (obj.type === "ITEM") itemObjects.push(obj)
    }
    cursor = data.cursor
  } while (cursor)

  const categoryIdMap = new Map<string, string>()
  for (const obj of categoryObjects) {
    const row = await prisma.catalogCategory.upsert({
      where: { organizationId_squareCategoryId: { organizationId: org.id, squareCategoryId: obj.id } },
      create: {
        organizationId: org.id,
        squareCategoryId: obj.id,
        name: obj.category_data?.name ?? "Unnamed Category",
        isDeleted: !!obj.is_deleted,
      },
      update: {
        name: obj.category_data?.name ?? "Unnamed Category",
        isDeleted: !!obj.is_deleted,
      },
    })
    categoryIdMap.set(obj.id, row.id)
  }

  let variationCount = 0
  for (const obj of itemObjects) {
    const itemData = obj.item_data ?? {}
    const squareCategoryId = itemData.categories?.[0]?.id ?? itemData.category_id ?? null
    const categoryId = squareCategoryId ? (categoryIdMap.get(squareCategoryId) ?? null) : null

    const catalogItem = await prisma.catalogItem.upsert({
      where: { organizationId_squareItemId: { organizationId: org.id, squareItemId: obj.id } },
      create: {
        organizationId: org.id,
        squareItemId: obj.id,
        categoryId,
        name: itemData.name ?? "Unnamed Item",
        description: itemData.description ?? null,
        productType: itemData.product_type ?? null,
        isDeleted: !!obj.is_deleted,
      },
      update: {
        categoryId,
        name: itemData.name ?? "Unnamed Item",
        description: itemData.description ?? null,
        productType: itemData.product_type ?? null,
        isDeleted: !!obj.is_deleted,
      },
    })

    const variations = itemData.variations ?? []
    const seenVariationIds: string[] = []
    for (const v of variations) {
      const vd = v.item_variation_data ?? {}
      seenVariationIds.push(v.id)
      await prisma.catalogItemVariation.upsert({
        where: { catalogItemId_squareVariationId: { catalogItemId: catalogItem.id, squareVariationId: v.id } },
        create: {
          catalogItemId: catalogItem.id,
          squareVariationId: v.id,
          name: vd.name ?? "Regular",
          sku: vd.sku ?? null,
          priceMoney: vd.price_money?.amount ?? null,
          ordinal: vd.ordinal ?? 0,
        },
        update: {
          name: vd.name ?? "Regular",
          sku: vd.sku ?? null,
          priceMoney: vd.price_money?.amount ?? null,
          ordinal: vd.ordinal ?? 0,
        },
      })
      variationCount++
    }

    // Variations don't carry an isDeleted flag — a variation Square no longer
    // reports for this item is just removed outright.
    await prisma.catalogItemVariation.deleteMany({
      where: {
        catalogItemId: catalogItem.id,
        squareVariationId: seenVariationIds.length > 0 ? { notIn: seenVariationIds } : undefined,
      },
    })
  }

  const seenCategoryIds = [...categoryIdMap.keys()]
  await prisma.catalogCategory.updateMany({
    where: {
      organizationId: org.id,
      isDeleted: false,
      squareCategoryId: seenCategoryIds.length > 0 ? { notIn: seenCategoryIds } : undefined,
    },
    data: { isDeleted: true },
  })

  const seenItemIds = itemObjects.map((o) => o.id)
  await prisma.catalogItem.updateMany({
    where: {
      organizationId: org.id,
      isDeleted: false,
      squareItemId: seenItemIds.length > 0 ? { notIn: seenItemIds } : { not: null },
    },
    data: { isDeleted: true },
  })

  await prisma.organization.update({
    where: { id: org.id },
    data: { lastCatalogSyncAt: new Date() },
  })

  return NextResponse.json({
    categories: categoryObjects.length,
    items: itemObjects.length,
    variations: variationCount,
  })
}
