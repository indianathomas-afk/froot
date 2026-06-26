import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { notFound } from "next/navigation"
import { TemplateForm } from "../../template-form"

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { orgId } = await auth()
  if (!orgId) return notFound()

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return notFound()

  const template = await prisma.template.findFirst({
    where: { id, organizationId: org.id },
    include: { tasks: { orderBy: { orderIndex: "asc" } } },
  })
  if (!template) return notFound()

  return <TemplateForm initialData={template} />
}
