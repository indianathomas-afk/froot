import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions"
import { actorFor } from "@/lib/auth"
import { redirect } from "next/navigation"
import { DuplicatesClient } from "./duplicates-client"

export default async function IngredientDuplicatesPage() {
  const { orgId, userId } = await auth()
  if (!orgId) redirect("/dashboard")

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) redirect("/dashboard")

  if (!org.activeModules.includes("inventory")) redirect("/inventory/ingredients")

  const dbUser = userId ? await prisma.user.findUnique({ where: { clerkUserId: userId } }) : null
  // PERM-2 §3 #5: same capability its data APIs enforce.
  if (!can(actorFor(dbUser), "inventory.assets.manage")) redirect("/inventory/ingredients")

  return <DuplicatesClient />
}
