import { auth } from "@clerk/nextjs/server"
import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hrModuleAvailable } from "@/lib/auth"
import { FormBuilderClient } from "./form-builder-client"

// HR-5 form builder — ADMIN-only, same gate stack as /hr/forms.
export default async function HrFormBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) redirect("/dashboard")
  if (!hrModuleAvailable(orgId)) notFound()

  const { org, dbUser } = await getCurrentUser()
  if (!org.activeModules.includes("hr")) redirect("/hr")
  if (dbUser?.role !== "ADMIN") notFound()

  const { id } = await params
  const doc = await prisma.hrDocument.findFirst({
    where: { id, organizationId: org.id, kind: "FillableForm" },
    include: {
      formFields: { orderBy: { orderIndex: "asc" } },
      versions: {
        orderBy: { versionNumber: "desc" },
        include: { _count: { select: { formSubmissions: true } } },
      },
    },
  })
  if (!doc) notFound()

  // Pairing candidates: other active forms not already in a pair.
  const pairable = await prisma.hrDocument.findMany({
    where: {
      organizationId: org.id,
      kind: "FillableForm",
      isActive: true,
      id: { not: doc.id },
      linkedFormId: null,
    },
    select: { id: true, title: true },
    orderBy: { title: "asc" },
  })
  const linked = doc.linkedFormId
    ? await prisma.hrDocument.findFirst({
        where: { id: doc.linkedFormId, organizationId: org.id },
        select: { id: true, title: true },
      })
    : null

  const current = doc.versions.find((v) => v.isCurrent)

  return (
    <FormBuilderClient
      doc={{
        id: doc.id,
        title: doc.title,
        category: doc.category,
        bodyText: doc.bodyText ?? "",
        isActive: doc.isActive,
      }}
      fields={doc.formFields.map((f) => ({
        label: f.label,
        fieldType: f.fieldType,
        required: f.required,
        options: Array.isArray(f.options) ? (f.options as string[]) : null,
      }))}
      currentVersion={{
        versionNumber: current?.versionNumber ?? 1,
        fileHash: current?.fileHash ?? "",
        submissionCount: current?._count.formSubmissions ?? 0,
      }}
      versions={doc.versions.map((v) => ({
        versionNumber: v.versionNumber,
        fileHash: v.fileHash,
        isCurrent: v.isCurrent,
        createdAt: v.createdAt.toISOString(),
        submissionCount: v._count.formSubmissions,
      }))}
      linked={linked}
      pairable={pairable}
    />
  )
}
