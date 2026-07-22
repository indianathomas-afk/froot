"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Archive, FileSignature, Link2, Plus, Settings2 } from "lucide-react"
import { Button } from "@/components/ui/button"
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  HR_CATEGORY_LABELS,
  HR_CATEGORY_STYLES,
  HR_DOCUMENT_CATEGORIES,
  type HrDocumentCategory,
} from "@/lib/hr-documents"

export interface HrFormRow {
  id: string
  title: string
  category: string
  fieldCount: number
  currentVersionNumber: number
  submissionCount: number
  linkedFormId: string | null
  linkedFormTitle: string | null
}

export function HrFormsClient({ forms }: { forms: HrFormRow[] }) {
  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Agreement Forms</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            Fillable agreements (key, pay) staff and a supervisor sign together — executed from each
            staff member&apos;s Documents tab
          </p>
        </div>
        <CreateFormButton />
      </div>

      {forms.length === 0 ? (
        <div className="flex items-center justify-center min-h-[40vh] border border-dashed border-[var(--color-border)] rounded-lg">
          <div className="text-center max-w-md px-6">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center">
              <FileSignature className="h-6 w-6 text-[var(--color-primary)]" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--color-foreground)] mb-2">No forms yet</h2>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Build your first agreement — the fixed policy language plus the blanks to fill — and
              managers can execute it with any staff member.
            </p>
            <div className="mt-6 flex justify-center">
              <CreateFormButton label="Build the first form" />
            </div>
          </div>
        </div>
      ) : (
        <div className="border border-[var(--color-border)] rounded-lg divide-y divide-[var(--color-border)] bg-[var(--color-card)]">
          {forms.map((form) => (
            <div key={form.id} className="flex items-center gap-4 p-4">
              <div className="w-9 h-9 rounded-lg bg-[var(--color-primary)]/10 flex items-center justify-center shrink-0">
                <FileSignature className="h-4 w-4 text-[var(--color-primary)]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-[var(--color-foreground)] truncate">{form.title}</p>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${HR_CATEGORY_STYLES[form.category as HrDocumentCategory] ?? HR_CATEGORY_STYLES.Other}`}>
                    {HR_CATEGORY_LABELS[form.category as HrDocumentCategory] ?? form.category}
                  </span>
                  {form.linkedFormTitle && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/20"
                      title={`Paired with ${form.linkedFormTitle}`}
                    >
                      <Link2 className="h-3 w-3" />
                      {form.linkedFormTitle}
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
                  v{form.currentVersionNumber} · {form.fieldCount} {form.fieldCount === 1 ? "field" : "fields"} ·{" "}
                  {form.submissionCount} {form.submissionCount === 1 ? "submission" : "submissions"}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Link
                  href={`/hr/forms/${form.id}`}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)] hover:opacity-80 transition-opacity mr-2"
                >
                  <Settings2 className="h-4 w-4" />
                  Edit
                </Link>
                <ArchiveFormButton form={form} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Create collects just title + category; the new form lands on the builder to
// write the agreement language and fields (same pattern as new signature
// documents landing on the checkpoint editor).
function CreateFormButton({ label = "New Form" }: { label?: string }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [title, setTitle] = useState("")
  const [category, setCategory] = useState<HrDocumentCategory>("HRManagement")
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/hr/forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, category }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Failed to create the form")
        return
      }
      setOpen(false)
      router.push(`/hr/forms/${data.id}`)
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
            <DialogTitle>New Agreement Form</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Key Agreement — Check-Out"
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
            <p className="text-xs text-[var(--color-muted-foreground)]">
              You&apos;ll write the agreement text and add the fillable fields next.
            </p>
            {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? "Creating..." : "Create & Edit"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ArchiveFormButton({ form }: { form: HrFormRow }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  async function handleArchive() {
    setSaving(true)
    try {
      await fetch(`/api/hr/forms/${form.id}`, {
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
        title="Archive form"
      >
        <Archive className="h-4 w-4 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]" />
      </button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive &ldquo;{form.title}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              The form can no longer be executed. Completed submissions and their signed records are
              kept permanently — nothing is deleted.
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
