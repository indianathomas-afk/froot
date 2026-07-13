"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { Archive, Download, FileText, Pencil, PenLine, Plus, Settings2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  HR_CATEGORY_LABELS,
  HR_CATEGORY_STYLES,
  HR_DOCUMENT_CATEGORIES,
  HR_KIND_LABELS,
  type HrDocumentCategory,
  type HrDocumentKind,
} from "@/lib/hr-documents"
import { uploadHrFileFromBrowser } from "@/lib/hr-upload-client"

export interface HrDocumentRow {
  id: string
  title: string
  category: string
  kind: HrDocumentKind
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
  const [filter, setFilter] = useState<HrDocumentCategory | "all">("all")

  const presentCategories = HR_DOCUMENT_CATEGORIES.filter((c) =>
    documents.some((d) => d.category === c)
  )
  const visible = filter === "all" ? documents : documents.filter((d) => d.category === filter)
  const grouped = HR_DOCUMENT_CATEGORIES.map((category) => ({
    category,
    docs: visible.filter((d) => d.category === category),
  })).filter((g) => g.docs.length > 0)

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
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
        <>
          {presentCategories.length > 1 && (
            <div className="mb-6 flex items-center gap-2 flex-wrap">
              <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
                All
              </FilterChip>
              {presentCategories.map((c) => (
                <FilterChip key={c} active={filter === c} onClick={() => setFilter(c)}>
                  {HR_CATEGORY_LABELS[c]}
                </FilterChip>
              ))}
            </div>
          )}
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
                          {doc.kind === "Acknowledgment" && (
                            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/20">
                              <PenLine className="h-3 w-3" />
                              {HR_KIND_LABELS.Acknowledgment}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5 truncate">
                          {doc.fileName} · {formatSize(doc.sizeBytes)} · Uploaded {format(new Date(doc.uploadedAt), "MMM d, yyyy")}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <a
                          href={`/api/hr/documents/${doc.id}/download`}
                          target="_blank"
                          rel="noopener"
                          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)] hover:opacity-80 transition-opacity mr-2"
                        >
                          <Download className="h-4 w-4" />
                          Download
                        </a>
                        {isAdmin && doc.kind === "Acknowledgment" && (
                          <Link
                            href={`/hr/documents/${doc.id}`}
                            className="p-1.5 rounded hover:bg-[var(--color-accent)]"
                            title="Manage versions & checkpoints"
                          >
                            <Settings2 className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                          </Link>
                        )}
                        {isAdmin && <EditDocumentButton doc={doc} />}
                        {isAdmin && <ArchiveDocumentButton doc={doc} />}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
        active
          ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] border-[var(--color-primary)]"
          : "bg-[var(--color-card)] text-[var(--color-muted-foreground)] border-[var(--color-border)] hover:bg-[var(--color-accent)]"
      }`}
    >
      {children}
    </button>
  )
}

function AddDocumentButton({ label = "Add Document" }: { label?: string }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [title, setTitle] = useState("")
  const [category, setCategory] = useState<HrDocumentCategory>("Handbook")
  const [kind, setKind] = useState<HrDocumentKind>("Reference")
  const fileRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  // Three-step upload: get a presigned URL, PUT the file straight to the Blob
  // store (files over ~4.5 MB would 413 if sent through our API), then
  // register the document.
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) {
      setError("Choose a file to upload")
      return
    }
    if (kind === "Acknowledgment" && file.type !== "application/pdf") {
      setError("Signature documents must be PDFs")
      return
    }
    setSaving(true)
    setError("")
    try {
      const uploaded = await uploadHrFileFromBrowser(file)
      if (!uploaded.ok) {
        setError(uploaded.error)
        return
      }

      const res = await fetch("/api/hr/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, category, kind, url: uploaded.url, fileName: file.name }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Failed to save the document")
        return
      }
      setOpen(false)
      setTitle("")
      setCategory("Handbook")
      setKind("Reference")
      if (fileRef.current) fileRef.current.value = ""
      // A new signature document lands on its checkpoint editor so the admin
      // can review the auto-generated defaults right away.
      if (data.kind === "Acknowledgment") {
        router.push(`/hr/documents/${data.id}`)
      } else {
        router.refresh()
      }
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
              <Label>Type</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as HrDocumentKind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Reference">Reference — read-only library document</SelectItem>
                  <SelectItem value="Acknowledgment">Signature — staff must sign &amp; acknowledge</SelectItem>
                </SelectContent>
              </Select>
              {kind === "Acknowledgment" && (
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  PDF only. Per-page initial checkpoints and a final acknowledgment are generated
                  automatically — you can adjust them next.
                </p>
              )}
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
                accept={kind === "Acknowledgment" ? ".pdf" : ".pdf,.png,.jpg,.jpeg,.doc,.docx"}
              />
              <p className="text-xs text-[var(--color-muted-foreground)]">
                {kind === "Acknowledgment" ? "PDF — up to 25 MB." : "PDF, PNG, JPG, DOC, or DOCX — up to 25 MB."}
              </p>
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

function EditDocumentButton({ doc }: { doc: HrDocumentRow }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [title, setTitle] = useState(doc.title)
  const [category, setCategory] = useState(doc.category as HrDocumentCategory)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError("")
    try {
      const res = await fetch(`/api/hr/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, category }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Failed to save changes")
        return
      }
      setOpen(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="p-1.5 rounded hover:bg-[var(--color-accent)]"
        title="Edit document"
      >
        <Pencil className="h-4 w-4 text-[var(--color-muted-foreground)]" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Document</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input required value={title} onChange={(e) => setTitle(e.target.value)} />
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
            <p className="text-xs text-[var(--color-muted-foreground)]">
              The uploaded file itself can&apos;t be replaced — add a new document instead.
            </p>
            {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ArchiveDocumentButton({ doc }: { doc: HrDocumentRow }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  async function handleArchive() {
    setSaving(true)
    try {
      await fetch(`/api/hr/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      })
      setOpen(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="p-1.5 rounded hover:bg-[var(--color-accent)]"
        title="Archive document"
      >
        <Archive className="h-4 w-4 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]" />
      </button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive &ldquo;{doc.title}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              The document will be removed from the library for all members. The file itself is kept
              and nothing is permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchive} disabled={saving}>
              {saving ? "Archiving..." : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
