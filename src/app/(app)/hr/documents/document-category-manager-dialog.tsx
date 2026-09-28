"use client"

import { useState } from "react"
import { Trash2, ChevronUp, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { BADGE_PRESETS, BADGE_PRESET_KEYS, badgePreset } from "@/lib/badge-presets"

// DOC-5. A COPY of hr/training/category-manager-dialog.tsx (HR-20/21), adapted
// to document categories — F6, Gary 2026-09-28: copy, do not refactor Training's
// component into a shared one, so Training's blast radius stays zero. If you
// fix a bug in one, check the other.
//
// One taxonomy covers library documents AND agreement forms (F7), so every
// count here is both, archived included — the count that governs deletion.
// Delete while in use is HR-20's exactly (F4): the trash icon becomes Reassign,
// and the route 409s as the backstop.
//
// NO ROLE CHECK HERE, deliberately: /hr/documents mounts this only for ADMIN,
// and every route it calls guards itself with requireHrDocumentAccess({ admin:
// true }) (F5). A second check here could only disagree with those.

export type DocumentCategory = {
  id: string
  name: string
  colorKey: string
  sortOrder: number
  // Org-wide and archived-inclusive, computed by the API — this is the count
  // that governs deletion, deliberately NOT the per-view chip count.
  documentCount: number
}

export function DocumentCategoryManagerDialog({
  open,
  categories,
  onClose,
  onChanged,
}: {
  open: boolean
  categories: DocumentCategory[]
  onClose: () => void
  onChanged: () => Promise<void> | void
}) {
  const [newName, setNewName] = useState("")
  const [newColor, setNewColor] = useState<string>("gray")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, { name: string; colorKey: string }>>({})
  const [pendingRename, setPendingRename] = useState<{ id: string; from: string; to: string; colorKey: string; count: number } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<DocumentCategory | null>(null)
  const [reassigning, setReassigning] = useState<DocumentCategory | null>(null)
  const [reassignTo, setReassignTo] = useState("")

  function draftOf(c: DocumentCategory) {
    return edits[c.id] ?? { name: c.name, colorKey: c.colorKey }
  }

  function clearEdit(id: string) {
    setEdits((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  async function call(url: string, init: RequestInit): Promise<boolean> {
    setError(null)
    const res = await fetch(url, init)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? "Something went wrong")
      return false
    }
    await onChanged()
    return true
  }

  async function patchCategory(id: string, patch: { name?: string; colorKey?: string; sortOrder?: number }) {
    const ok = await call(`/api/hr/documents/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
    if (ok) clearEdit(id)
  }

  // A rename on a category in use changes the chip on every document and form
  // wearing it, on every surface, immediately — allowed, but never silently: the operator
  // sees the count first (ruling 4, the Manage Types interaction shape).
  function handleSaveRow(c: DocumentCategory) {
    const draft = draftOf(c)
    const renamed = draft.name.trim() !== c.name
    if (renamed && c.documentCount > 0) {
      setPendingRename({ id: c.id, from: c.name, to: draft.name.trim(), colorKey: draft.colorKey, count: c.documentCount })
      return
    }
    patchCategory(c.id, { name: draft.name.trim(), colorKey: draft.colorKey })
  }

  async function handleAdd() {
    setSaving(true)
    try {
      const ok = await call("/api/hr/documents/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), colorKey: newColor, sortOrder: categories.length }),
      })
      if (ok) {
        setNewName("")
        setNewColor("gray")
      }
    } finally {
      setSaving(false)
    }
  }

  // Swap sortOrder with the neighbour. Two PATCHes rather than a drag handle —
  // the list is short and this needs no new dependency.
  async function move(c: DocumentCategory, direction: -1 | 1) {
    const idx = categories.findIndex((x) => x.id === c.id)
    const other = categories[idx + direction]
    if (!other) return
    await call(`/api/hr/documents/categories/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sortOrder: other.sortOrder }),
    })
    await call(`/api/hr/documents/categories/${other.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sortOrder: c.sortOrder }),
    })
  }

  async function handleReassign() {
    if (!reassigning || !reassignTo) return
    const ok = await call(`/api/hr/documents/categories/${reassigning.id}/reassign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toCategoryId: reassignTo }),
    })
    if (ok) {
      setReassigning(null)
      setReassignTo("")
    }
  }

  const reassignTargets = reassigning ? categories.filter((c) => c.id !== reassigning.id) : []

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Document Categories</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {/* Add */}
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="text-xs text-[var(--color-muted-foreground)]">Name</label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Safety" />
              </div>
              <div className="w-36">
                <label className="text-xs text-[var(--color-muted-foreground)]">Colour</label>
                <ColorSelect value={newColor} onChange={setNewColor} />
              </div>
              <Button size="sm" onClick={handleAdd} disabled={saving || !newName.trim()}>Add</Button>
            </div>

            {error && <p className="text-xs text-[var(--color-destructive)]">{error}</p>}

            <div className="max-h-80 overflow-y-auto space-y-1.5">
              {categories.length === 0 && (
                <p className="text-sm text-[var(--color-muted-foreground)] text-center py-6">No categories yet.</p>
              )}
              {categories.map((c, i) => {
                const draft = draftOf(c)
                const dirty = draft.name.trim() !== c.name || draft.colorKey !== c.colorKey
                const inUse = c.documentCount > 0
                return (
                  <div key={c.id} className="flex items-center gap-2 px-3 py-2 rounded-md border border-[var(--color-border)]">
                    <span className={`h-3 w-3 shrink-0 rounded-full ${badgePreset(draft.colorKey).dot}`} />
                    <Input
                      className="h-8 flex-1"
                      value={draft.name}
                      onChange={(e) => setEdits((p) => ({ ...p, [c.id]: { ...draft, name: e.target.value } }))}
                    />
                    <div className="w-32">
                      <ColorSelect
                        value={draft.colorKey}
                        onChange={(color) => setEdits((p) => ({ ...p, [c.id]: { ...draft, colorKey: color } }))}
                      />
                    </div>
                    <span className="w-20 shrink-0 text-xs text-[var(--color-muted-foreground)] text-right">
                      {c.documentCount} document{c.documentCount === 1 ? "" : "s"}
                    </span>
                    <div className="flex flex-col">
                      <button
                        onClick={() => move(c, -1)}
                        disabled={i === 0}
                        aria-label={`Move ${c.name} up`}
                        className="p-0.5 rounded hover:bg-[var(--color-accent)] disabled:opacity-30"
                      >
                        <ChevronUp className="h-3 w-3 text-[var(--color-muted-foreground)]" />
                      </button>
                      <button
                        onClick={() => move(c, 1)}
                        disabled={i === categories.length - 1}
                        aria-label={`Move ${c.name} down`}
                        className="p-0.5 rounded hover:bg-[var(--color-accent)] disabled:opacity-30"
                      >
                        <ChevronDown className="h-3 w-3 text-[var(--color-muted-foreground)]" />
                      </button>
                    </div>
                    {dirty && (
                      <Button size="sm" variant="outline" onClick={() => handleSaveRow(c)}>Save</Button>
                    )}
                    {inUse ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setReassigning(c); setReassignTo("") }}
                      >
                        Reassign
                      </Button>
                    ) : (
                      <button
                        onClick={() => setPendingDelete(c)}
                        aria-label={`Delete ${c.name}`}
                        className="p-1 rounded hover:bg-[var(--color-accent)]"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              A category in use cannot be deleted. Reassign its documents to another category first — the count includes agreement forms and archived documents.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename confirmation — the blast radius, before it fires. */}
      <AlertDialog open={!!pendingRename} onOpenChange={(o) => !o && setPendingRename(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Rename &ldquo;{pendingRename?.from}&rdquo; to &ldquo;{pendingRename?.to}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRename?.count} document{pendingRename?.count === 1 ? " uses" : "s use"} this category. Their chips will
              show the new name everywhere immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingRename) return
                patchCategory(pendingRename.id, { name: pendingRename.to, colorKey: pendingRename.colorKey })
                setPendingRename(null)
              }}
            >
              Rename
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation — house rule: every destructive action confirms. */}
      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{pendingDelete?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              No documents or forms use this category, so nothing else changes. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--color-destructive)] hover:bg-[var(--color-destructive)]/90"
              onClick={() => {
                if (!pendingDelete) return
                call(`/api/hr/documents/categories/${pendingDelete.id}`, { method: "DELETE" })
                setPendingDelete(null)
              }}
            >
              Delete Category
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reassign — the path that unlocks delete. */}
      <Dialog open={!!reassigning} onOpenChange={(o) => !o && setReassigning(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reassign documents from &ldquo;{reassigning?.name}&rdquo;</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Move {reassigning?.documentCount} document{reassigning?.documentCount === 1 ? "" : "s"} to another category.
              Once this category is empty it can be deleted.
            </p>
            {reassignTargets.length === 0 ? (
              <p className="text-sm text-[var(--color-destructive)]">
                There is no other category to move them to. Create one first.
              </p>
            ) : (
              <Select value={reassignTo} onValueChange={setReassignTo}>
                <SelectTrigger><SelectValue placeholder="Select a category" /></SelectTrigger>
                <SelectContent>
                  {reassignTargets.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${badgePreset(c.colorKey).dot}`} />
                        {c.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {error && <p className="text-xs text-[var(--color-destructive)]">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReassigning(null)}>Cancel</Button>
            <Button onClick={handleReassign} disabled={!reassignTo}>Reassign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ColorSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
      <SelectContent>
        {BADGE_PRESET_KEYS.map((k) => (
          <SelectItem key={k} value={k}>
            <span className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${BADGE_PRESETS[k].dot}`} />
              {BADGE_PRESETS[k].label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
