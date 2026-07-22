"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { Upload, FileText, Trash2, Eye, EyeOff, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { uploadHrFileFromBrowser } from "@/lib/hr-upload-client"

export type StaffUploadRow = {
  id: string
  title: string
  category: string | null
  fileName: string
  sizeBytes: number
  visibleToStaff: boolean
  uploadedByName: string | null
  createdAt: string
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// HR-7.6: manager-uploaded documents for one staff member, with the per-doc
// team-visibility switch. Upload uses the HR-3 presigned browser flow (files
// go straight to the private store). Employees see visible docs in
// /my/documents; not-visible docs stay manager/admin-only.
export function StaffUploadedDocuments({
  staffId,
  staffName,
  rows,
}: {
  staffId: string
  staffName: string
  rows: StaffUploadRow[]
}) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState("")
  const [category, setCategory] = useState("")
  const [visible, setVisible] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  function resetForm() {
    setFile(null)
    setTitle("")
    setCategory("")
    setVisible(false)
    setError(null)
    if (fileRef.current) fileRef.current.value = ""
  }

  async function handleUpload() {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const up = await uploadHrFileFromBrowser(file, `/api/staff/${staffId}/documents/upload-url`)
      if (!up.ok) {
        setError(up.error)
        return
      }
      const res = await fetch(`/api/staff/${staffId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileUrl: up.url,
          fileName: file.name,
          title: title.trim() || file.name,
          category: category.trim() || null,
          visibleToStaff: visible,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error ?? "Failed to save the document")
        return
      }
      setOpen(false)
      resetForm()
      router.refresh()
    } finally {
      setUploading(false)
    }
  }

  async function toggleVisible(row: StaffUploadRow) {
    setBusyId(row.id)
    try {
      await fetch(`/api/staff/${staffId}/documents/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibleToStaff: !row.visibleToStaff }),
      })
      router.refresh()
    } finally {
      setBusyId(null)
    }
  }

  async function remove(row: StaffUploadRow) {
    setBusyId(row.id)
    try {
      await fetch(`/api/staff/${staffId}/documents/${row.id}`, { method: "DELETE" })
      router.refresh()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-foreground)]">Uploaded Documents</h2>
          <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
            Scanned or photographed paper forms. Toggle visibility to share one with {staffName} in their portal.
          </p>
        </div>
        <Button size="sm" onClick={() => { resetForm(); setOpen(true) }}>
          <Upload className="h-4 w-4 mr-1.5" />
          Upload Document
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">No uploaded documents yet.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-3 py-3">
              <FileText className="h-5 w-5 shrink-0 text-[var(--color-muted-foreground)]" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--color-foreground)] truncate">{row.title}</p>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  {row.category ? `${row.category} · ` : ""}
                  {fmtSize(row.sizeBytes)} · {format(new Date(row.createdAt), "MMM d, yyyy")}
                  {row.uploadedByName ? ` · ${row.uploadedByName}` : ""}
                </p>
              </div>

              <a
                href={`/api/staff/${staffId}/documents/${row.id}/download`}
                target="_blank"
                rel="noopener"
                className="p-2 rounded hover:bg-[var(--color-accent)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                title="Download"
              >
                <Download className="h-4 w-4" />
              </a>

              <label className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)] cursor-pointer">
                {row.visibleToStaff ? (
                  <Eye className="h-4 w-4 text-[var(--color-primary)]" />
                ) : (
                  <EyeOff className="h-4 w-4" />
                )}
                <span className="hidden sm:inline w-24">
                  {row.visibleToStaff ? "Visible to staff" : "Not visible"}
                </span>
                <Switch
                  checked={row.visibleToStaff}
                  disabled={busyId === row.id}
                  onCheckedChange={() => toggleVisible(row)}
                />
              </label>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    className="p-2 rounded hover:bg-[var(--color-accent)] text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]"
                    title="Delete"
                    disabled={busyId === row.id}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this document?</AlertDialogTitle>
                    <AlertDialogDescription>
                      “{row.title}” will be removed from {staffName}&apos;s record. This can&apos;t be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => remove(row)}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>File</Label>
              <Input
                ref={fileRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null
                  setFile(f)
                  if (f && !title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ""))
                }}
              />
              <p className="text-xs text-[var(--color-muted-foreground)]">PDF, image, or Word doc up to 25 MB.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Signed pay agreement" />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Pay, Disciplinary, Onboarding" />
            </div>
            <label className="flex items-start gap-3 cursor-pointer">
              <Switch checked={visible} onCheckedChange={setVisible} className="mt-0.5" />
              <span className="text-sm text-[var(--color-foreground)]">
                Visible to {staffName}
                <span className="block text-xs text-[var(--color-muted-foreground)]">
                  When on, this document appears in their self-service portal. Leave off for internal-only records
                  like write-ups.
                </span>
              </span>
            </label>
            {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={uploading || !file || title.trim() === ""}>
              {uploading ? "Uploading..." : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
