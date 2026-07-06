import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import { DeletedIngredientsClient } from "./deleted-client"

export default async function DeletedIngredientsPage() {
  const { orgId, userId } = await auth()
  if (!orgId) redirect("/dashboard")

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) redirect("/dashboard")

  if (!org.activeModules.includes("inventory")) redirect("/inventory/ingredients")

  const dbUser = userId ? await prisma.user.findUnique({ where: { clerkUserId: userId } }) : null
  const canManage = dbUser?.role === "ADMIN" || dbUser?.role === "MANAGER"
  if (!canManage) redirect("/inventory/ingredients")

  const deleted = await prisma.ingredient.findMany({
    where: { organizationId: org.id, deletedAt: { not: null } },
    include: { category: true },
    orderBy: { deletedAt: "desc" },
  })

  return (
    <DeletedIngredientsClient
      ingredients={deleted.map((i) => ({
        id: i.id,
        brand: i.brand,
        name: i.name,
        categoryName: i.category?.name ?? null,
        purchaseUnitLabel: i.purchaseUnitLabel,
        packDescription: i.packDescription,
        deletedAt: i.deletedAt!.toISOString(),
      }))}
    />
  )
}
