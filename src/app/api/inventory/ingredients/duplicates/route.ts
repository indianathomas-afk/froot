import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireModule } from "@/lib/auth"
import { nameSimilarity, isCloseNameMatch } from "@/lib/duplicate-match"

function pairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  try {
    await requireModule("inventory")
  } catch {
    return NextResponse.json({ error: "MODULE_NOT_ACTIVE" }, { status: 403 })
  }

  const [ingredients, dismissals] = await Promise.all([
    prisma.ingredient.findMany({
      where: { organizationId: org.id, deletedAt: null },
      include: { category: true },
      orderBy: { name: "asc" },
    }),
    prisma.ingredientDuplicateDismissal.findMany({ where: { organizationId: org.id } }),
  ])

  const dismissed = new Set(dismissals.map((d) => pairKey(d.ingredientAId, d.ingredientBId)))

  const pairs: {
    ingredientA: { id: string; brand: string | null; name: string; categoryName: string | null; packDescription: string | null; sku: string | null }
    ingredientB: { id: string; brand: string | null; name: string; categoryName: string | null; packDescription: string | null; sku: string | null }
    matchReason: "sku" | "name"
    similarity: number
  }[] = []

  for (let i = 0; i < ingredients.length; i++) {
    for (let j = i + 1; j < ingredients.length; j++) {
      const a = ingredients[i]
      const b = ingredients[j]
      if (dismissed.has(pairKey(a.id, b.id))) continue

      const sameSku = !!a.sku?.trim() && !!b.sku?.trim() && a.sku.trim().toLowerCase() === b.sku.trim().toLowerCase()
      const aName = a.brand ? `${a.brand} ${a.name}` : a.name
      const bName = b.brand ? `${b.brand} ${b.name}` : b.name
      const similarity = nameSimilarity(aName, bName)
      const closeName = isCloseNameMatch(aName, bName)

      if (!sameSku && !closeName) continue

      pairs.push({
        ingredientA: { id: a.id, brand: a.brand, name: a.name, categoryName: a.category?.name ?? null, packDescription: a.packDescription, sku: a.sku },
        ingredientB: { id: b.id, brand: b.brand, name: b.name, categoryName: b.category?.name ?? null, packDescription: b.packDescription, sku: b.sku },
        matchReason: sameSku ? "sku" : "name",
        similarity: sameSku ? 1 : similarity,
      })
    }
  }

  pairs.sort((x, y) => y.similarity - x.similarity)

  return NextResponse.json(pairs)
}
