import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getActiveStaffSelf } from "@/lib/auth"
import { SigningClient } from "@/app/(app)/hr/acknowledge/[documentId]/signing-client"
import { LegalNameRequired } from "@/components/hr/legal-name-required"
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

  // Assigned stores for the store selector (getActiveStaffSelf doesn't join names).
  const assignedStores = await prisma.store.findMany({
    where: { id: { in: staffMember.storeAssignments.map((a) => a.storeId) } },
    select: { id: true, name: true },
  })
  const primaryStoreIds = new Set(
    staffMember.storeAssignments.filter((a) => a.isPrimary).map((a) => a.storeId)
  )
  // DEBT-9: sorted isPrimary-desc-then-name-asc, the same comparator
  // primaryStoreName() uses internally. signing-client.tsx pre-selects
  // `find(isPrimary) ?? stores[0]`, and that selection is submitted verbatim and
  // FROZEN into the signed record — so for a staff member with 2+ assignments
  // and no primary, an unordered array meant the stamped store was whatever
  // Postgres returned first, and could differ between two loads of the same page.
  //
  // WHY DEBT-22 MISSED THIS, which is the reusable part: DEBT-22 swept the
  // codebase for unordered `storeAssignments` loads and correctly reported it
  // had fixed the last one. This is not a storeAssignments load. It is a STORE
  // load keyed by assignment ids (getActiveStaffSelf doesn't join store names),
  // so the grep pattern that found every other instance could not match it. A
  // sweep is only as complete as the shape it searches for.
  const stores = assignedStores
    .map((s) => ({ id: s.id, name: s.name, isPrimary: primaryStoreIds.has(s.id) }))
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name))
  // Confirmed anchors → inline affordance + identity-chip placement.
  const clientAnchors = await prisma.documentAnchor.findMany({
    where: { hrDocumentVersionId: version.id, confirmed: true },
    select: { page: true, x: true, y: true, width: true, placement: true, markType: true, generatedCheckpointId: true },
  })

  // Legal identity gate: signed documents carry the Full Name only. Staff can't
  // set it themselves, so send them to their admin.
  if (!staffMember.fullName?.trim()) {
    return (
      <MyShell showInstagram={!!org.instagramEnabled && !!org.instagramAccessToken}>
        <LegalNameRequired staffName={staffMember.displayName} />
      </MyShell>
    )
  }

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
        staff={{
          id: staffMember.id,
          name: staffMember.fullName.trim(),
          isCorporate: staffMember.isCorporate,
          stores,
        }}
        anchors={clientAnchors}
        backHref="/my/documents"
        backLabel="My Documents"
      />
    </MyShell>
  )
}
