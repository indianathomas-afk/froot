"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { ArrowLeft, Download, FileScan, FileText, Pencil, PenLine, Plus, RefreshCw, Trash2, Upload } from "lucide-react"
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
  HR_ANCHOR_MARK_HINTS,
  HR_ANCHOR_MARK_LABELS,
  HR_ANCHOR_MARK_TYPES,
  HR_ANCHOR_PLACEMENT_LABELS,
  HR_ANCHOR_PLACEMENTS,
  HR_CATEGORY_LABELS,
  HR_CATEGORY_STYLES,
  HR_CHECKPOINT_TYPES,
  HR_CHECKPOINT_TYPE_LABELS,
  HR_CHECKPOINT_TYPE_STYLES,
  HR_KIND_LABELS,
  type HrAnchorMarkTypeName,
  type HrAnchorPlacementName,
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

export interface AnchorRow {
  id: string
  page: number
  anchorText: string
  markType: string
  placement: string
  confirmed: boolean
}

export interface DocumentDetail {
  id: string
  title: string
  category: string
  kind: string
  isActive: boolean
  versions: VersionRow[]
  checkpoints: CheckpointRow[]
  currentVersionId: string | null
  anchors: AnchorRow[]
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
        {isSignatureDoc && <AnchorsCard doc={doc} />}
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

// HR-11b: the anchor confirm/mapping step. Detected anchors are proposals —
// the admin adjusts the mark type + placement and keeps/discards each, grouped
// by page, then confirms. Confirmation generates/links the checkpoints. Free
// drag-repositioning is deliberately NOT offered (ruling U1 — that's manual
// placement, deferred).
interface AnchorDraft {
  markType: HrAnchorMarkTypeName
  placement: HrAnchorPlacementName
  keep: boolean
}

// Re-run detection against the already-uploaded current version (no re-upload).
// Populates documents that predate anchoring, and re-detects when detection
// improves. Replaces only the unconfirmed set; confirmed anchors are preserved.
function RescanButton({ docId, label = "Rescan fields" }: { docId: string; label?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  async function handleRescan() {
    setBusy(true)
    setError("")
    setNotice("")
    try {
      const res = await fetch(`/api/hr/documents/${docId}/anchors/rescan`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Distinct failure — surface the real message, not a silent zero.
        setError(data.error ?? "Failed to scan the document")
        return
      }
      // Distinct success outcomes.
      if (data.detected > 0) {
        // Full reload, not router.refresh(): the soft RSC re-fetch fired right
        // after the heavy rescan invocation intermittently fails ("page couldn't
        // load"), while a top-level GET reliably reloads the detected fields.
        window.location.reload()
      } else if (data.hadTextLayer) {
        setNotice(
          `Scanned ${data.pagesScanned} page(s) — a text layer was found, but none of the field labels matched.`
        )
      } else {
        setNotice("No text layer found — this looks like a scanned or image-only PDF.")
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="outline" onClick={handleRescan} disabled={busy}>
        <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
        {busy ? "Scanning..." : label}
      </Button>
      {error && <span className="text-xs text-[var(--color-destructive)] max-w-md">{error}</span>}
      {notice && <span className="text-xs text-[var(--color-muted-foreground)] max-w-md">{notice}</span>}
    </span>
  )
}

function AnchorsCard({ doc }: { doc: DocumentDetail }) {
  const router = useRouter()
  const [drafts, setDrafts] = useState<Record<string, AnchorDraft>>(() =>
    Object.fromEntries(
      doc.anchors.map((a) => [
        a.id,
        {
          markType: a.markType as HrAnchorMarkTypeName,
          placement: a.placement as HrAnchorPlacementName,
          keep: true,
        },
      ])
    )
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const allConfirmed = doc.anchors.length > 0 && doc.anchors.every((a) => a.confirmed)

  // Empty → image-only / no text layer → certificate-only mode.
  if (doc.anchors.length === 0) {
    return (
      <section className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)]">
        <div className="flex items-center justify-between gap-3 p-4 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-[var(--color-foreground)]">Detected fields</h2>
          <RescanButton docId={doc.id} label="Scan for fields" />
        </div>
        <div className="flex items-start gap-3 p-6">
          <FileScan className="h-5 w-5 text-[var(--color-muted-foreground)] shrink-0 mt-0.5" />
          <div className="text-sm text-[var(--color-muted-foreground)]">
            <p className="font-medium text-[var(--color-foreground)]">No fields detected yet</p>
            <p className="mt-1 max-w-xl">
              Nothing has been stamped onto the page body. If this is a text-based PDF (including
              documents added before field detection existed), use{" "}
              <span className="font-medium">Scan for fields</span> to detect them now. If it&apos;s a
              scanned or image-only PDF there is no text layer to read — signing still works end to
              end and execution is recorded on the appended{" "}
              <span className="font-medium">Certificate of Acknowledgment</span>.
            </p>
          </div>
        </div>
      </section>
    )
  }

  const pages = [...new Set(doc.anchors.map((a) => a.page))].sort((x, y) => x - y)
  const keptCount = Object.values(drafts).filter((d) => d.keep).length

  function update(id: string, patch: Partial<AnchorDraft>) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }))
  }

  async function handleConfirm() {
    setSaving(true)
    setError("")
    try {
      const res = await fetch(`/api/hr/documents/${doc.id}/anchors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anchors: doc.anchors.map((a) => ({
            id: a.id,
            markType: drafts[a.id].markType,
            placement: drafts[a.id].placement,
            keep: drafts[a.id].keep,
          })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Failed to confirm the fields")
        return
      }
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)]">
      <div className="flex items-center justify-between gap-3 p-4 border-b border-[var(--color-border)]">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-foreground)] flex items-center gap-2">
            Detected fields{" "}
            <span className="font-normal text-[var(--color-muted-foreground)]">
              ({doc.anchors.length} across {pages.length} page{pages.length === 1 ? "" : "s"})
            </span>
            {allConfirmed && <Badge variant="success">Confirmed</Badge>}
          </h2>
          <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5 max-w-2xl">
            These are proposals from scanning the document text — review each one before confirming
            (e.g. an &ldquo;Effective Date:&rdquo; inside policy text should be discarded). Confirming
            generates the checkpoints and enables inline stamping on signed copies.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <RescanButton docId={doc.id} />
          <Button onClick={handleConfirm} disabled={saving}>
            {saving ? "Confirming..." : allConfirmed ? "Save changes" : `Confirm & generate (${keptCount})`}
          </Button>
        </div>
      </div>

      <div className="divide-y divide-[var(--color-border)]">
        {pages.map((page) => (
          <div key={page} className="p-4">
            <p className="text-xs font-semibold text-[var(--color-muted-foreground)] uppercase tracking-wide mb-2">
              Page {page}
            </p>
            <div className="space-y-2">
              {doc.anchors
                .filter((a) => a.page === page)
                .map((a) => {
                  const draft = drafts[a.id]
                  return (
                    <div
                      key={a.id}
                      className={`flex items-center gap-3 flex-wrap rounded-md border border-[var(--color-border)] px-3 py-2 ${draft.keep ? "" : "opacity-50"}`}
                    >
                      <span
                        className="font-mono text-xs text-[var(--color-foreground)] shrink-0 max-w-[16rem] truncate"
                        title={a.anchorText}
                      >
                        {a.anchorText}
                      </span>
                      <div className="flex items-center gap-2 flex-wrap ml-auto">
                        <Select
                          value={draft.markType}
                          onValueChange={(v) => update(a.id, { markType: v as HrAnchorMarkTypeName })}
                          disabled={!draft.keep}
                        >
                          <SelectTrigger className="w-[15rem]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {HR_ANCHOR_MARK_TYPES.map((t) => (
                              <SelectItem key={t} value={t}>
                                {HR_ANCHOR_MARK_LABELS[t]}
                                <span className="text-[var(--color-muted-foreground)]"> — {HR_ANCHOR_MARK_HINTS[t]}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={draft.placement}
                          onValueChange={(v) => update(a.id, { placement: v as HrAnchorPlacementName })}
                          disabled={!draft.keep}
                        >
                          <SelectTrigger className="w-[13rem]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {HR_ANCHOR_PLACEMENTS.map((p) => (
                              <SelectItem key={p} value={p}>{HR_ANCHOR_PLACEMENT_LABELS[p]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <label className="flex items-center gap-1.5 text-xs text-[var(--color-foreground)] shrink-0">
                          <Checkbox
                            checked={draft.keep}
                            onCheckedChange={(v) => update(a.id, { keep: v === true })}
                          />
                          Include
                        </label>
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>
        ))}
      </div>
      {error && <p className="px-4 pb-3 text-sm text-[var(--color-destructive)]">{error}</p>}
    </section>
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
