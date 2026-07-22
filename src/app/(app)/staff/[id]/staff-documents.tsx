"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { Download, FileText, PenLine, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  HR_CATEGORY_LABELS,
  HR_CATEGORY_STYLES,
  type HrDocumentCategory,
} from "@/lib/hr-documents"

// One row per required Acknowledgment document for this staff member, with
// the version-pinned status: a signed record binds to the version it was
// signed against, so a re-upload flips status to "Needs current version"
// while the old record stays downloadable.
export interface StaffDocumentRow {
  documentId: string
  title: string
  category: string
  currentVersionNumber: number
  status: "signed" | "pending-record" | "needs-current" | "in-progress" | "not-started"
  signedVersionNumber: number | null
  completedAt: string | null
  signedRecordId: string | null // current-version record, or the prior-version one for needs-current
  ackedCount: number
  requiredCount: number
}

const STATUS_STYLES: Record<StaffDocumentRow["status"], string> = {
  signed: "bg-green-100 text-green-700 border border-green-200",
  "pending-record": "bg-green-100 text-green-700 border border-green-200",
  "needs-current": "bg-amber-100 text-amber-700 border border-amber-200",
  "in-progress": "bg-blue-100 text-blue-700 border border-blue-200",
  "not-started": "bg-gray-100 text-gray-600 border border-gray-200",
}

function statusLabel(row: StaffDocumentRow): string {
  switch (row.status) {
    case "signed":
      return `Signed v${row.signedVersionNumber}${row.completedAt ? ` · ${format(new Date(row.completedAt), "MMM d, yyyy")}` : ""}`
    case "pending-record":
      return `Signed v${row.signedVersionNumber} · record pending`
    case "needs-current":
      return "Needs current version"
    case "in-progress":
      return `In progress · ${row.ackedCount}/${row.requiredCount}`
    case "not-started":
      return "Not started"
  }
}

export function StaffDocuments({ staffId, rows }: { staffId: string; rows: StaffDocumentRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="border border-dashed border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-12 text-center">
        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-[var(--color-muted)] flex items-center justify-center">
          <FileText className="h-6 w-6 text-[var(--color-muted-foreground)]" />
        </div>
        <p className="font-medium text-[var(--color-foreground)] mb-1">No documents to sign</p>
        <p className="text-sm text-[var(--color-muted-foreground)] max-w-md mx-auto">
          Signature documents added to the Document Library that apply to this team member&apos;s
          stores will appear here with their acknowledgment status.
        </p>
      </div>
    )
  }

  return (
    <div className="border border-[var(--color-border)] rounded-lg divide-y divide-[var(--color-border)] bg-[var(--color-card)]">
      {rows.map((row) => (
        <div key={row.documentId} className="flex items-center gap-4 p-4 flex-wrap">
          <div className="w-9 h-9 rounded-lg bg-[var(--color-primary)]/10 flex items-center justify-center shrink-0">
            <FileText className="h-4 w-4 text-[var(--color-primary)]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium text-[var(--color-foreground)] truncate">{row.title}</p>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${HR_CATEGORY_STYLES[row.category as HrDocumentCategory] ?? HR_CATEGORY_STYLES.Other}`}>
                {HR_CATEGORY_LABELS[row.category as HrDocumentCategory] ?? row.category}
              </span>
            </div>
            <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
              Current version v{row.currentVersionNumber}
              {row.status === "needs-current" && row.signedVersionNumber != null && (
                <> · signed v{row.signedVersionNumber}</>
              )}
            </p>
          </div>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium shrink-0 ${STATUS_STYLES[row.status]}`}>
            {statusLabel(row)}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {row.signedRecordId && (
              <a
                href={`/api/hr/signed-records/${row.signedRecordId}/download`}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)] hover:opacity-80 transition-opacity"
                title={
                  row.status === "needs-current"
                    ? `Signed record for v${row.signedVersionNumber}`
                    : "Download signed record"
                }
              >
                <Download className="h-4 w-4" />
                Signed record
              </a>
            )}
            {row.status === "pending-record" && (
              <GenerateRecordButton documentId={row.documentId} staffId={staffId} />
            )}
            {(row.status === "not-started" || row.status === "in-progress" || row.status === "needs-current") && (
              <Link
                href={`/hr/acknowledge/${row.documentId}?staff=${staffId}`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)] hover:opacity-80 transition-opacity"
              >
                <PenLine className="h-4 w-4" />
                Record
              </Link>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// Recovery for the rare case where every checkpoint was captured but the
// synchronous PDF generation failed — idempotent on the API side.
function GenerateRecordButton({ documentId, staffId }: { documentId: string; staffId: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const router = useRouter()

  async function handleGenerate() {
    setBusy(true)
    setError("")
    try {
      const res = await fetch(`/api/hr/documents/${documentId}/signed-record`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffMemberId: staffId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Failed to generate the record")
        return
      }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={handleGenerate} disabled={busy}>
        <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
        {busy ? "Generating..." : "Generate record"}
      </Button>
      {error && <span className="text-xs text-[var(--color-destructive)]">{error}</span>}
    </span>
  )
}
