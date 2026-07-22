"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { Download, FileSignature, PenLine, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  FORM_STATUS_LABELS,
  FORM_STATUS_STYLES,
  HR_CATEGORY_LABELS,
  HR_CATEGORY_STYLES,
  type FormSubmissionStatus,
  type HrDocumentCategory,
} from "@/lib/hr-documents"

// HR-5: the staff member's agreement forms — every applicable FillableForm
// with the FULL chronological submission history (re-execution is routine:
// keys get re-issued, pay changes). Linked Check-Out ↔ Check-In pairs are
// grouped into one card with each side's status. Executed PDFs download
// through the authorized submission route; archived forms with history keep
// their records visible (execution disabled).

export interface StaffFormSubRow {
  id: string
  status: string
  versionNumber: number
  employeeSignedAt: string | null
  supervisorSignedAt: string | null
  hasPdf: boolean
}

export interface StaffFormDocRow {
  documentId: string
  title: string
  category: string
  linkedFormId: string | null
  active: boolean
  submissions: StaffFormSubRow[] // newest first
}

function statusPhrase(form: StaffFormDocRow): string {
  const latest = form.submissions[0]
  if (!latest) return "not started"
  if (latest.status === "Completed") {
    const at = latest.supervisorSignedAt ?? latest.employeeSignedAt
    return at ? `signed ${format(new Date(at), "M/d")}` : "signed"
  }
  return "pending countersign"
}

export function StaffFormDocuments({ staffId, rows }: { staffId: string; rows: StaffFormDocRow[] }) {
  // Group linked pairs once (either direction); singles stand alone.
  const byId = new Map(rows.map((r) => [r.documentId, r]))
  const seen = new Set<string>()
  const groups: StaffFormDocRow[][] = []
  for (const row of rows) {
    if (seen.has(row.documentId)) continue
    seen.add(row.documentId)
    const partner = row.linkedFormId ? byId.get(row.linkedFormId) : undefined
    if (partner && !seen.has(partner.documentId)) {
      seen.add(partner.documentId)
      groups.push([row, partner])
    } else {
      groups.push([row])
    }
  }

  return (
    <div>
      <h2 className="text-sm font-semibold text-[var(--color-muted-foreground)] uppercase tracking-wide mb-3">
        Agreement Forms
      </h2>
      <div className="space-y-4">
        {groups.map((group) => (
          <div
            key={group.map((g) => g.documentId).join(":")}
            className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)]"
          >
            {group.length === 2 && (
              <div className="px-4 py-2.5 border-b border-[var(--color-border)] flex items-center gap-2 flex-wrap">
                <FileSignature className="h-4 w-4 text-[var(--color-primary)] shrink-0" />
                <p className="text-xs font-medium text-[var(--color-muted-foreground)]">
                  {group[0].title} {statusPhrase(group[0])} · {group[1].title} {statusPhrase(group[1])}
                </p>
              </div>
            )}
            <div className="divide-y divide-[var(--color-border)]">
              {group.map((form) => (
                <FormRow key={form.documentId} form={form} staffId={staffId} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function FormRow({ form, staffId }: { form: StaffFormDocRow; staffId: string }) {
  const latest = form.submissions[0]
  const hasPending = latest?.status === "PendingSupervisor"

  return (
    <div className="p-4">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-[var(--color-foreground)] truncate">{form.title}</p>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${HR_CATEGORY_STYLES[form.category as HrDocumentCategory] ?? HR_CATEGORY_STYLES.Other}`}>
              {HR_CATEGORY_LABELS[form.category as HrDocumentCategory] ?? form.category}
            </span>
            {!form.active && (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
                Archived
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
            {form.submissions.length === 0
              ? "Not started"
              : `${form.submissions.length} ${form.submissions.length === 1 ? "record" : "records"}`}
          </p>
        </div>
        {form.active && (
          <Link
            href={`/hr/forms/${form.documentId}/submit?staff=${staffId}`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)] hover:opacity-80 transition-opacity shrink-0"
          >
            <PenLine className="h-4 w-4" />
            {hasPending ? "Countersign" : form.submissions.length > 0 ? "New execution" : "Complete form"}
          </Link>
        )}
      </div>

      {form.submissions.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {form.submissions.map((sub) => (
            <div key={sub.id} className="flex items-center gap-3 text-xs flex-wrap">
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium shrink-0 ${FORM_STATUS_STYLES[sub.status as FormSubmissionStatus] ?? FORM_STATUS_STYLES.Completed}`}>
                {FORM_STATUS_LABELS[sub.status as FormSubmissionStatus] ?? sub.status}
              </span>
              <span className="text-[var(--color-muted-foreground)]">
                v{sub.versionNumber}
                {sub.employeeSignedAt && ` · employee ${format(new Date(sub.employeeSignedAt), "MMM d, yyyy")}`}
                {sub.supervisorSignedAt && ` · supervisor ${format(new Date(sub.supervisorSignedAt), "MMM d, yyyy")}`}
              </span>
              {sub.hasPdf && (
                <a
                  href={`/api/hr/forms/submissions/${sub.id}/download`}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-1 font-medium text-[var(--color-primary)] hover:opacity-80 transition-opacity"
                >
                  <Download className="h-3.5 w-3.5" />
                  Signed record
                </a>
              )}
              {sub.status === "Completed" && !sub.hasPdf && (
                <GenerateFormPdfButton submissionId={sub.id} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Recovery for the rare case where the synchronous PDF generation failed
// after both signatures were captured — idempotent on the API side.
function GenerateFormPdfButton({ submissionId }: { submissionId: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const router = useRouter()

  async function handleGenerate() {
    setBusy(true)
    setError("")
    try {
      const res = await fetch(`/api/hr/forms/submissions/${submissionId}/signed-pdf`, {
        method: "POST",
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
      <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={handleGenerate} disabled={busy}>
        <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
        {busy ? "Generating..." : "Generate record"}
      </Button>
      {error && <span className="text-xs text-[var(--color-destructive)]">{error}</span>}
    </span>
  )
}
