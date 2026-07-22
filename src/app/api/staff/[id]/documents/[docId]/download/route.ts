import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getActiveStaffSelf } from "@/lib/auth"
import { getHrFileDownloadUrl } from "@/lib/hr-files"
import { requireManageableStaff } from "../../../../access"

// GET /api/staff/[id]/documents/[docId]/download — authorized delivery of a
// manager-uploaded staff document. Two tiers:
//   • ADMIN / in-scope MANAGER — always.
//   • the owning ACTIVE staff member — only when visibleToStaff is true.
// Anyone else (including staff for a not-visible doc) gets 404, not a hint the
// file exists. The blob is private; without this route's short-lived signed
// URL the bytes aren't fetchable.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params

  const doc = await prisma.staffDocument.findFirst({
    where: { id: docId, staffMemberId: id },
    select: { filePathname: true, staffMemberId: true, organizationId: true, visibleToStaff: true },
  })

  // Manager/admin path first.
  const access = await requireManageableStaff(id)
  if (access.ok) {
    if (!doc || doc.organizationId !== access.org.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    return NextResponse.redirect(await getHrFileDownloadUrl(doc.filePathname), 307)
  }

  // Staff-self path: only the owning active member, only if the doc is shared.
  const self = await getActiveStaffSelf()
  if (
    !self.ok ||
    !doc ||
    doc.organizationId !== self.org.id ||
    doc.staffMemberId !== self.staffMember.id ||
    !doc.visibleToStaff
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return NextResponse.redirect(await getHrFileDownloadUrl(doc.filePathname), 307)
}
