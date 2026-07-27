import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import { can } from "@/lib/permissions"
import { CountClient } from "./count-client"

export default async function CountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { orgId, userId } = await auth()
  if (!orgId) redirect("/dashboard")

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org || !org.activeModules.includes("inventory")) redirect("/inventory/counts")

  const dbUser = userId ? await prisma.user.findUnique({ where: { clerkUserId: userId } }) : null
  const canManage = dbUser?.role === "ADMIN" || dbUser?.role === "MANAGER"
  // PERM-2 §3 #5: the finalized-count summary is commercial (valuation,
  // variance, cost drift) and its API now requires inventory.analytics.view.
  // Ask the same capability here so a counter without it gets a message
  // instead of a screen that loads forever.
  const canViewSummary = can({ role: dbUser?.role }, "inventory.analytics.view")

  return <CountClient countId={id} canManage={canManage} canViewSummary={canViewSummary} />
}
