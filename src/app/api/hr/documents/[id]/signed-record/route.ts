import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { findStaffMemberForUser } from "@/lib/hr"
import {
  ensureSignedRecord,
  SignedRecordError,
  UnconfirmedAnchorsError,
} from "@/lib/hr-signed-pdf"
import { AUDIENCE_INCLUDE, grantedToStaff } from "@/lib/hr-documents-access"
import { requireHrDocumentAccess } from "../../access"

const bodySchema = z.object({
  staffMemberId: z.string().min(1).optional(),
})

// POST /api/hr/documents/[id]/signed-record — recovery path: if the
// synchronous generator failed after the last checkpoint was captured, this
// (idempotently) produces the signed PDF for the CURRENT version. Same
// authorization as recording: self, or ADMIN / store-scoped MANAGER for the
// named staff member. ensureSignedRecord refuses incomplete checkpoint sets,
// so this can never mint a record early.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const access = await requireHrDocumentAccess()
  if (!access.ok) return access.response
  const { org, dbUser } = access
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  // NO isActive FILTER, AND THAT IS A RULING RATHER THAN AN OVERSIGHT (Gary,
  // 2026-08-12, DOC-1 B audit). Every other document read path in the codebase
  // narrows on isActive; this one deliberately does not.
  //
  // This route only ever runs after a person has completed the entire required
  // checkpoint set — ensureSignedRecord refuses an incomplete one, so nothing
  // can be minted early. Adding the filter would mean: someone signs everything,
  // the synchronous PDF generator fails, an admin archives the document, and
  // their completed signature can now never become its artifact. That is the
  // opposite of the ruling that completed signed records are permanent.
  // Archiving is a VISIBILITY decision; it must not reach backwards into
  // signatures already given.
  const doc = await prisma.hrDocument.findFirst({
    where: { id, organizationId: org.id, kind: "Acknowledgment" },
    include: { versions: { where: { isCurrent: true }, take: 1 }, ...AUDIENCE_INCLUDE },
  })
  const version = doc?.versions[0]
  if (!doc || !version) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 })
  }

  // Same resolution as everywhere else: userId link first, email fallback.
  const selfStaff = await findStaffMemberForUser(org.id, dbUser)
  const staffMemberId = parsed.data.staffMemberId ?? selfStaff?.id
  if (!staffMemberId) {
    return NextResponse.json({ error: "No staff profile is linked to your account" }, { status: 403 })
  }

  // DOC-1 A: the subject is loaded ONCE, up front, in one fixed shape. It used
  // to be fetched only inside the MANAGER branch, which meant an ADMIN passing
  // an unknown id fell through to ensureSignedRecord and failed there instead
  // of 404-ing here. The audience test below needs it on every path anyway.
  const subject = await prisma.staffMember.findFirst({
    where: { id: staffMemberId, organizationId: org.id },
    select: { id: true, isCorporate: true, storeAssignments: { select: { storeId: true } } },
  })
  if (!subject) {
    return NextResponse.json({ error: "Staff member not found" }, { status: 404 })
  }

  // R4 addition (Gary, 2026-08-15): the ONE fact the refusal copy branches on,
  // named here rather than recomputed in the catch. It is the same test the
  // permission check below already makes — acting on your own record, or on
  // someone else's — so the copy cannot disagree with the authorization about
  // who the caller is.
  const actingForSelf = staffMemberId === selfStaff?.id

  if (!actingForSelf) {
    if (dbUser.role !== "ADMIN" && dbUser.role !== "MANAGER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    if (dbUser.role === "MANAGER") {
      const managerStoreIds = dbUser.storeAssignments.map((a) => a.storeId)
      if (!subject.storeAssignments.some((a) => managerStoreIds.includes(a.storeId))) {
        return NextResponse.json({ error: "Staff member not found" }, { status: 404 })
      }
    }
  }

  // Ruling 4, same subject rule as the capture route: the document must reach
  // the STAFF MEMBER the record is being minted for. ensureSignedRecord refuses
  // an incomplete checkpoint set, so this cannot mint anything early — but
  // without it, a grant revoked after signing would still let this path
  // generate the artifact, and the artifact is permanent.
  if (!grantedToStaff(doc, subject)) {
    return NextResponse.json(
      { error: "This document is not assigned to this team member" },
      { status: 403 }
    )
  }

  try {
    const record = await ensureSignedRecord(version.id, staffMemberId)
    return NextResponse.json({ id: record.id }, { status: 201 })
  } catch (err) {
    // HR-11d 2b/2c: this route can be called BY THE SIGNER for themselves, so
    // the guard's refusal must not arrive as a raw internal message. Gary's
    // signer-facing copy, exact — nothing implying they did something wrong,
    // because the outstanding task is an admin's. `signingUnavailable` lets a
    // caller tell this apart from an incomplete checkpoint set without parsing
    // prose.
    //
    // ── BRANCHED 2026-08-15 (Gary, R4 addition) ──────────────────────────────
    // It used to return the signer copy to EVERY caller, and the only surface
    // that renders it is the admin-facing Generate-record button on
    // /staff/[id] — so in practice "ask your manager" was told to the manager,
    // who is the person who has to act. That is the Q2 collision one layer
    // below the display surfaces: fixing it on the five surfaces and leaving it
    // here would have been fixing five of six.
    //
    // The signer path keeps the RULED VERBATIM copy, untouched. The admin path
    // gets the actionable variant plus `confirmHref` — the same field name
    // SigningUnavailable already uses for exactly this affordance, so the
    // caller reuses that component's prop rather than inventing a second way to
    // point at the same screen.
    if (err instanceof UnconfirmedAnchorsError) {
      return NextResponse.json(
        actingForSelf
          ? {
              error: "This document isn't available yet — ask your manager.",
              signingUnavailable: true,
            }
          : {
              error:
                "This document's fields aren't confirmed yet. Confirm them, then generate the record.",
              signingUnavailable: true,
              confirmHref: `/hr/documents/${doc.id}`,
            },
        { status: 409 }
      )
    }
    if (err instanceof SignedRecordError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    throw err
  }
}
