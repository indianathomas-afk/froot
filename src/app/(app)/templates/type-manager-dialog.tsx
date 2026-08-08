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

// TPL-1b. Type management lives WITH templates, not in Settings (Gary,
// 2026-08-07 — this supersedes the Settings-tab placement in the Phase A plan).
// A dialog rather than a subroute, following the precedent this file is modelled
// on: src/app/(app)/inventory/ingredients/category-manager-dialog.tsx, where
// ingredient categories are managed from the Ingredients page. The surface is a
// short list with inline edits; a subroute would need its own layout and its own
// capability guard, and would navigate away from the list you are about to filter.
//
// NO CAPABILITY CHECK HERE, deliberately: templates/layout.tsx already gates the
// entire /templates surface on templates.manage (ADMIN_ONLY), so a user who can
// see this button has already passed it. Adding a second check would be the one
// guard on this surface that could disagree with the layout.

export type TemplateType = {
  id: string
  name: string
  colorKey: string
  sortOrder: number
  templateCount: number
}

export function TypeManagerDialog({
  open,
  types,
  onClose,
  onChanged,
}: {
  open: boolean
  types: TemplateType[]
  onClose: () => void
  onChanged: () => Promise<void> | void
}) {
  const [newName, setNewName] = useState("")
  const [newColor, setNewColor] = useState<string>("gray")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, { name: string; colorKey: string }>>({})
  const [pendingRename, setPendingRename] = useState<{ id: string; from: string; to: string; colorKey: string; count: number } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<TemplateType | null>(null)
  const [reassigning, setReassigning] = useState<TemplateType | null>(null)
  const [reassignTo, setReassignTo] = useState("")

  function draftOf(t: TemplateType) {
    return edits[t.id] ?? { name: t.name, colorKey: t.colorKey }
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

  async function patchType(id: string, patch: { name?: string; colorKey?: string; sortOrder?: number }) {
    const ok = await call(`/api/template-types/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
    if (ok) clearEdit(id)
  }

  // A rename on a type in use rewrites the type shown on every historical
  // completed checklist and every print copy, because Checklist holds no
  // snapshot of it (docs/prompts/TYPE-1_AUDIT.md §3.4). That trade is DEBT-36's
  // accepted class, ruled 2026-08-07 — so the rename is allowed, but never
  // silently: the operator sees the count first (Gary, Q4).
  function handleSaveRow(t: TemplateType) {
    const draft = draftOf(t)
    const renamed = draft.name.trim() !== t.name
    if (renamed && t.templateCount > 0) {
      setPendingRename({ id: t.id, from: t.name, to: draft.name.trim(), colorKey: draft.colorKey, count: t.templateCount })
      return
    }
    patchType(t.id, { name: draft.name.trim(), colorKey: draft.colorKey })
  }

  async function handleAdd() {
    setSaving(true)
    try {
      const ok = await call("/api/template-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), colorKey: newColor, sortOrder: types.length }),
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
  async function move(t: TemplateType, direction: -1 | 1) {
    const idx = types.findIndex((x) => x.id === t.id)
    const other = types[idx + direction]
    if (!other) return
    await call(`/api/template-types/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sortOrder: other.sortOrder }),
    })
    await call(`/api/template-types/${other.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sortOrder: t.sortOrder }),
    })
  }

  async function handleReassign() {
    if (!reassigning || !reassignTo) return
    const ok = await call(`/api/template-types/${reassigning.id}/reassign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toTypeId: reassignTo }),
    })
    if (ok) {
      setReassigning(null)
      setReassignTo("")
    }
  }

  const reassignTargets = reassigning ? types.filter((t) => t.id !== reassigning.id) : []

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Template Types</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {/* Add */}
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="text-xs text-[var(--color-muted-foreground)]">Name</label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Prep" />
              </div>
              <div className="w-36">
                <label className="text-xs text-[var(--color-muted-foreground)]">Colour</label>
                <ColorSelect value={newColor} onChange={setNewColor} />
              </div>
              <Button size="sm" onClick={handleAdd} disabled={saving || !newName.trim()}>Add</Button>
            </div>

            {error && <p className="text-xs text-[var(--color-destructive)]">{error}</p>}

            <div className="max-h-80 overflow-y-auto space-y-1.5">
              {types.length === 0 && (
                <p className="text-sm text-[var(--color-muted-foreground)] text-center py-6">No types yet.</p>
              )}
              {types.map((t, i) => {
                const draft = draftOf(t)
                const dirty = draft.name.trim() !== t.name || draft.colorKey !== t.colorKey
                const inUse = t.templateCount > 0
                return (
                  <div key={t.id} className="flex items-center gap-2 px-3 py-2 rounded-md border border-[var(--color-border)]">
                    <span className={`h-3 w-3 shrink-0 rounded-full ${badgePreset(draft.colorKey).dot}`} />
                    <Input
                      className="h-8 flex-1"
                      value={draft.name}
                      onChange={(e) => setEdits((p) => ({ ...p, [t.id]: { ...draft, name: e.target.value } }))}
                    />
                    <div className="w-32">
                      <ColorSelect
                        value={draft.colorKey}
                        onChange={(c) => setEdits((p) => ({ ...p, [t.id]: { ...draft, colorKey: c } }))}
                      />
                    </div>
                    <span className="w-20 shrink-0 text-xs text-[var(--color-muted-foreground)] text-right">
                      {t.templateCount} template{t.templateCount === 1 ? "" : "s"}
                    </span>
                    <div className="flex flex-col">
                      <button
                        onClick={() => move(t, -1)}
                        disabled={i === 0}
                        aria-label={`Move ${t.name} up`}
                        className="p-0.5 rounded hover:bg-[var(--color-accent)] disabled:opacity-30"
                      >
                        <ChevronUp className="h-3 w-3 text-[var(--color-muted-foreground)]" />
                      </button>
                      <button
                        onClick={() => move(t, 1)}
                        disabled={i === types.length - 1}
                        aria-label={`Move ${t.name} down`}
                        className="p-0.5 rounded hover:bg-[var(--color-accent)] disabled:opacity-30"
                      >
                        <ChevronDown className="h-3 w-3 text-[var(--color-muted-foreground)]" />
                      </button>
                    </div>
                    {dirty && (
                      <Button size="sm" variant="outline" onClick={() => handleSaveRow(t)}>Save</Button>
                    )}
                    {inUse ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setReassigning(t); setReassignTo("") }}
                      >
                        Reassign
                      </Button>
                    ) : (
                      <button
                        onClick={() => setPendingDelete(t)}
                        aria-label={`Delete ${t.name}`}
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
              A type in use cannot be deleted. Reassign its templates to another type first — the count includes archived templates.
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
              {pendingRename?.count} template{pendingRename?.count === 1 ? "" : "s"} use this type. Completed checklists
              and printed copies already made under the old name will show the new one — there is no as-executed record
              of the old name.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingRename) return
                patchType(pendingRename.id, { name: pendingRename.to, colorKey: pendingRename.colorKey })
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
              No templates use this type, so nothing else changes. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--color-destructive)] hover:bg-[var(--color-destructive)]/90"
              onClick={() => {
                if (!pendingDelete) return
                call(`/api/template-types/${pendingDelete.id}`, { method: "DELETE" })
                setPendingDelete(null)
              }}
            >
              Delete Type
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reassign — the path that unlocks delete. */}
      <Dialog open={!!reassigning} onOpenChange={(o) => !o && setReassigning(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reassign templates from &ldquo;{reassigning?.name}&rdquo;</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Move {reassigning?.templateCount} template{reassigning?.templateCount === 1 ? "" : "s"} to another type.
              Once this type is empty it can be deleted.
            </p>
            {reassignTargets.length === 0 ? (
              <p className="text-sm text-[var(--color-destructive)]">
                There is no other type to move them to. Create one first.
              </p>
            ) : (
              <Select value={reassignTo} onValueChange={setReassignTo}>
                <SelectTrigger><SelectValue placeholder="Select a type" /></SelectTrigger>
                <SelectContent>
                  {reassignTargets.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <span className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${badgePreset(t.colorKey).dot}`} />
                        {t.name}
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
