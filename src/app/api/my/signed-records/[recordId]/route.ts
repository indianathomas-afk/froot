import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getActiveStaffSelf } from "@/lib/auth"
import { getHrFileDownloadUrl } from "@/lib/hr-files"

// GET /api/my/signed-records/[recordId] — STAFF-1 (F4, Gary-approved scoped
// amendment of HR-7 rule 5): an ACTIVE, linked staff member may VIEW their own
// executed signed records inline. Delivery is a same-origin byte stream with
// inline disposition feeding the in-page canvas viewer — no download
// affordance anywhere in the staff UI; the ADMIN/MANAGER-only download route
// is unchanged. Access ends at termination: getActiveStaffSelf enforces
// status=ACTIVE on every request, same as every /my surface.
export async function GET(_req: Request, { params }: { params: Promise<{ recordId: string }> }) {
  const { recordId } = await params
  const self = await getActiveStaffSelf()
  if (!self.ok) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const { org, staffMember } = self

  const record = await prisma.hrSignedRecord.findUnique({
    where: { id: recordId },
    include: {
      version: { select: { fileName: true, hrDocument: { select: { organizationId: true } } } },
    },
  })
  // Own records only. Cross-org, unknown, or someone else's → 404, never 403.
  if (
    !record ||
    record.version.hrDocument.organizationId !== org.id ||
    record.staffMemberId !== staffMember.id
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  // Sign server-side and proxy the bytes — the signed URL itself is never
  // handed to the client (a copyable signed URL would be a download link).
  const signedUrl = await getHrFileDownloadUrl(record.signedPdfPathname)
  const upstream = await fetch(signedUrl)
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Record file unavailable" }, { status: 502 })
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
    },
  })
}
