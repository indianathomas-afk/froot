import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import { Carrot } from "lucide-react"
import Link from "next/link"
import { getUserStoreScope } from "@/lib/auth"
import { serializeIngredient } from "@/lib/ingredient-dto"
import { IngredientsClient } from "./ingredients-client"

export default async function IngredientsPage() {
  const { orgId, userId } = await auth()
  if (!orgId) redirect("/dashboard")

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) redirect("/dashboard")

  if (!org.activeModules.includes("inventory")) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-md">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center">
            <Carrot className="h-6 w-6 text-[var(--color-primary)]" />
          </div>
          <h1 className="text-xl font-bold text-[var(--color-foreground)] mb-2">Inventory Management</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mb-6">
            Track ingredients, vendors, and purchase orders — upgrade to the Inventory add-on to unlock this page.
          </p>
          <Link
            href="/settings"
            className="inline-flex items-center bg-[var(--color-primary)] text-[var(--color-primary-foreground)] px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Upgrade Plan
          </Link>
        </div>
      </div>
    )
  }

  const dbUser = userId ? await prisma.user.findUnique({ where: { clerkUserId: userId } }) : null
  const isAdmin = dbUser?.role === "ADMIN"
  const canManage = isAdmin || dbUser?.role === "MANAGER"

  const { storeIds } = await getUserStoreScope()
  const stores = await prisma.store.findMany({
    where: { organizationId: org.id, isActive: true, ...(isAdmin ? {} : { id: { in: storeIds } }) },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  })

  const [ingredients, categories, deletedIngredients] = await Promise.all([
    prisma.ingredient.findMany({
      where: { organizationId: org.id, deletedAt: null },
      include: { category: true, vendorIngredients: { include: { vendor: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.ingredientCategory.findMany({
      where: { organizationId: org.id },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.ingredient.findMany({
      where: { organizationId: org.id, deletedAt: { not: null } },
      select: { id: true, brand: true, name: true },
    }),
  ])

  const editorIds = [...new Set(ingredients.map((i) => i.lastEditedByUserId).filter((id): id is string => !!id))]
  const editors = editorIds.length ? await prisma.user.findMany({ where: { id: { in: editorIds } } }) : []
  const editorNameById = new Map(editors.map((u) => [u.id, u.name || u.email]))

  const ingredientCountByCategory: Record<string, number> = {}
  for (const i of ingredients) {
    if (i.categoryId && !i.glCodeOverride) {
      ingredientCountByCategory[i.categoryId] = (ingredientCountByCategory[i.categoryId] ?? 0) + 1
    }
  }

  return (
    <IngredientsClient
      ingredients={ingredients.map((i) =>
        serializeIngredient(i, i.lastEditedByUserId ? editorNameById.get(i.lastEditedByUserId) ?? null : null)
      )}
      categories={categories.map((c) => ({ id: c.id, name: c.name, glCode: c.glCode }))}
      ingredientCountByCategory={ingredientCountByCategory}
      deletedIngredientNames={deletedIngredients.map((i) => ({ id: i.id, brand: i.brand, name: i.name }))}
      stores={stores}
      canManage={canManage}
      isAdmin={isAdmin}
    />
  )
}
