"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { Download, FileText, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  HR_CATEGORY_LABELS,
  HR_CATEGORY_STYLES,
  HR_DOCUMENT_CATEGORIES,
  type HrDocumentCategory,
} from "@/lib/hr-documents"

export interface HrDocumentRow {
  id: string
  title: string
  category: string
  fileName: string
  sizeBytes: number
  uploadedAt: string
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function HrDocumentsClient({
  documents,
  isAdmin,
}: {
  documents: HrDocumentRow[]
  isAdmin: boolean
}) {
  const grouped = HR_DOCUMENT_CATEGORIES.map((category) => ({
    category,
    docs: documents.filter((d) => d.category === category),
  })).filter((g) => g.docs.length > 0)

  return (
    <div>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Document Library</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            Handbooks, policies, and reference documents for your whole team
          </p>
        </div>
        {isAdmin && <AddDocumentButton />}
      </div>

      {documents.length === 0 ? (
        <div className="flex items-center justify-center min-h-[40vh] border border-dashed border-[var(--color-border)] rounded-lg">
          <div className="text-center max-w-md px-6">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center">
              <FileText className="h-6 w-6 text-[var(--color-primary)]" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--color-foreground)] mb-2">No documents yet</h2>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {isAdmin
                ? "Upload the first policy or handbook — every member of your organization will be able to read it here."
                : "Reference documents shared by your organization will appear here."}
            </p>
            {isAdmin && (
              <div className="mt-6 flex justify-center">
                <AddDocumentButton label="Upload the first document" />
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(({ category, docs }) => (
            <section key={category}>
              <h2 className="text-sm font-semibold text-[var(--color-muted-foreground)] uppercase tracking-wide mb-3">
                {HR_CATEGORY_LABELS[category]}
              </h2>
              <div className="border border-[var(--color-border)] rounded-lg divide-y divide-[var(--color-border)] bg-[var(--color-card)]">
                {docs.map((doc) => (
                  <div key={doc.id} className="flex items-center gap-4 p-4">
                    <div className="w-9 h-9 rounded-lg bg-[var(--color-primary)]/10 flex items-center justify-center shrink-0">
                      <FileText className="h-4 w-4 text-[var(--color-primary)]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-[var(--color-foreground)] truncate">{doc.title}</p>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${HR_CATEGORY_STYLES[category]}`}>
                          {HR_CATEGORY_LABELS[category]}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5 truncate">
                        {doc.fileName} · {formatSize(doc.sizeBytes)} · Uploaded {format(new Date(doc.uploadedAt), "MMM d, yyyy")}
                      </p>
                    </div>
                    <a
                      href={`/api/hr/documents/${doc.id}/download`}
                      target="_blank"
                      rel="noopener"
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)] hover:opacity-80 transition-opacity shrink-0"
                    >
                      <Download className="h-4 w-4" />
                      Download
                    </a>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function AddDocumentButton({ label = "Add Document" }: { label?: string }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [title, setTitle] = useState("")
  const [category, setCategory] = useState<HrDocumentCategory>("Handbook")
  const fileRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) {
      setError("Choose a file to upload")
      return
    }
    setSaving(true)
    setError("")
    try {
      const body = new FormData()
      body.set("file", file)
      body.set("title", title)
      body.set("category", category)
      const res = await fetch("/api/hr/documents", { method: "POST", body })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Failed to upload document")
        return
      }
      setOpen(false)
      setTitle("")
      setCategory("Handbook")
      if (fileRef.current) fileRef.current.value = ""
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Document</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. 2026 Employee Handbook"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as HrDocumentCategory)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HR_DOCUMENT_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{HR_CATEGORY_LABELS[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>File *</Label>
              <Input
                required
                ref={fileRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
              />
              <p className="text-xs text-[var(--color-muted-foreground)]">PDF, PNG, JPG, DOC, or DOCX — up to 10 MB.</p>
            </div>
            {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? "Uploading..." : "Upload"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
