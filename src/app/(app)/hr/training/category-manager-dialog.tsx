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

// HR-21. Category management lives WITH the list it categorises (ruled for
// templates 2026-08-07, carried here 2026-08-10) — third instance of the
// manager-dialog pattern: inventory's category-manager-dialog.tsx →
// templates' type-manager-dialog.tsx → this file. Copied from the templates
// instance, the newer of the pair (its routes do safeParse + 409 where the
// older one 500s on malformed body and duplicate name).
//
// NO ROLE CHECK HERE, deliberately: /hr/training's server shell already
// redirects non-ADMIN away, and every route this dialog calls guards itself
// with requireHrTrainingAccess. A second check here would be the one guard on
// this surface that could disagree with those.

export type TrainingCategory = {
  id: string
  name: string
  colorKey: string
  sortOrder: number
  // Org-wide and archived-inclusive, computed by the API — this is the count
  // that governs deletion, deliberately NOT the per-view chip count.
  moduleCount: number
}

export function CategoryManagerDialog({
  open,
  categories,
  onClose,
  onChanged,
}: {
  open: boolean
  categories: TrainingCategory[]
  onClose: () => void
  onChanged: () => Promise<void> | void
}) {
  const [newName, setNewName] = useState("")
  const [newColor, setNewColor] = useState<string>("gray")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, { name: string; colorKey: string }>>({})
  const [pendingRename, setPendingRename] = useState<{ id: string; from: string; to: string; colorKey: string; count: number } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<TrainingCategory | null>(null)
  const [reassigning, setReassigning] = useState<TrainingCategory | null>(null)
  const [reassignTo, setReassignTo] = useState("")

  function draftOf(c: TrainingCategory) {
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
    const ok = await call(`/api/hr/training/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
    if (ok) clearEdit(id)
  }

  // A rename on a category in use changes the badge on every module wearing it,
  // in both page views, immediately — allowed, but never silently: the operator
  // sees the count first (ruling 4, the Manage Types interaction shape).
  function handleSaveRow(c: TrainingCategory) {
    const draft = draftOf(c)
    const renamed = draft.name.trim() !== c.name
    if (renamed && c.moduleCount > 0) {
      setPendingRename({ id: c.id, from: c.name, to: draft.name.trim(), colorKey: draft.colorKey, count: c.moduleCount })
      return
    }
    patchCategory(c.id, { name: draft.name.trim(), colorKey: draft.colorKey })
  }

  async function handleAdd() {
    setSaving(true)
    try {
      const ok = await call("/api/hr/training/categories", {
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
  async function move(c: TrainingCategory, direction: -1 | 1) {
    const idx = categories.findIndex((x) => x.id === c.id)
    const other = categories[idx + direction]
    if (!other) return
    await call(`/api/hr/training/categories/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sortOrder: other.sortOrder }),
    })
    await call(`/api/hr/training/categories/${other.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sortOrder: c.sortOrder }),
    })
  }

  async function handleReassign() {
    if (!reassigning || !reassignTo) return
    const ok = await call(`/api/hr/training/categories/${reassigning.id}/reassign`, {
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
            <DialogTitle>Training Categories</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {/* Add */}
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="text-xs text-[var(--color-muted-foreground)]">Name</label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Food Safety" />
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
                const inUse = c.moduleCount > 0
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
                      {c.moduleCount} module{c.moduleCount === 1 ? "" : "s"}
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
              A category in use cannot be deleted. Reassign its modules to another category first — the count includes archived modules.
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
              {pendingRename?.count} module{pendingRename?.count === 1 ? "" : "s"} use this category. Their badges will
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
              No modules use this category, so nothing else changes. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--color-destructive)] hover:bg-[var(--color-destructive)]/90"
              onClick={() => {
                if (!pendingDelete) return
                call(`/api/hr/training/categories/${pendingDelete.id}`, { method: "DELETE" })
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
            <DialogTitle>Reassign modules from &ldquo;{reassigning?.name}&rdquo;</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Move {reassigning?.moduleCount} module{reassigning?.moduleCount === 1 ? "" : "s"} to another category.
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
