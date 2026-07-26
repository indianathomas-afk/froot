import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions"
import { redirect } from "next/navigation"
import { DeletedIngredientsClient } from "./deleted-client"

export default async function DeletedIngredientsPage() {
  const { orgId, userId } = await auth()
  if (!orgId) redirect("/dashboard")

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) redirect("/dashboard")

  if (!org.activeModules.includes("inventory")) redirect("/inventory/ingredients")

  const dbUser = userId ? await prisma.user.findUnique({ where: { clerkUserId: userId } }) : null
  // PERM-2 §3 #5: same capability its data APIs enforce.
  if (!can({ role: dbUser?.role }, "inventory.assets.manage")) redirect("/inventory/ingredients")

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
