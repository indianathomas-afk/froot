import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { canReadHrSignedRecord, getHrFileDownloadUrl } from "@/lib/hr-files"
import { requireHrDocumentAccess } from "../../../../documents/access"

// GET /api/hr/forms/submissions/[submissionId]/download — authorized delivery
// of an executed form PDF. Exactly the signed-record tier, enforced by the
// same policy function and tightened by HR-7 rule 5: ADMIN or in-scope
// MANAGER only — the owning staff member no longer self-downloads; a manager
// provides a copy on request. The stored blob is private — without this route
// (or its short-lived signed URL) the bytes are not fetchable.
export async function GET(_req: Request, { params }: { params: Promise<{ submissionId: string }> }) {
  const { submissionId } = await params
  const access = await requireHrDocumentAccess()
  if (!access.ok) return access.response
  const { org, dbUser } = access

  const submission = await prisma.formSubmission.findUnique({
    where: { id: submissionId },
    include: {
      version: { include: { hrDocument: { select: { organizationId: true } } } },
      staffMember: { select: { storeAssignments: { select: { storeId: true } } } },
    },
  })
  // Cross-org or unknown IDs 404 rather than 403 — don't leak existence.
  if (!submission || submission.version.hrDocument.organizationId !== org.id) {
    return NextResponse.json({ error: "Record not found" }, { status: 404 })
  }

  const allowed = canReadHrSignedRecord(
    {
      organizationId: submission.version.hrDocument.organizationId,
      staffMemberId: submission.staffMemberId,
      staffStoreIds: submission.staffMember.storeAssignments.map((a) => a.storeId),
    },
    {
      orgDbId: org.id,
      role: dbUser?.role ?? null,
      storeIds: dbUser?.storeAssignments.map((a) => a.storeId) ?? [],
    }
  )
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  if (!submission.signedPdfPathname) {
    return NextResponse.json(
      { error: "The signed PDF has not been generated yet" },
      { status: 409 }
    )
  }

  const signedUrl = await getHrFileDownloadUrl(submission.signedPdfPathname)
  return NextResponse.redirect(signedUrl, 307)
}
