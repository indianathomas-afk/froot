import { auth } from "@clerk/nextjs/server"
import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hrModuleAvailable } from "@/lib/auth"
import type { FormDefinition } from "@/lib/hr-forms"
import { FormSubmitClient, type SubmittedValue } from "./submit-client"

// HR-5 execution flow: an ADMIN or in-scope MANAGER fills a fillable form
// with a staff member and both sign (or the supervisor countersigns later).
// Reached from the staff member's Documents tab: /hr/forms/[id]/submit?staff=…
export default async function FormSubmitPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ staff?: string }>
}) {
  const { orgId } = await auth()
  if (!orgId) redirect("/dashboard")
  if (!hrModuleAvailable(orgId)) notFound()

  const { org, dbUser } = await getCurrentUser()
  if (!org.activeModules.includes("hr")) redirect("/hr")
  if (dbUser?.role !== "ADMIN" && dbUser?.role !== "MANAGER") notFound()

  const { id } = await params
  const { staff: staffId } = await searchParams
  if (!staffId) redirect("/staff")

  // Managers only execute for staff in their own stores (HR-4 attested rule).
  const staff = await prisma.staffMember.findFirst({
    where: { id: staffId, organizationId: org.id },
    include: { storeAssignments: { select: { storeId: true } } },
  })
  if (!staff) notFound()
  if (dbUser.role === "MANAGER") {
    const managerStoreIds = dbUser.storeAssignments.map((a) => a.storeId)
    if (!staff.storeAssignments.some((a) => managerStoreIds.includes(a.storeId))) notFound()
  }

  const doc = await prisma.hrDocument.findFirst({
    where: { id, organizationId: org.id, kind: "FillableForm", isActive: true },
    include: { versions: { where: { isCurrent: true }, take: 1 } },
  })
  const version = doc?.versions[0]
  const definition = version?.definitionSnapshot as unknown as FormDefinition | null
  if (!doc || !version || !definition) notFound()

  // A pending (employee-signed, awaiting supervisor) execution takes over the
  // page as a countersign — never restart a half-signed form. It stays pinned
  // to ITS version, even if the definition moved on since.
  const pending = await prisma.formSubmission.findFirst({
    where: {
      staffMemberId: staff.id,
      status: "PendingSupervisor",
      version: { hrDocumentId: doc.id },
    },
    orderBy: { signedAt: "desc" },
  })

  return (
    <FormSubmitClient
      doc={{
        id: doc.id,
        title: doc.title,
        versionNumber: version.versionNumber,
        definitionHash: version.fileHash,
      }}
      definition={definition}
      staff={{ id: staff.id, name: staff.fullName ?? staff.displayName }}
      supervisorName={dbUser.name ?? dbUser.email}
      pending={
        pending
          ? {
              id: pending.id,
              values: pending.values as unknown as SubmittedValue[],
              employeeTypedName: pending.employeeTypedName ?? "",
              employeeSignedAt: (pending.employeeSignedAt ?? pending.signedAt).toISOString(),
              formTitle: pending.formTitle ?? doc.title,
              formVersionNumber: pending.formVersionNumber ?? version.versionNumber,
            }
          : null
      }
    />
  )
}
