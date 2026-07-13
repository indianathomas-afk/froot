import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { canReadHrSignedRecord, getHrFileDownloadUrl } from "@/lib/hr-files"
import { findStaffMemberForEmail } from "@/lib/hr"
import { requireHrDocumentAccess } from "../../../documents/access"

// GET /api/hr/signed-records/[id]/download — authorized delivery of an
// executed signed-record PDF. The sensitive tier: ADMIN, in-scope MANAGER, or
// the owning staff member only. The stored blob is private — without this
// route (or its short-lived signed URL) the bytes are not fetchable.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const access = await requireHrDocumentAccess()
  if (!access.ok) return access.response
  const { org, dbUser } = access

  const record = await prisma.hrSignedRecord.findUnique({
    where: { id },
    include: {
      version: { include: { hrDocument: { select: { organizationId: true } } } },
      staffMember: { select: { storeAssignments: { select: { storeId: true } } } },
    },
  })
  // Cross-org or unknown IDs 404 rather than 403 — don't leak existence.
  if (!record || record.version.hrDocument.organizationId !== org.id) {
    return NextResponse.json({ error: "Record not found" }, { status: 404 })
  }

  const ownStaff = await findStaffMemberForEmail(org.id, dbUser?.email)
  const allowed = canReadHrSignedRecord(
    {
      organizationId: record.version.hrDocument.organizationId,
      staffMemberId: record.staffMemberId,
      staffStoreIds: record.staffMember.storeAssignments.map((a) => a.storeId),
    },
    {
      orgDbId: org.id,
      role: dbUser?.role ?? null,
      storeIds: dbUser?.storeAssignments.map((a) => a.storeId) ?? [],
      ownStaffMemberId: ownStaff?.id ?? null,
    }
  )
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const signedUrl = await getHrFileDownloadUrl(record.signedPdfPathname)
  return NextResponse.redirect(signedUrl, 307)
}
