import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { ensureFormSignedPdf, SignedRecordError } from "@/lib/hr-signed-pdf"
import { requireHrDocumentAccess } from "../../../../documents/access"
import { loadScopedStaff } from "../../../shared"

// POST /api/hr/forms/submissions/[submissionId]/signed-pdf — recovery path:
// if the synchronous generator failed after completion, this (idempotently)
// produces the executed PDF. Same authorization as executing: ADMIN or
// store-scoped MANAGER. ensureFormSignedPdf refuses incomplete submissions,
// so this can never mint a record early.
export async function POST(_req: Request, { params }: { params: Promise<{ submissionId: string }> }) {
  const { submissionId } = await params
  const access = await requireHrDocumentAccess()
  if (!access.ok) return access.response
  const { org, dbUser } = access
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (dbUser.role !== "ADMIN" && dbUser.role !== "MANAGER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const submission = await prisma.formSubmission.findUnique({
    where: { id: submissionId },
    include: { version: { include: { hrDocument: { select: { organizationId: true } } } } },
  })
  if (!submission || submission.version.hrDocument.organizationId !== org.id) {
    return NextResponse.json({ error: "Submission not found" }, { status: 404 })
  }
  const staff = await loadScopedStaff(org.id, submission.staffMemberId, dbUser)
  if (!staff) return NextResponse.json({ error: "Submission not found" }, { status: 404 })

  try {
    const record = await ensureFormSignedPdf(submission.id)
    return NextResponse.json({ id: record.id }, { status: 201 })
  } catch (err) {
    if (err instanceof SignedRecordError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    throw err
  }
}
