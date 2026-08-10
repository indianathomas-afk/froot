import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { TemplateForm } from "../template-form"

// CHK-4 close-out, 2026-08-10 — `timezone` and `hours` joined onto the store
// select the form already received. The clamp warning is a per-store fact
// (src/lib/checklist-lifecycle.ts `endClampsAtDayClose`), and the form had no
// store hours in it at all, which is why the warning could only ever fire for
// the one phase whose arithmetic is store-independent. Same shape in
// templates/[id]/edit/page.tsx.
type FormStore = {
  id: string
  name: string
  storeNumber: string | null
  timezone: string
  hours: { dayOfWeek: number; openingTime: string | null; closingTime: string | null; isClosed: boolean }[]
}

export default async function NewTemplatePage() {
  const { orgId } = await auth()
  let stores: FormStore[] = []

  if (orgId) {
    const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
    if (org) {
      stores = await prisma.store.findMany({
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
      })
    }
  }

  return <TemplateForm stores={stores} />
}
