import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { notFound } from "next/navigation"
import { ChecklistExecutionClient } from "./checklist-execution-client"

export default async function ChecklistExecutionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { orgId } = await auth()
  if (!orgId) return notFound()

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return notFound()

  const checklist = await prisma.checklist.findFirst({
    where: { id, organizationId: org.id },
    include: {
      store: true,
      template: {
        include: {
          tasks: { include: { attachment: true }, orderBy: { orderIndex: "asc" } },
        },
      },
      taskLogs: true,
    },
  })

  if (!checklist) return notFound()

  const { isAdmin, storeIds } = await getUserStoreScope()
  // Non-admins can never view a checklist for a store they aren't assigned to,
  // even by guessing the checklist ID directly.
  if (!isAdmin && !storeIds.includes(checklist.storeId)) return notFound()

  const staff = await prisma.staffMember.findMany({
    where: {
      organizationId: org.id,
      storeAssignments: { some: { storeId: checklist.storeId } },
    },
    select: { id: true, displayName: true },
    orderBy: { displayName: "asc" },
  })

  return <ChecklistExecutionClient checklist={checklist} staff={staff} />
}
