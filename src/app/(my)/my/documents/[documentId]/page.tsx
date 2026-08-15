import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getActiveStaffSelf } from "@/lib/auth"
import { AUDIENCE_INCLUDE, grantedToStaff } from "@/lib/hr-documents-access"
import { getVersionAnchorReadiness } from "@/lib/hr-anchors"
import { SigningClient } from "@/app/(app)/hr/acknowledge/[documentId]/signing-client"
import { LegalNameRequired } from "@/components/hr/legal-name-required"
import { SigningUnavailable } from "@/components/hr/signing-unavailable"
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
      ...AUDIENCE_INCLUDE,
    },
  })
  const version = doc?.versions[0]
  if (!doc || !version) notFound()

  // DOC-1 A: always self mode here, so the subject is the caller's own staff
  // record — but the question is still grantedToStaff, not canReadHrDocument.
  // A document that does not reach you is indistinguishable from one that does
  // not exist, matching the line above.
  if (!grantedToStaff(doc, staffMember)) notFound()

  // ── HR-11j Item 4: LAYER (b) ON THE PATH IT WAS NEVER BUILT ON ────────────
  // The staff-portal ceremony. Same refusal as /hr/acknowledge, same predicate,
  // audience="signer" — this route is always self mode, so the viewer is the
  // person being asked to sign and gets the ruled signer copy, never the
  // manager variant.
  //
  // LAYER (b) WAS NOT BYPASSED HERE. IT WAS NEVER PRESENT. HR-11d built the
  // guard on /hr/acknowledge/[documentId] and its comment claimed it "covers
  // BOTH entry points" — true of self and attested WITHIN THAT FILE, and false
  // of this one, which lives in route group (my) and imports SigningClient
  // across the group boundary. So the signer in the 2026-08-14/15 reproduction
  // walked into the ceremony on unconfirmed v2, initialed four pages and signed
  // two, and only ensureSignedRecord (layer c) stopped the hollow record.
  //
  // AND NO SEARCH FOUND IT, WHICH IS THE REUSABLE PART. Grepping
  // isSigningBlocked or getVersionAnchorReadiness returned a CLEAN result —
  // one definition, correct callers, nothing out of place — because a missing
  // call site has nothing to match on. What found it was enumerating every
  // renderer of the shared ceremony CLIENT and checking each renderer. Written
  // into CLAUDE.md § Verifying a guard covers every path; same shape as the
  // DEBT-22 miss recorded a few lines below in this very file.
  const readiness = await getVersionAnchorReadiness(version.id)
  if (readiness.blocked) {
    return (
      <MyShell showInstagram={!!org.instagramEnabled && !!org.instagramAccessToken}>
        <SigningUnavailable
          audience="signer"
          documentId={doc.id}
          documentTitle={doc.title}
          matched={readiness.matched}
        />
      </MyShell>
    )
  }

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

  // R1 (Gary, 2026-08-15): SigningClient may only open its executed screen on a
  // record, and cannot see one from the browser. Same three keys as every other
  // R1 surface — version, staff member, current signing cycle.
  const signedRecordCount = await prisma.hrSignedRecord.count({
    where: {
      hrDocumentVersionId: version.id,
      staffMemberId: staffMember.id,
      signingCycle: staffMember.signingCycle,
    },
  })

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
        hasSignedRecord={signedRecordCount > 0}
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
