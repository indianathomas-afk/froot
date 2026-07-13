"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { StickyNote } from "lucide-react"
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
              <Select value={category} onValueChange={(v) => setCategory(v as NoteCategory)}>
                <SelectTrigger id="note-category" className="w-44">
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
            </div>
            <Button onClick={addNote} disabled={saving || !body.trim()}>
              {saving ? "Adding…" : "Add note"}
            </Button>
          </div>
          {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
        </div>
      </div>

      {notes.length === 0 ? (
        <div className="border border-dashed border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-12 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-[var(--color-muted)] flex items-center justify-center">
            <StickyNote className="h-6 w-6 text-[var(--color-muted-foreground)]" />
          </div>
          <p className="font-medium text-[var(--color-foreground)] mb-1">No notes yet</p>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            No notes yet — add the first one.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => (
            <NoteCard key={note.id} note={note} viewerRole={viewerRole} viewerUserId={viewerUserId} />
          ))}
        </ul>
      )}
    </div>
  )
}

function NoteCard({
  note,
}: {
  note: SerializedNote
  viewerRole: string
  viewerUserId: string
}) {
  // @updatedAt is written on create too, so the timestamps differ by a few ms
  // even on untouched notes — only call it edited past a small tolerance.
  const edited = new Date(note.updatedAt).getTime() - new Date(note.createdAt).getTime() > 2000

  return (
    <li className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4">
      <div className="flex items-start justify-between gap-3">
        <CategoryChip category={note.category} />
      </div>
      <p className="text-sm text-[var(--color-foreground)] whitespace-pre-wrap mt-2">{note.body}</p>
      <p className="text-xs text-[var(--color-muted-foreground)] mt-3">
        {note.authorName ?? note.authorEmail ?? "Former user"} ·{" "}
        {format(new Date(note.createdAt), "MMM d, yyyy 'at' h:mmaaa")}
        {edited && <span className="italic"> · edited</span>}
      </p>
    </li>
  )
}
