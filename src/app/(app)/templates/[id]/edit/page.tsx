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

  const [template, stores] = await Promise.all([
    prisma.template.findFirst({
      where: { id, organizationId: org.id },
      // CHK-1: the form needs the SECTION ROWS, not just the strings on the
      // tasks — it is the ids in this list that let a rename be a rename when
      // the form posts back (api/templates/sections.ts).
      include: {
        tasks: { orderBy: { orderIndex: "asc" } },
        sections: { select: { id: true, name: true, sortOrder: true }, orderBy: { sortOrder: "asc" } },
        storeAssignments: true,
      },
    }),
    // CHK-4 close-out, 2026-08-10 — `timezone` and `hours` joined on so the
    // form can compute the clamp warning per applicable store. See the note in
    // templates/new/page.tsx; the two selects must stay identical, because a
    // warning that fires on create and not on edit is worse than neither.
    prisma.store.findMany({
      where: { organizationId: org.id },
      select: {
        id: true,
        name: true,
        storeNumber: true,
        timezone: true,
        hours: {
          select: { dayOfWeek: true, openingTime: true, closingTime: true, isClosed: true },
          orderBy: { dayOfWeek: "asc" },
        },
      },
      orderBy: { name: "asc" },
    }),
  ])
  if (!template) return notFound()

  return <TemplateForm initialData={template} stores={stores} />
}
