import Link from "next/link"
import { format } from "date-fns"
import { BookOpen, CheckCircle2, ChevronRight, FileText } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { getActiveStaffSelf } from "@/lib/auth"
import { Badge } from "@/components/ui/badge"
import { MyShell } from "../my-shell"
import { MyDenied } from "../denied"
import { requiredDocumentRows, type MyDocumentRow } from "./data"

// /my/documents — the staff member's own required sign-offs + the reference
// library. Read + complete only (rule 3): pending documents link to the
// acknowledgment flow, completed ones show status. No signed-PDF download
// exists here (rule 5) — a manager provides a copy on request.

function statusBadge(row: MyDocumentRow) {
  switch (row.status) {
    case "signed":
    case "pending-record":
      return <Badge variant="success">Signed</Badge>
    case "needs-current":
      return <Badge variant="warning">New version to sign</Badge>
    case "in-progress":
      return <Badge variant="info">{`In progress ${row.ackedCount}/${row.requiredCount}`}</Badge>
    default:
      return <Badge variant="secondary">Not started</Badge>
  }
}

export default async function MyDocumentsPage() {
  const self = await getActiveStaffSelf()
  if (!self.ok) return <MyDenied reason={self.reason} />
  const { staffMember, org } = self

  const [rows, referenceDocs] = await Promise.all([
    requiredDocumentRows(staffMember),
    prisma.hrDocument.findMany({
      where: { organizationId: org.id, kind: "Reference", isActive: true },
      select: { id: true, title: true, category: true },
      orderBy: { title: "asc" },
    }),
  ])

  const pending = rows.filter((r) => r.status !== "signed" && r.status !== "pending-record")
  const done = rows.filter((r) => r.status === "signed" || r.status === "pending-record")

  return (
    <MyShell>
      <h1 className="text-xl font-bold text-[var(--color-foreground)] mb-4">My Documents</h1>

      <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--color-muted-foreground)] mb-2">
        To sign
      </h2>
      {pending.length === 0 ? (
        <div className="border border-dashed border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-6 text-center mb-6">
          <CheckCircle2 className="h-6 w-6 mx-auto mb-2 text-[var(--color-success,#25ba3b)]" />
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {rows.length === 0 ? "Nothing needs your signature yet." : "All caught up — nothing to sign."}
          </p>
        </div>
      ) : (
        <div className="space-y-2 mb-6">
          {pending.map((row) => (
            <Link
              key={row.documentId}
              href={`/my/documents/${row.documentId}`}
              className="flex items-center gap-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4 min-h-11"
            >
              <FileText className="h-5 w-5 shrink-0 text-[var(--color-primary)]" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-[var(--color-foreground)] truncate">{row.title}</p>
                <div className="mt-1">{statusBadge(row)}</div>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-[var(--color-muted-foreground)]" />
            </Link>
          ))}
        </div>
      )}

      {done.length > 0 && (
        <>
          <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--color-muted-foreground)] mb-2">
            Completed
          </h2>
          <div className="space-y-2 mb-6">
            {done.map((row) => (
              <div
                key={row.documentId}
                className="flex items-center gap-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4"
              >
                <FileText className="h-5 w-5 shrink-0 text-[var(--color-muted-foreground)]" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-[var(--color-foreground)] truncate">{row.title}</p>
                  <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
                    Signed v{row.currentVersionNumber}
                    {row.completedAt && ` · ${format(new Date(row.completedAt), "MMM d, yyyy")}`} — need a
                    copy? Ask your manager.
                  </p>
                </div>
                {statusBadge(row)}
              </div>
            ))}
          </div>
        </>
      )}

      <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--color-muted-foreground)] mb-2">
        Library
      </h2>
      {referenceDocs.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">No reference documents yet.</p>
      ) : (
        <div className="space-y-2">
          {referenceDocs.map((doc) => (
            <a
              key={doc.id}
              href={`/api/hr/documents/${doc.id}/download`}
              target="_blank"
              rel="noopener"
              className="flex items-center gap-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4 min-h-11"
            >
              <BookOpen className="h-5 w-5 shrink-0 text-[var(--color-muted-foreground)]" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-[var(--color-foreground)] truncate">{doc.title}</p>
                {doc.category && (
                  <p className="text-xs text-[var(--color-muted-foreground)]">{doc.category}</p>
                )}
              </div>
            </a>
          ))}
        </div>
      )}
    </MyShell>
  )
}
