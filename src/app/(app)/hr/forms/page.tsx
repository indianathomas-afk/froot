import { auth } from "@clerk/nextjs/server"
import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hrModuleAvailable } from "@/lib/auth"
import { listDocumentCategories } from "@/lib/document-categories"
import { HrFormsClient, type HrFormRow } from "./forms-client"

// HR-5 agreement-form templates (Key Agreement, Pay Agreement...). Template
// management is ADMIN-only — managers execute forms from /staff/[id], they
// never manage definitions, so for everyone else this page does not exist.
// Same gate stack as the library: availability → per-org toggle → role.
export default async function HrFormsPage() {
  const { orgId } = await auth()
  if (!orgId) redirect("/dashboard")
  if (!hrModuleAvailable(orgId)) notFound()

  const { org, dbUser } = await getCurrentUser()
  if (!org.activeModules.includes("hr")) redirect("/hr")
  if (dbUser?.role !== "ADMIN") notFound()

  const docs = await prisma.hrDocument.findMany({
    where: { organizationId: org.id, kind: "FillableForm", isActive: true },
    include: {
      // DOC-5 (F7): forms share the document taxonomy; read the relation.
      docCategory: { select: { name: true, colorKey: true } },
      formFields: { select: { id: true } },
      versions: {
        orderBy: { versionNumber: "desc" },
        include: { _count: { select: { formSubmissions: true } } },
      },
    },
    orderBy: { title: "asc" },
  })

  const titleById = new Map(docs.map((d) => [d.id, d.title]))
  const forms: HrFormRow[] = docs.map((d) => ({
    id: d.id,
    title: d.title,
    categoryName: d.docCategory?.name ?? null,
    categoryColorKey: d.docCategory?.colorKey ?? null,
    fieldCount: d.formFields.length,
    currentVersionNumber: d.versions.find((v) => v.isCurrent)?.versionNumber ?? 1,
    submissionCount: d.versions.reduce((sum, v) => sum + v._count.formSubmissions, 0),
    linkedFormId: d.linkedFormId,
    linkedFormTitle: d.linkedFormId ? titleById.get(d.linkedFormId) ?? null : null,
  }))

  const categories = await listDocumentCategories(org.id)

  return <HrFormsClient forms={forms} categories={categories} />
}
