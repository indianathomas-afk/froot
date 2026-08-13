import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { findStaffMemberForUser } from "@/lib/hr"
import { ensureSignedRecord, SignedRecordError } from "@/lib/hr-signed-pdf"
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

  if (staffMemberId !== selfStaff?.id) {
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
    if (err instanceof SignedRecordError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    throw err
  }
}
