import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getHrFileDownloadUrl } from "@/lib/hr-files"
import { ensureTrainingCertPdf, SignedRecordError } from "@/lib/hr-signed-pdf"
import { findManageableStaffMember, requireHrTrainingManageAccess } from "../../../access"

// GET /api/hr/training/assignments/[id]/certificate — authorized delivery of
// the signed training-certificate PDF. Rule 5: ADMIN / in-scope MANAGER only —
// staff (including the trainee) never download signed records; a manager
// provides a copy on request. Regenerates idempotently if the co-sign landed
// but the PDF upload previously failed.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHrTrainingManageAccess()
  if (!access.ok) return access.response

  const { id } = await params
  let assignment = await prisma.trainingAssignment.findFirst({
    where: { id, trainingModule: { organizationId: access.org.id } },
  })
  // Cross-org or unknown IDs 404 — don't leak existence.
  if (!assignment) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const member = await findManageableStaffMember(assignment.staffMemberId, access)
  if (!member) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (!assignment.certifiedAt) {
    return NextResponse.json({ error: "Not certified yet" }, { status: 404 })
  }
  if (!assignment.certPdfPathname) {
    try {
      assignment = await ensureTrainingCertPdf(assignment.id)
    } catch (err) {
      const msg = err instanceof SignedRecordError ? err.message : "Certificate unavailable"
      return NextResponse.json({ error: msg }, { status: 500 })
    }
  }

  const signedUrl = await getHrFileDownloadUrl(assignment.certPdfPathname!)
  return NextResponse.redirect(signedUrl, 307)
}
