import { auth } from "@clerk/nextjs/server"
import { notFound, redirect } from "next/navigation"
import { FileQuestion } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hrModuleAvailable } from "@/lib/auth"
import { findStaffMemberForEmail } from "@/lib/hr"
import { AcknowledgeClient } from "./acknowledge-client"

// HR-4 single-document acknowledgment flow. Two entry points, one engine:
//   /hr/acknowledge/[documentId]              — self-serve (ClerkSession)
//   /hr/acknowledge/[documentId]?staff=<id>   — manager-attested, scope-checked
// The broader staff portal is HR-7; this page stays a focused one-document
// capture screen.
export default async function AcknowledgePage({
  params,
  searchParams,
}: {
  params: Promise<{ documentId: string }>
  searchParams: Promise<{ staff?: string }>
}) {
  const { orgId } = await auth()
  if (!orgId) redirect("/dashboard")
  if (!hrModuleAvailable(orgId)) notFound()

  const { org, dbUser } = await getCurrentUser()
  if (!org.activeModules.includes("hr")) redirect("/hr")
  if (!dbUser) redirect("/dashboard")

  const { documentId } = await params
  const { staff: staffParam } = await searchParams

  const doc = await prisma.hrDocument.findFirst({
    where: { id: documentId, organizationId: org.id, kind: "Acknowledgment", isActive: true },
    include: {
      checkpoints: { orderBy: { orderIndex: "asc" } },
      versions: { where: { isCurrent: true }, take: 1 },
    },
  })
  const version = doc?.versions[0]
  if (!doc || !version) notFound()

  // ── Resolve the staff member being signed for ─────────────────────────────
  const selfStaff = await findStaffMemberForEmail(org.id, dbUser.email)
  const isManagerRole = dbUser.role === "ADMIN" || dbUser.role === "MANAGER"

  let staff = selfStaff
  let attested = false
  if (staffParam && staffParam !== selfStaff?.id) {
    // Manager-attested: same visibility rule as /staff/[id] — admins see all,
    // managers only staff in their own stores; everyone else gets notFound.
    if (!isManagerRole) notFound()
    const target = await prisma.staffMember.findFirst({
      where: { id: staffParam, organizationId: org.id },
      include: { storeAssignments: { include: { store: true } } },
    })
    if (!target) notFound()
    if (dbUser.role === "MANAGER") {
      const managerStoreIds = dbUser.storeAssignments.map((a) => a.storeId)
      if (!target.storeAssignments.some((a) => managerStoreIds.includes(a.storeId))) notFound()
    }
    staff = target
    attested = true
  }

  // Signed-in user with no matching staff profile: explain instead of 404 —
  // this is a data-setup miss, not a missing page.
  if (!staff) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center max-w-md px-6">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--color-muted)] flex items-center justify-center">
            <FileQuestion className="h-6 w-6 text-[var(--color-muted-foreground)]" />
          </div>
          <h1 className="text-lg font-semibold text-[var(--color-foreground)] mb-2">
            No staff profile linked
          </h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Signing requires a staff profile matching your email ({dbUser.email}). Ask a manager
            to set your email on your record in the staff directory, then try again.
          </p>
        </div>
      </div>
    )
  }

  const existing = await prisma.hrDocumentAcknowledgment.findMany({
    where: { hrDocumentVersionId: version.id, staffMemberId: staff.id },
    select: { checkpointId: true },
  })
  const doneIds = new Set(existing.map((a) => a.checkpointId))

  return (
    <AcknowledgeClient
      doc={{
        id: doc.id,
        title: doc.title,
        versionNumber: version.versionNumber,
        fileHash: version.fileHash,
        fileName: version.fileName,
      }}
      checkpoints={doc.checkpoints.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        pageRef: c.pageRef,
        attestationText: c.attestationText,
        required: c.required,
        done: doneIds.has(c.id),
      }))}
      mode={attested ? "attested" : "self"}
      staff={{ id: staff.id, name: staff.fullName ?? staff.displayName }}
    />
  )
}
