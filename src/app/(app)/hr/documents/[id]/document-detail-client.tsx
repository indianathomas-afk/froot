"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { ArrowLeft, Download, FileText, Pencil, PenLine, Plus, Trash2, Upload } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { Textarea } from "@/components/ui/textarea"
import {
  HR_CATEGORY_LABELS,
  HR_CATEGORY_STYLES,
  HR_CHECKPOINT_TYPES,
  HR_CHECKPOINT_TYPE_LABELS,
  HR_CHECKPOINT_TYPE_STYLES,
  HR_KIND_LABELS,
  type HrCheckpointTypeName,
  type HrDocumentCategory,
} from "@/lib/hr-documents"
import { uploadHrFileFromBrowser } from "@/lib/hr-upload-client"

export interface CheckpointRow {
  id: string
  name: string
  type: string
  orderIndex: number
  pageRef: number | null
  attestationText: string | null
  required: boolean
  acknowledgmentCount: number
}

export interface VersionRow {
  id: string
  versionNumber: number
  fileName: string
  sizeBytes: number
  fileHash: string
  isCurrent: boolean
  createdAt: string
}

export interface DocumentDetail {
  id: string
  title: string
  category: string
  kind: string
  isActive: boolean
  versions: VersionRow[]
  checkpoints: CheckpointRow[]
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function DocumentDetailClient({ doc }: { doc: DocumentDetail }) {
  const isSignatureDoc = doc.kind === "Acknowledgment"
  const category = doc.category as HrDocumentCategory

  return (
    <div>
      <Link
        href="/hr/documents"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Document Library
      </Link>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-[var(--color-foreground)]">{doc.title}</h1>
            {!doc.isActive && <Badge variant="secondary">Archived</Badge>}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${HR_CATEGORY_STYLES[category] ?? HR_CATEGORY_STYLES.Other}`}>
              {HR_CATEGORY_LABELS[category] ?? doc.category}
            </span>
            {isSignatureDoc && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/20">
                <PenLine className="h-3 w-3" />
                {HR_KIND_LABELS.Acknowledgment}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <VersionsCard doc={doc} />
        {isSignatureDoc && <CheckpointsCard doc={doc} />}
      </div>
    </div>
  )
}

function VersionsCard({ doc }: { doc: DocumentDetail }) {
  return (
    <section className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)]">
      <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-foreground)]">Versions</h2>
          <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
            Each upload is an immutable snapshot — signed records stay bound to the version they were signed against.
          </p>
        </div>
        <ReuploadButton doc={doc} />
      </div>
      <div className="divide-y divide-[var(--color-border)]">
        {doc.versions.map((v) => (
          <div key={v.id} className="flex items-center gap-4 p-4">
            <div className="w-9 h-9 rounded-lg bg-[var(--color-primary)]/10 flex items-center justify-center shrink-0">
              <FileText className="h-4 w-4 text-[var(--color-primary)]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-medium text-[var(--color-foreground)]">v{v.versionNumber}</p>
                {v.isCurrent && <Badge variant="info">Current</Badge>}
                <p className="text-sm text-[var(--color-muted-foreground)] truncate">{v.fileName}</p>
              </div>
              <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5 truncate">
                {formatSize(v.sizeBytes)} · Uploaded {format(new Date(v.createdAt), "MMM d, yyyy h:mm a")} ·{" "}
                <span className="font-mono" title={`sha256 ${v.fileHash}`}>
                  sha256 {v.fileHash.slice(0, 12)}…
                </span>
              </p>
            </div>
            {v.isCurrent && (
              <a
                href={`/api/hr/documents/${doc.id}/download`}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)] hover:opacity-80 transition-opacity shrink-0"
              >
                <Download className="h-4 w-4" />
                Download
              </a>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function ReuploadButton({ doc }: { doc: DocumentDetail }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const isSignatureDoc = doc.kind === "Acknowledgment"

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) {
      setError("Choose a file to upload")
      return
    }
    if (isSignatureDoc && file.type !== "application/pdf") {
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
      const res = await fetch(`/api/hr/documents/${doc.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: uploaded.url, fileName: file.name }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Failed to save the new version")
        return
      }
      setOpen(false)
      if (fileRef.current) fileRef.current.value = ""
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4" />
        Upload New Version
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Upload New Version</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>File *</Label>
              <Input required ref={fileRef} type="file" accept={isSignatureDoc ? ".pdf" : ".pdf,.png,.jpg,.jpeg,.doc,.docx"} />
              <p className="text-xs text-[var(--color-muted-foreground)]">
                {isSignatureDoc ? "PDF — up to 25 MB." : "PDF, PNG, JPG, DOC, or DOCX — up to 25 MB."}
              </p>
            </div>
            {isSignatureDoc && (
              <p className="text-sm text-[var(--color-warning,#efa201)]">
                Existing signatures stay bound to the version they signed. Everyone will need to
                acknowledge this new version.
              </p>
            )}
            {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? "Uploading..." : "Upload Version"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function CheckpointsCard({ doc }: { doc: DocumentDetail }) {
  return (
    <section className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)]">
      <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-foreground)]">
            Checkpoints{" "}
            <span className="font-normal text-[var(--color-muted-foreground)]">({doc.checkpoints.length})</span>
          </h2>
          <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
            What a team member must initial, fill in, sign, and acknowledge to complete this document.
          </p>
        </div>
        <CheckpointFormButton docId={doc.id} />
      </div>
      {doc.checkpoints.length === 0 ? (
        <p className="p-6 text-sm text-[var(--color-muted-foreground)] text-center">
          No checkpoints yet — add the first one above.
        </p>
      ) : (
        <div className="divide-y divide-[var(--color-border)]">
          {doc.checkpoints.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="text-xs text-[var(--color-muted-foreground)] font-mono w-7 shrink-0 text-right">
                {c.orderIndex + 1}.
              </span>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium shrink-0 ${HR_CHECKPOINT_TYPE_STYLES[c.type as HrCheckpointTypeName] ?? ""}`}>
                {HR_CHECKPOINT_TYPE_LABELS[c.type as HrCheckpointTypeName] ?? c.type}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-[var(--color-foreground)] truncate">
                  {c.name}
                  {!c.required && (
                    <span className="ml-2 text-xs text-[var(--color-muted-foreground)]">(optional)</span>
                  )}
                </p>
                {c.attestationText && (
                  <p className="text-xs text-[var(--color-muted-foreground)] truncate" title={c.attestationText}>
                    “{c.attestationText}”
                  </p>
                )}
              </div>
              {c.pageRef != null && (
                <span className="text-xs text-[var(--color-muted-foreground)] shrink-0">p. {c.pageRef}</span>
              )}
              <div className="flex items-center gap-1 shrink-0">
                <CheckpointFormButton docId={doc.id} checkpoint={c} />
                <DeleteCheckpointButton docId={doc.id} checkpoint={c} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// One dialog for both add and edit — pass checkpoint to edit. Type is only
// selectable on add (the API treats it as immutable; delete and re-add to
// change it).
function CheckpointFormButton({ docId, checkpoint }: { docId: string; checkpoint?: CheckpointRow }) {
  const isEdit = !!checkpoint
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [name, setName] = useState(checkpoint?.name ?? "")
  const [type, setType] = useState<HrCheckpointTypeName>(
    (checkpoint?.type as HrCheckpointTypeName) ?? "Field"
  )
  const [pageRef, setPageRef] = useState(checkpoint?.pageRef?.toString() ?? "")
  const [attestationText, setAttestationText] = useState(checkpoint?.attestationText ?? "")
  const [required, setRequired] = useState(checkpoint?.required ?? true)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError("")
    try {
      const payload = {
        name,
        pageRef: pageRef ? parseInt(pageRef, 10) : null,
        attestationText: attestationText.trim() || null,
        required,
        ...(isEdit ? {} : { type }),
      }
      const res = await fetch(
        isEdit
          ? `/api/hr/documents/${docId}/checkpoints/${checkpoint.id}`
          : `/api/hr/documents/${docId}/checkpoints`,
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Failed to save the checkpoint")
        return
      }
      setOpen(false)
      if (!isEdit) {
        setName("")
        setType("Field")
        setPageRef("")
        setAttestationText("")
        setRequired(true)
      }
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  const needsAttestation = (isEdit ? checkpoint.type : type) === "Acknowledgment"

  return (
    <>
      {isEdit ? (
        <button
          onClick={() => setOpen(true)}
          className="p-1.5 rounded hover:bg-[var(--color-accent)]"
          title="Edit checkpoint"
        >
          <Pencil className="h-4 w-4 text-[var(--color-muted-foreground)]" />
        </button>
      ) : (
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          Add Checkpoint
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit Checkpoint" : "Add Checkpoint"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {!isEdit && (
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={type} onValueChange={(v) => setType(v as HrCheckpointTypeName)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HR_CHECKPOINT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{HR_CHECKPOINT_TYPE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={type === "Field" ? "e.g. Employee name" : "e.g. Final acknowledgment"}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Page</Label>
              <Input
                type="number"
                min={1}
                value={pageRef}
                onChange={(e) => setPageRef(e.target.value)}
                placeholder="Optional page number"
              />
            </div>
            {needsAttestation && (
              <div className="space-y-1.5">
                <Label>Attestation text *</Label>
                <Textarea
                  required
                  rows={3}
                  value={attestationText}
                  onChange={(e) => setAttestationText(e.target.value)}
                  placeholder="I acknowledge that I have read and understand…"
                />
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-[var(--color-foreground)]">
              <Checkbox checked={required} onCheckedChange={(v) => setRequired(v === true)} />
              Required to complete the document
            </label>
            {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : isEdit ? "Save Changes" : "Add Checkpoint"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function DeleteCheckpointButton({ docId, checkpoint }: { docId: string; checkpoint: CheckpointRow }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const router = useRouter()
  const locked = checkpoint.acknowledgmentCount > 0

  async function handleDelete() {
    setSaving(true)
    setError("")
    try {
      const res = await fetch(`/api/hr/documents/${docId}/checkpoints/${checkpoint.id}`, {
        method: "DELETE",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Failed to delete the checkpoint")
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
        onClick={() => !locked && setOpen(true)}
        className={`p-1.5 rounded ${locked ? "opacity-40 cursor-not-allowed" : "hover:bg-[var(--color-accent)]"}`}
        title={
          locked
            ? "This checkpoint has been signed and is part of the permanent record — mark it not required instead"
            : "Delete checkpoint"
        }
        disabled={locked}
      >
        <Trash2 className="h-4 w-4 text-[var(--color-muted-foreground)]" />
      </button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{checkpoint.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              Team members signing this document will no longer be asked for it. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={saving}>
              {saving ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
