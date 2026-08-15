import { auth } from "@clerk/nextjs/server"
import { notFound, redirect } from "next/navigation"
import { FileQuestion } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hrModuleAvailable } from "@/lib/auth"
import { findStaffMemberForUser } from "@/lib/hr"
import { AUDIENCE_INCLUDE, grantedToStaff } from "@/lib/hr-documents-access"
import { getVersionAnchorReadiness } from "@/lib/hr-anchors"
import { LegalNameRequired } from "@/components/hr/legal-name-required"
import { SigningUnavailable } from "@/components/hr/signing-unavailable"
import { AcknowledgeClient } from "./acknowledge-client"
import { SigningClient } from "./signing-client"

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
      ...AUDIENCE_INCLUDE,
    },
  })
  const version = doc?.versions[0]
  if (!doc || !version) notFound()

  // ── Resolve the staff member being signed for ─────────────────────────────
  const selfStaff = await findStaffMemberForUser(org.id, dbUser)
  const isManagerRole = dbUser.role === "ADMIN" || dbUser.role === "MANAGER"

  let staff = selfStaff
  let attested = false
  if (staffParam && staffParam !== selfStaff?.id) {
    // Manager-attested: same visibility rule as /staff/[id] — admins see all,
    // managers only staff in their own stores; everyone else gets notFound.
    if (!isManagerRole) notFound()
    const target = await prisma.staffMember.findFirst({
      where: { id: staffParam, organizationId: org.id },
      include: {
        storeAssignments: {
          include: { store: true },
          // DEBT-22: the standard ordering every other storeAssignments load
          // uses. This array reaches signing-client.tsx:91, which pre-selects
          // `find(isPrimary) ?? stores[0]`; unordered, a staff member with no
          // primary gets an arbitrary chip. Cosmetic only — the persisted value
          // is recomputed server-side from its own ordered query
          // (acknowledgments/route.ts:94-102) — but this was the last unordered
          // storeAssignments load in the codebase.
          orderBy: [{ isPrimary: "desc" }, { store: { name: "asc" } }],
        },
      },
    })
    if (!target) notFound()
    if (dbUser.role === "MANAGER") {
      const managerStoreIds = dbUser.storeAssignments.map((a) => a.storeId)
      if (!target.storeAssignments.some((a) => managerStoreIds.includes(a.storeId))) notFound()
    }
    staff = target
    attested = true
  }

  // DOC-1 A, ruling 4: THE DOCUMENT MUST REACH THE STAFF MEMBER BEING SIGNED
  // FOR — never the person holding the browser. The manager-scope test above
  // answers "may this manager act for this person"; it says nothing about
  // whether the document was ever assigned to them, and before this phase
  // nothing asked. On the attested branch `staff` is the TARGET, so this one
  // check covers both entry points with the right subject in each.
  //
  // notFound() rather than a refusal page, matching the missing-document case
  // three lines up: a document that does not reach you should not be
  // distinguishable from one that does not exist.
  if (staff && !grantedToStaff(doc, staff)) notFound()

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

  // ── HR-11d 2b, layer (b): REFUSE TO START THE CEREMONY ────────────────────
  // The load-bearing layer (R3(i), Gary 2026-08-14). The version has detected
  // fields and none are confirmed, so completing this ceremony would mint a
  // record that claims completion and stamps nothing. Failing at mint-time
  // instead would refuse a signer who has just typed 27 sets of initials.
  //
  // This is a DOCUMENT-state refusal, not a permission one, so it renders an
  // explanation rather than notFound() — and it covers BOTH entry points,
  // because manager-attested capture completes through the same
  // ensureSignedRecord call and would hit the same backstop.
  //
  // ── CORRECTED 2026-08-15 (HR-11j Item 4). "BOTH entry points" MEANT BOTH
  // MODES OF THIS FILE — self and attested — AND WAS READ AS BOTH CEREMONIES.
  // There is a third: /my/documents/[documentId], the staff portal, which
  // imports SigningClient across the (my)/(app) route-group boundary and had no
  // readiness call at all. That is the route the reproduction's signer used. It
  // now carries this same guard. The sentence above is left standing because it
  // is what was believed, and because the way it misleads is the finding: a
  // count of entry points taken from inside one file cannot see the importers
  // outside it.
  //
  // ── SUPERSEDED 2026-08-15 BY R4 (Gary). The paragraph below is kept, not
  // deleted (CLAUDE.md — corrections prepend with dates), because it is an
  // accurate statement of the HR-11d §2b carve-out and that carve-out is what
  // R4 overturns by name.
  //
  // THE GUARD IS NOW AT THE GRANT AS WELL. PUT /api/hr/documents/[id]/audience
  // asks this same predicate about the current version and refuses to give an
  // unconfirmed document an audience at all — so what an admin cannot do is
  // assign it in the first place. This layer stays regardless: R4 makes the
  // state rare, not impossible (a new version uploaded under a live grant
  // reaches it), and the ceremony must still refuse when it happens.
  //
  //   [SUPERSEDED 2026-08-15 — R4 moved the guard upstream to the grant]
  //   THE GUARD IS AT THE CEREMONY, NEVER AT THE GRANT. Assigning an
  //   unconfirmed document to the whole company still works exactly as before
  //   (DOC-1 audience modal, untouched by this phase) — what an admin cannot do
  //   is have someone sign it.
  const readiness = await getVersionAnchorReadiness(version.id)
  if (readiness.blocked) {
    return (
      <SigningUnavailable
        documentId={doc.id}
        documentTitle={doc.title}
        // The ruled signer copy is "ask your manager" — which reads as nonsense
        // to the manager who IS standing there. On the attested path the viewer
        // is an ADMIN or MANAGER (checked above), so they get the actionable
        // version and a link to the screen that fixes it.
        audience={attested ? "manager" : "signer"}
        confirmHref={attested ? `/hr/documents/${doc.id}` : undefined}
        matched={readiness.matched}
      />
    )
  }

  // HR-15 Policy B: resume state is per signing cycle — a rehire starts the
  // current version fresh; their prior-cycle acknowledgments stay on file.
  const existing = await prisma.hrDocumentAcknowledgment.findMany({
    where: { hrDocumentVersionId: version.id, staffMemberId: staff.id, signingCycle: staff.signingCycle },
    select: { checkpointId: true },
  })
  const doneIds = new Set(existing.map((a) => a.checkpointId))

  // R1 (Gary, 2026-08-15): the ceremony clients decided completion from the
  // `done` flags above, which are acknowledgment rows. They now need the record
  // itself, and only the server can see it. Keyed the same three ways every
  // other R1 surface keys it — version, staff member, CURRENT signing cycle
  // (HR-15 Policy B) — so a rehire's prior-tenure record cannot open the
  // executed screen for this tenure.
  const signedRecordCount = await prisma.hrSignedRecord.count({
    where: {
      hrDocumentVersionId: version.id,
      staffMemberId: staff.id,
      signingCycle: staff.signingCycle,
    },
  })
  const hasSignedRecord = signedRecordCount > 0

  const clientDoc = {
    id: doc.id,
    title: doc.title,
    versionNumber: version.versionNumber,
    fileHash: version.fileHash,
    fileName: version.fileName,
  }
  const clientCheckpoints = doc.checkpoints.map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    pageRef: c.pageRef,
    attestationText: c.attestationText,
    required: c.required,
    done: doneIds.has(c.id),
  }))
  // Legal identity gate: no Full Name → no signing (admins/managers land here
  // with a link to set it).
  if (!staff.fullName?.trim()) {
    return <LegalNameRequired staffName={staff.displayName} manageHref={`/staff/${staff.id}`} />
  }
  const clientStaff = {
    id: staff.id,
    name: staff.fullName.trim(),
    isCorporate: staff.isCorporate,
    stores: staff.storeAssignments.map((a) => ({
      id: a.storeId,
      name: a.store.name,
      isPrimary: a.isPrimary,
    })),
  }
  // Confirmed anchors → inline affordance + identity-chip placement in the ceremony.
  const clientAnchors = await prisma.documentAnchor.findMany({
    where: { hrDocumentVersionId: version.id, confirmed: true },
    select: { page: true, x: true, y: true, width: true, placement: true, markType: true, generatedCheckpointId: true },
  })

  // HR-11: self-serve signing uses the formal inline ceremony; manager-attested
  // capture keeps the quick form — it records, it doesn't sign.
  return attested ? (
    <AcknowledgeClient
      doc={clientDoc}
      checkpoints={clientCheckpoints}
      hasSignedRecord={hasSignedRecord}
      mode="attested"
      staff={clientStaff}
    />
  ) : (
    <SigningClient
      doc={clientDoc}
      checkpoints={clientCheckpoints}
      hasSignedRecord={hasSignedRecord}
      staff={clientStaff}
      anchors={clientAnchors}
    />
  )
}
