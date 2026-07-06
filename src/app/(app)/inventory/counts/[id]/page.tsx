import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import { CountClient } from "./count-client"

export default async function CountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { orgId, userId } = await auth()
  if (!orgId) redirect("/dashboard")

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org || !org.activeModules.includes("inventory")) redirect("/inventory/counts")

  const dbUser = userId ? await prisma.user.findUnique({ where: { clerkUserId: userId } }) : null
  const canManage = dbUser?.role === "ADMIN" || dbUser?.role === "MANAGER"

  return <CountClient countId={id} canManage={canManage} />
}
