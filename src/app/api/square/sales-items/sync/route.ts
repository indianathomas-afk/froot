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
    category_id?: string
    categories?: { id: string }[]
    variations?: {
      id: string
      item_variation_data?: {
        name?: string
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
  const categoryNameMap = new Map<string, string>()
  for (const obj of categoryObjects) {
    const name = obj.category_data?.name ?? "Unnamed Category"
    const row = await prisma.squareCategory.upsert({
      where: { organizationId_squareCategoryId: { organizationId: org.id, squareCategoryId: obj.id } },
      create: { organizationId: org.id, squareCategoryId: obj.id, name, isDeleted: !!obj.is_deleted },
      update: { name, isDeleted: !!obj.is_deleted },
    })
    categoryIdMap.set(obj.id, row.id)
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

      await prisma.salesItem.upsert({
        where: { organizationId_squareVariationId: { organizationId: org.id, squareVariationId: v.id } },
        create: {
          organizationId: org.id,
          squareItemId: obj.id,
          squareVariationId: v.id,
          name: itemName,
          variationName,
          displayName: `${itemName} (${variationName})`,
          squareCategoryId: categoryId,
          menuGroup,
          priceCents: vd.price_money?.amount ?? null,
          isDeleted: !!obj.is_deleted,
        },
        update: {
          name: itemName,
          variationName,
          displayName: `${itemName} (${variationName})`,
          squareCategoryId: categoryId,
          menuGroup,
          priceCents: vd.price_money?.amount ?? null,
          isDeleted: !!obj.is_deleted,
        },
      })
    }
  }

  const seenCategoryIds = [...categoryIdMap.keys()]
  await prisma.squareCategory.updateMany({
    where: {
      organizationId: org.id,
      isDeleted: false,
      squareCategoryId: seenCategoryIds.length > 0 ? { notIn: seenCategoryIds } : undefined,
    },
    data: { isDeleted: true },
  })

  await prisma.salesItem.updateMany({
    where: {
      organizationId: org.id,
      isDeleted: false,
      squareVariationId: seenVariationIds.length > 0 ? { notIn: seenVariationIds } : undefined,
    },
    data: { isDeleted: true },
  })

  await prisma.organization.update({
    where: { id: org.id },
    data: { lastCatalogSyncAt: new Date() },
  })

  return NextResponse.json({
    categories: categoryObjects.length,
    salesItems: seenVariationIds.length,
  })
}
