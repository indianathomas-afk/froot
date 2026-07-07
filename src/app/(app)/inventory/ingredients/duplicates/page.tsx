import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import { DuplicatesClient } from "./duplicates-client"

export default async function IngredientDuplicatesPage() {
  const { orgId, userId } = await auth()
  if (!orgId) redirect("/dashboard")

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) redirect("/dashboard")

  if (!org.activeModules.includes("inventory")) redirect("/inventory/ingredients")

  const dbUser = userId ? await prisma.user.findUnique({ where: { clerkUserId: userId } }) : null
  const canManage = dbUser?.role === "ADMIN" || dbUser?.role === "MANAGER"
  if (!canManage) redirect("/inventory/ingredients")

  return <DuplicatesClient />
}
