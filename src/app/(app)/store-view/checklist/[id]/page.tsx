import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
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
          tasks: { orderBy: { orderIndex: "asc" } },
        },
      },
      taskLogs: true,
    },
  })

  if (!checklist) return notFound()

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
