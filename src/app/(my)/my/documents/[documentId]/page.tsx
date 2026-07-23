import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getActiveStaffSelf } from "@/lib/auth"
import { SigningClient } from "@/app/(app)/hr/acknowledge/[documentId]/signing-client"
import { MyShell } from "../../my-shell"
import { MyDenied } from "../../denied"

// /my/documents/[documentId] — self-serve acknowledgment inside the staff
// portal. Same HR-4 capture engine and screen as /hr/acknowledge, reached
// without the admin shell (the /my redirect blocks that route for employee
// logins). Always self mode — attested capture lives on the manager side.
export default async function MyAcknowledgePage({
  params,
}: {
  params: Promise<{ documentId: string }>
}) {
  const self = await getActiveStaffSelf()
  if (!self.ok) return <MyDenied reason={self.reason} />
  const { staffMember, org } = self

  const { documentId } = await params
  const doc = await prisma.hrDocument.findFirst({
    where: { id: documentId, organizationId: org.id, kind: "Acknowledgment", isActive: true },
    include: {
      checkpoints: { orderBy: { orderIndex: "asc" } },
      versions: { where: { isCurrent: true }, take: 1 },
    },
  })
  const version = doc?.versions[0]
  if (!doc || !version) notFound()

  // HR-15 Policy B: resume state is per signing cycle — a rehire starts the
  // current version fresh; their prior-cycle acknowledgments stay on file.
  const existing = await prisma.hrDocumentAcknowledgment.findMany({
    where: {
      hrDocumentVersionId: version.id,
      staffMemberId: staffMember.id,
      signingCycle: staffMember.signingCycle,
    },
    select: { checkpointId: true },
  })
  const doneIds = new Set(existing.map((a) => a.checkpointId))

  return (
    <MyShell showInstagram={!!org.instagramEnabled && !!org.instagramAccessToken}>
      <SigningClient
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
        staff={{ id: staffMember.id, name: staffMember.fullName ?? staffMember.displayName }}
        backHref="/my/documents"
        backLabel="My Documents"
      />
    </MyShell>
  )
}
