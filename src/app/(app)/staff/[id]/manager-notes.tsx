"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { Pencil, StickyNote, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { NOTE_CATEGORIES, CATEGORY_STYLES, type NoteCategory } from "@/lib/manager-notes"

export type SerializedNote = {
  id: string
  category: string
  body: string
  createdAt: string
  updatedAt: string
  authorUserId: string
  authorName: string | null
  authorEmail: string | null
}

function CategoryChip({ category }: { category: string }) {
  const style = CATEGORY_STYLES[category as NoteCategory] ?? CATEGORY_STYLES.General
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>
      {category}
    </span>
  )
}

function CategorySelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id?: string
  value: NoteCategory
  onChange: (value: NoteCategory) => void
  disabled?: boolean
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as NoteCategory)} disabled={disabled}>
      <SelectTrigger id={id} className="w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {NOTE_CATEGORIES.map((c) => (
          <SelectItem key={c} value={c}>
            {c}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function ManagerNotes({
  staffId,
  notes,
  viewerRole,
  viewerUserId,
}: {
  staffId: string
  notes: SerializedNote[]
  viewerRole: string
  viewerUserId: string
}) {
  const router = useRouter()
  const [body, setBody] = useState("")
  const [category, setCategory] = useState<NoteCategory>("General")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<NoteCategory | null>(null)

  async function addNote() {
    if (!body.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/staff/${staffId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, body: body.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error ?? "Failed to add note")
        return
      }
      setBody("")
      setCategory("General")
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  const visibleNotes = filter ? notes.filter((n) => n.category === filter) : notes

  return (
    <div className="space-y-4">
      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-[var(--color-foreground)]">Add new note</h2>
          <p className="text-xs text-[var(--color-muted-foreground)]">Only managers can see this.</p>
        </div>
        <div className="space-y-3">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a note about this team member…"
            rows={3}
            disabled={saving}
          />
          <div className="flex items-end justify-between gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="note-category" className="text-xs text-[var(--color-muted-foreground)]">
                Category
              </Label>
              <CategorySelect id="note-category" value={category} onChange={setCategory} disabled={saving} />
            </div>
            <Button onClick={addNote} disabled={saving || !body.trim()}>
              {saving ? "Adding…" : "Add note"}
            </Button>
          </div>
          {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
        </div>
      </div>

      {notes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setFilter(null)}
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium border ${
              filter === null
                ? "bg-[var(--color-primary)] text-white border-transparent"
                : "bg-[var(--color-card)] text-[var(--color-muted-foreground)] border-[var(--color-border)] hover:text-[var(--color-foreground)]"
            }`}
          >
            All
          </button>
          {NOTE_CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setFilter(filter === c ? null : c)}
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                filter === c
                  ? CATEGORY_STYLES[c]
                  : "bg-[var(--color-card)] text-[var(--color-muted-foreground)] border border-[var(--color-border)] hover:text-[var(--color-foreground)]"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {visibleNotes.length === 0 ? (
        <div className="border border-dashed border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-12 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-[var(--color-muted)] flex items-center justify-center">
            <StickyNote className="h-6 w-6 text-[var(--color-muted-foreground)]" />
          </div>
          <p className="font-medium text-[var(--color-foreground)] mb-1">
            {notes.length === 0 ? "No notes yet" : "No notes in this category"}
          </p>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {notes.length === 0
              ? "No notes yet — add the first one."
              : "Pick another category or clear the filter."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {visibleNotes.map((note) => (
            <NoteCard
              key={note.id}
              staffId={staffId}
              note={note}
              viewerRole={viewerRole}
              viewerUserId={viewerUserId}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function NoteCard({
  staffId,
  note,
  viewerRole,
  viewerUserId,
}: {
  staffId: string
  note: SerializedNote
  viewerRole: string
  viewerUserId: string
}) {
  const router = useRouter()
  const isAuthor = note.authorUserId === viewerUserId
  const canDelete = isAuthor || viewerRole === "ADMIN"

  const [editOpen, setEditOpen] = useState(false)
  const [editBody, setEditBody] = useState(note.body)
  const [editCategory, setEditCategory] = useState<NoteCategory>(
    (NOTE_CATEGORIES as readonly string[]).includes(note.category)
      ? (note.category as NoteCategory)
      : "General"
  )
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // @updatedAt is written on create too, so the timestamps differ by a few ms
  // even on untouched notes — only call it edited past a small tolerance.
  const edited = new Date(note.updatedAt).getTime() - new Date(note.createdAt).getTime() > 2000

  async function saveEdit() {
    if (!editBody.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/staff/${staffId}/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: editCategory, body: editBody.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error ?? "Failed to save changes")
        return
      }
      setEditOpen(false)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function deleteNote() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/staff/${staffId}/notes/${note.id}`, { method: "DELETE" })
      if (res.ok) router.refresh()
    } finally {
      setBusy(false)
      setDeleteOpen(false)
    }
  }

  return (
    <li className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4">
      <div className="flex items-start justify-between gap-3">
        <CategoryChip category={note.category} />
        {(isAuthor || canDelete) && (
          <div className="flex items-center gap-1">
            {isAuthor && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[var(--color-muted-foreground)]"
                onClick={() => {
                  setEditBody(note.body)
                  setEditOpen(true)
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
                <span className="sr-only">Edit note</span>
              </Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="sr-only">Delete note</span>
              </Button>
            )}
          </div>
        )}
      </div>
      <p className="text-sm text-[var(--color-foreground)] whitespace-pre-wrap mt-2">{note.body}</p>
      <p className="text-xs text-[var(--color-muted-foreground)] mt-3">
        {note.authorName ?? note.authorEmail ?? "Former user"} ·{" "}
        {format(new Date(note.createdAt), "MMM d, yyyy 'at' h:mmaaa")}
        {edited && <span className="italic"> · edited</span>}
      </p>

      <Dialog open={editOpen} onOpenChange={(open) => !busy && setEditOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit note</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              rows={4}
              disabled={busy}
            />
            <div className="space-y-1.5">
              <Label htmlFor={`edit-category-${note.id}`} className="text-xs text-[var(--color-muted-foreground)]">
                Category
              </Label>
              <CategorySelect
                id={`edit-category-${note.id}`}
                value={editCategory}
                onChange={setEditCategory}
                disabled={busy}
              />
            </div>
            {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={busy || !editBody.trim()}>
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={(open) => !busy && setDeleteOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this note?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the note for every manager. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                deleteNote()
              }}
              disabled={busy}
              className="bg-[var(--color-destructive)] text-white hover:bg-[var(--color-destructive)]/90"
            >
              {busy ? "Deleting…" : "Delete note"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}
