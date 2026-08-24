"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import {
  Archive,
  ArchiveRestore,
  Download,
  ExternalLink,
  FileText,
  Pencil,
  PenLine,
  Plus,
  Settings2,
  Users,
} from "lucide-react"
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
  EXTERNAL_URL_ERROR,
  HR_CATEGORY_LABELS,
  HR_CATEGORY_STYLES,
  HR_DOCUMENT_CATEGORIES,
  HR_KIND_LABELS,
  externalUrlHost,
  hrAudienceChipStyle,
  hrAudienceLabel,
  hrScanMessage,
  isValidExternalDocumentUrl,
  type HrDocumentCategory,
  type HrDocumentKind,
} from "@/lib/hr-documents"
import { uploadHrFileFromBrowser } from "@/lib/hr-upload-client"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { DocumentInstructions } from "@/components/hr/document-instructions"
import { AssignAudienceDialog, type AudienceDocumentRef } from "./assign-audience-dialog"

export interface HrDocumentRow {
  id: string
  title: string
  category: string
  kind: HrDocumentKind
  fileName: string
  sizeBytes: number
  uploadedAt: string
  // DOC-3. A Link has no version, so fileName/sizeBytes/uploadedAt are the
  // empty-string/zero/created-at fallbacks for it and must never be RENDERED on
  // a Link path — see DocumentRow, which branches before it reaches them.
  createdAt: string
  externalUrl: string | null
  instructionsHtml: string | null
  instructionsVideoUrl: string | null
  // DOC-1 B. Archived rows reach ADMIN only (page.tsx narrows for everyone
  // else), and the three audience fields drive the chip.
  isActive: boolean
  appliesTo: string
  storeGrants: number
  staffGrants: number
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
  const [showArchived, setShowArchived] = useState(false)
  const [assigning, setAssigning] = useState<AudienceDocumentRef | null>(null)
  const router = useRouter()

  const presentCategories = HR_DOCUMENT_CATEGORIES.filter((c) =>
    documents.some((d) => d.category === c)
  )
  const visible = filter === "all" ? documents : documents.filter((d) => d.category === filter)
  // Archived rows only ever reach ADMIN — page.tsx keeps `isActive: true` in the
  // query for everyone else — so this split is a no-op for non-admins.
  const active = visible.filter((d) => d.isActive)
  const archived = visible.filter((d) => !d.isActive)
  const grouped = HR_DOCUMENT_CATEGORIES.map((category) => ({
    category,
    docs: active.filter((d) => d.category === category),
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
                ? // DOC-1: this used to promise "every member of your organization will be able
                  // to read it here", which stopped being true when uploads started life
                  // ADMIN-only. Copy that describes the pre-audience behaviour is how an admin
                  // concludes the library is broken when it is doing exactly what it was told.
                  "Upload the first policy or handbook, then choose who it is for — a new document starts visible to admins only."
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
                    <DocumentRow
                      key={doc.id}
                      doc={doc}
                      isAdmin={isAdmin}
                      onAssign={() => setAssigning({ id: doc.id, title: doc.title })}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>

          {/* ARCHIVED — ADMIN ONLY, AND THE REASON IT EXISTS IS A DEFECT, NOT A
              FEATURE. Archive has shipped since HR-4 and PATCH has always
              accepted isActive:true, but nothing ever listed an archived row
              again, so "hide, never delete" was in practice "hide forever".
              Collapsed by default: the admin's working set is the live library,
              and an archive that pads every category is one nobody reads. */}
          {isAdmin && archived.length > 0 && (
            <div className="mt-10 border-t border-[var(--color-border)] pt-6">
              <button
                onClick={() => setShowArchived((v) => !v)}
                className="text-sm font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
              >
                {showArchived ? "Hide" : "Show"} {archived.length} archived{" "}
                {archived.length === 1 ? "document" : "documents"}
              </button>
              {showArchived && (
                <div className="mt-3 border border-[var(--color-border)] rounded-lg divide-y divide-[var(--color-border)] bg-[var(--color-card)]">
                  {archived.map((doc) => (
                    <DocumentRow
                      key={doc.id}
                      doc={doc}
                      isAdmin={isAdmin}
                      onAssign={() => setAssigning({ id: doc.id, title: doc.title })}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Keyed by document id so a different document gets a fresh mount rather
          than inheriting the previous one's checkboxes (HR-22's rule). */}
      <AssignAudienceDialog
        key={assigning?.id ?? "none"}
        doc={assigning}
        onClose={() => setAssigning(null)}
        onSaved={() => router.refresh()}
      />
    </div>
  )
}

function DocumentRow({
  doc,
  isAdmin,
  onAssign,
}: {
  doc: HrDocumentRow
  isAdmin: boolean
  onAssign: () => void
}) {
  const category = doc.category as HrDocumentCategory
  // DOC-3: everything about this row that differs for a link, decided once.
  const isLink = doc.kind === "Link"
  const host = externalUrlHost(doc.externalUrl)
  return (
    <div className={`flex items-start gap-4 p-4 ${doc.isActive ? "" : "opacity-60"}`}>
      <div className="w-9 h-9 rounded-lg bg-[var(--color-primary)]/10 flex items-center justify-center shrink-0">
        {isLink ? (
          <ExternalLink className="h-4 w-4 text-[var(--color-primary)]" />
        ) : (
          <FileText className="h-4 w-4 text-[var(--color-primary)]" />
        )}
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
          {isLink && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 border border-blue-200">
              <ExternalLink className="h-3 w-3" />
              {HR_KIND_LABELS.Link}
            </span>
          )}
          {/* ADMIN-ONLY, DELIBERATELY. The chip answers "who else can see this",
              which is a configuration question — a reader who was served the
              document already knows it reaches them, and telling them how many
              other stores hold it is org structure they were not shown. */}
          {isAdmin && (
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${hrAudienceChipStyle(doc)}`}
              title="Who this document is for"
            >
              {hrAudienceLabel(doc)}
            </span>
          )}
          {!doc.isActive && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
              Archived
            </span>
          )}
        </div>
        {/* DOC-3: a Link has no file, so it gets the HOST and "Added" — never a
            name, never a size, never "Uploaded". Rendering the file line here
            would have shown "· 0 B · Uploaded" off the null-version fallbacks,
            which is two surfaces disagreeing about what the row even is.
            Ruling 4 is the reason the host is what shows: an admin should be
            able to see where a link points without opening it. */}
        <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5 truncate">
          {isLink
            ? `${host ?? "External link"} · Added ${format(new Date(doc.createdAt), "MMM d, yyyy")}`
            : `${doc.fileName} · ${formatSize(doc.sizeBytes)} · Uploaded ${format(new Date(doc.uploadedAt), "MMM d, yyyy")}`}
        </p>
        {/* Collapsed on the admin library: this is a dense scannable list and an
            expanded rich-text block per row would destroy the scan. The staff
            portal takes the expanded variant of the same component. */}
        <DocumentInstructions
          instructionsHtml={doc.instructionsHtml}
          instructionsVideoUrl={doc.instructionsVideoUrl}
          title={doc.title}
          variant="collapsed"
        />
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {/* Sign and Download are suppressed on an archived row: it is hidden
            from every non-admin path, so offering an admin the staff-facing
            affordances would invite them to act on a document nobody else can
            reach. Restore first, then act. */}
        {doc.isActive && doc.kind === "Acknowledgment" && (
          <Link
            href={`/hr/acknowledge/${doc.id}`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)] hover:opacity-80 transition-opacity mr-2"
          >
            <PenLine className="h-4 w-4" />
            Sign
          </Link>
        )}
        {/* DOC-3: Open, not Download, for a Link. The download route would 404
            on it (no version row) and that 404 is correct — nothing links to
            it any more, which is what the negative grep in this row's gates
            checks. rel carries noreferrer as well as noopener here because the
            destination is a third party; the file branch below stays
            noopener-only, being same-origin. */}
        {doc.isActive && isLink && doc.externalUrl && (
          <a
            href={doc.externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)] hover:opacity-80 transition-opacity mr-2"
          >
            <ExternalLink className="h-4 w-4" />
            Open
          </a>
        )}
        {doc.isActive && !isLink && (
          <a
            href={`/api/hr/documents/${doc.id}/download`}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)] hover:opacity-80 transition-opacity mr-2"
          >
            <Download className="h-4 w-4" />
            Download
          </a>
        )}
        {isAdmin && (
          <button
            onClick={onAssign}
            className="p-1.5 rounded hover:bg-[var(--color-accent)]"
            title="Assign audience"
          >
            <Users className="h-4 w-4 text-[var(--color-muted-foreground)]" />
          </button>
        )}
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
        {isAdmin &&
          (doc.isActive ? <ArchiveDocumentButton doc={doc} /> : <RestoreDocumentButton doc={doc} />)}
      </div>
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
  // DOC-3. externalUrl is Link-only; the two instructions fields are for every
  // kind (ruling 3).
  const [externalUrl, setExternalUrl] = useState("")
  const [instructionsHtml, setInstructionsHtml] = useState("")
  const [instructionsVideoUrl, setInstructionsVideoUrl] = useState("")
  // HR-11d 2a: the scan result, and the document it belongs to, held so the
  // dialog can end on the operator's to-do instead of on a redirect.
  const [scanNotice, setScanNotice] = useState("")
  const [createdId, setCreatedId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const isLink = kind === "Link"

  // The instructions half of the payload, identical on both branches.
  function instructionsPayload() {
    return {
      instructionsHtml: instructionsHtml.trim() || null,
      instructionsVideoUrl: instructionsVideoUrl.trim() || null,
    }
  }

  function resetForm() {
    setTitle("")
    setCategory("Handbook")
    setKind("Reference")
    setExternalUrl("")
    setInstructionsHtml("")
    setInstructionsVideoUrl("")
    if (fileRef.current) fileRef.current.value = ""
  }

  // Three-step upload: get a presigned URL, PUT the file straight to the Blob
  // store (files over ~4.5 MB would 413 if sent through our API), then
  // register the document.
  //
  // DOC-3: A LINK SKIPS ALL THREE. There is no file to presign, PUT or read
  // back — it POSTs the URL directly. The `if (!file)` guard below used to fire
  // before anything else and had to move inside the file branch, or every Link
  // submit would have been refused by the dialog with "Choose a file to
  // upload".
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (isLink) {
      // The SAME predicate the server uses (lib/hr-documents.ts), not a
      // second-guess at it. type="url" + required already block most of this;
      // this catches the rest — http://, our own blob host — so the admin gets
      // the message inline instead of a round-trip. The server still refuses
      // independently; this is convenience, never the gate.
      if (!isValidExternalDocumentUrl(externalUrl.trim())) {
        setError(EXTERNAL_URL_ERROR)
        return
      }
      setSaving(true)
      setError("")
      try {
        const res = await fetch("/api/hr/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            category,
            kind: "Link",
            externalUrl: externalUrl.trim(),
            ...instructionsPayload(),
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(data.error ?? "Failed to save the link")
          return
        }
        resetForm()
        setOpen(false)
        router.refresh()
      } finally {
        setSaving(false)
      }
      return
    }

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
        body: JSON.stringify({
          title,
          category,
          kind,
          url: uploaded.url,
          fileName: file.name,
          ...instructionsPayload(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Failed to save the document")
        return
      }
      resetForm()
      // A new signature document lands on its checkpoint editor so the admin
      // can review the auto-generated defaults right away.
      //
      // HR-11d 2a: BUT NOT BEFORE IT SAYS WHAT THE SCAN DID. Landing straight
      // on the editor shows the detected-fields list, which cannot distinguish
      // "no fields in this document" from "the scan threw" — the exact collapse
      // R2 forbids. The sentence goes to the operator first; the button behind
      // it still takes them to the screen that clears the to-do.
      if (data.kind === "Acknowledgment" && data.scan) {
        setCreatedId(data.id)
        setScanNotice(hrScanMessage(data.scan))
      } else {
        setOpen(false)
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
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v)
          if (!v) {
            setScanNotice("")
            setCreatedId(null)
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{scanNotice ? "Document added" : "Add Document"}</DialogTitle>
          </DialogHeader>
          {scanNotice ? (
            <div className="space-y-4">
              <p className="text-sm text-[var(--color-foreground)]">{scanNotice}</p>
              <DialogFooter>
                <Button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    setScanNotice("")
                    if (createdId) router.push(`/hr/documents/${createdId}`)
                    setCreatedId(null)
                  }}
                >
                  Review fields
                </Button>
              </DialogFooter>
            </div>
          ) : (
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
                  {/* Left as per-kind prose rather than mapped from
                      HR_DOCUMENT_KINDS: these are explanatory sentences, not
                      label lookups, and mapping would flatten them. */}
                  <SelectItem value="Reference">Reference — read-only library document</SelectItem>
                  <SelectItem value="Acknowledgment">Signature — staff must sign &amp; acknowledge</SelectItem>
                  <SelectItem value="Link">Link — points to a document hosted elsewhere</SelectItem>
                </SelectContent>
              </Select>
              {kind === "Acknowledgment" && (
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  PDF only. Per-page initial checkpoints and a final acknowledgment are generated
                  automatically — you can adjust them next.
                </p>
              )}
              {isLink && (
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  A link gives the person the blank form; the completed copy is uploaded to their
                  staff record.
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
            {/* DOC-3: exactly one of these two renders. The File input is not
                merely hidden on a Link — it is unmounted, so its `required`
                cannot block a submit for a field the admin was never shown. */}
            {/* THE `key` ON EACH BRANCH IS LOAD-BEARING, NOT DECORATION. Both
                branches render an <input> in the same position, so React
                reconciles them as ONE element and the file input (uncontrolled,
                ref-based) becomes the URL input (controlled, value-bound)
                in place — which logs "changing an uncontrolled input to be
                controlled" and leaves the previous input's DOM state attached
                to the new one. Caught in the browser, not by the build: it is a
                runtime warning and typechecks perfectly. Distinct keys make
                them two elements, which is what they are. */}
            {isLink ? (
              <div key="link-field" className="space-y-1.5">
                <Label>Link *</Label>
                <Input
                  required
                  type="url"
                  value={externalUrl}
                  onChange={(e) => setExternalUrl(e.target.value)}
                  placeholder="https://www.uscis.gov/sites/default/files/document/forms/i-9.pdf"
                />
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Must be a full https:// address. Staff see the site it points to.
                </p>
              </div>
            ) : (
              <div key="file-field" className="space-y-1.5">
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
            )}
            {/* Ruling 3: instructions are offered on EVERY kind, not just Link. */}
            <div className="space-y-1.5">
              <Label>Instructions</Label>
              <RichTextEditor
                value={instructionsHtml}
                onChange={setInstructionsHtml}
                placeholder="What the person should do with this document"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Instructions video</Label>
              <Input
                type="url"
                value={instructionsVideoUrl}
                onChange={(e) => setInstructionsVideoUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
              />
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Optional. A YouTube link plays inline; anything else shows as a link.
              </p>
            </div>
            {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              {/* Nothing is uploaded on a Link path, so the button does not say
                  so — the word is the only thing telling the admin what the
                  submit is about to do. */}
              <Button type="submit" disabled={saving}>
                {isLink ? (saving ? "Saving..." : "Save Link") : saving ? "Uploading..." : "Upload"}
              </Button>
            </DialogFooter>
          </form>
          )}
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
  // DOC-3 (4g). The URL is editable on a Link — unlike an uploaded file, which
  // is immutable by design — and instructions are editable on every kind.
  const [externalUrl, setExternalUrl] = useState(doc.externalUrl ?? "")
  const [instructionsHtml, setInstructionsHtml] = useState(doc.instructionsHtml ?? "")
  const [instructionsVideoUrl, setInstructionsVideoUrl] = useState(doc.instructionsVideoUrl ?? "")
  const router = useRouter()
  const isLink = doc.kind === "Link"

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isLink && !isValidExternalDocumentUrl(externalUrl.trim())) {
      setError(EXTERNAL_URL_ERROR)
      return
    }
    setSaving(true)
    setError("")
    try {
      const res = await fetch(`/api/hr/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          category,
          // externalUrl is sent ONLY for a Link. The route 400s it on any other
          // kind, so sending it unconditionally would break editing the title
          // of every Reference in the library.
          ...(isLink ? { externalUrl: externalUrl.trim() } : {}),
          instructionsHtml: instructionsHtml.trim() || null,
          instructionsVideoUrl: instructionsVideoUrl.trim() || null,
        }),
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
            {isLink && (
              <div className="space-y-1.5">
                <Label>Link *</Label>
                <Input
                  required
                  type="url"
                  value={externalUrl}
                  onChange={(e) => setExternalUrl(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Instructions</Label>
              <RichTextEditor
                value={instructionsHtml}
                onChange={setInstructionsHtml}
                placeholder="What the person should do with this document"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Instructions video</Label>
              <Input
                type="url"
                value={instructionsVideoUrl}
                onChange={(e) => setInstructionsVideoUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
              />
            </div>
            {/* The file-immutability note is FILE-SPECIFIC and would be a lie on
                a Link, whose whole point is that the destination can be
                corrected without re-uploading anything (DOC-3). */}
            {!isLink && (
              <p className="text-xs text-[var(--color-muted-foreground)]">
                The uploaded file itself can&apos;t be replaced — add a new document instead.
              </p>
            )}
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

// DOC-1 B — the other half of Archive, which shipped without one. No
// AlertDialog: the design-system rule asks for a confirmation on DESTRUCTIVE
// actions, and this is the undo. Putting a "are you sure you want to restore"
// in front of it would make the recoverable action feel as heavy as the one it
// recovers from.
function RestoreDocumentButton({ doc }: { doc: HrDocumentRow }) {
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  async function handleRestore() {
    setSaving(true)
    try {
      await fetch(`/api/hr/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true }),
      })
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <button
      onClick={handleRestore}
      disabled={saving}
      className="p-1.5 rounded hover:bg-[var(--color-accent)] disabled:opacity-50"
      title="Restore document"
    >
      <ArchiveRestore className="h-4 w-4 text-[var(--color-muted-foreground)]" />
    </button>
  )
}
