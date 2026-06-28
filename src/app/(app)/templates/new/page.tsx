import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { TemplateForm } from "../template-form"

export default async function NewTemplatePage() {
  const { orgId } = await auth()
  let stores: { id: string; name: string; storeNumber: string | null }[] = []

  if (orgId) {
    const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
    if (org) {
      stores = await prisma.store.findMany({
        where: { organizationId: org.id },
        select: { id: true, name: true, storeNumber: true },
        orderBy: { name: "asc" },
      })
    }
  }

  return <TemplateForm stores={stores} />
}
