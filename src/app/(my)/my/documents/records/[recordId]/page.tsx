import Link from "next/link"
import { notFound } from "next/navigation"
import { format } from "date-fns"
import { ArrowLeft, ShieldCheck } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { getActiveStaffSelf } from "@/lib/auth"
import { PdfViewer } from "@/components/hr/pdf-viewer"
import { MyShell } from "../../../my-shell"
import { MyDenied } from "../../../denied"

// /my/documents/records/[recordId] — STAFF-1 (F4): inline, view-only render of
// the staff member's OWN executed signed record. Canvas render via the shared
// viewer; deliberately no download affordance (download stays ADMIN/MANAGER).
export default async function MySignedRecordPage({
  params,
}: {
  params: Promise<{ recordId: string }>
}) {
  const self = await getActiveStaffSelf()
  if (!self.ok) return <MyDenied reason={self.reason} />
  const { org, staffMember } = self

  const { recordId } = await params
  const record = await prisma.hrSignedRecord.findUnique({
    where: { id: recordId },
    include: {
      version: {
        select: {
          versionNumber: true,
          hrDocument: { select: { title: true, organizationId: true } },
        },
      },
    },
  })
  if (
    !record ||
    record.version.hrDocument.organizationId !== org.id ||
    record.staffMemberId !== staffMember.id
  ) {
    notFound()
  }

  return (
    <MyShell showInstagram={!!org.instagramEnabled && !!org.instagramAccessToken}>
      <Link
        href="/my/documents"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        My Documents
      </Link>

      <div className="mb-4">
        <h1 className="text-xl font-bold text-[var(--color-foreground)]">
          {record.version.hrDocument.title}
        </h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Version {record.version.versionNumber} · signed{" "}
          {format(record.completedAt, "MMMM d, yyyy · h:mm a")}
        </p>
        <p className="inline-flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)] mt-2">
          <ShieldCheck className="h-3.5 w-3.5 text-[var(--color-primary)]" />
          View only — need a copy? Ask your manager.
        </p>
      </div>

      <PdfViewer src={`/api/my/signed-records/${record.id}`} />
    </MyShell>
  )
}
