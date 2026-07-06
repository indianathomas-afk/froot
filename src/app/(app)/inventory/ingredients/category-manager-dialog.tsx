"use client"

import { useState } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"

type Category = { id: string; name: string; glCode: string | null }

export function CategoryManagerDialog({
  open,
  categories,
  ingredientCountByCategory,
  onClose,
  onChanged,
}: {
  open: boolean
  categories: Category[]
  ingredientCountByCategory: Record<string, number>
  onClose: () => void
  onChanged: () => void
}) {
  const [name, setName] = useState("")
  const [glCode, setGlCode] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, { name: string; glCode: string }>>({})
  const [pendingGlChange, setPendingGlChange] = useState<{ id: string; name: string; glCode: string; count: number } | null>(null)

  function edited(c: Category) {
    return edits[c.id] ?? { name: c.name, glCode: c.glCode ?? "" }
  }

  async function saveCategory(id: string, patch: { name: string; glCode: string | null }) {
    setError(null)
    const res = await fetch(`/api/inventory/ingredient-categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? "Failed to update category")
      return
    }
    setEdits((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    onChanged()
  }

  function handleSaveRow(c: Category) {
    const draft = edited(c)
    const glCodeChanged = (draft.glCode || null) !== (c.glCode ?? null)
    const count = ingredientCountByCategory[c.id] ?? 0
    if (glCodeChanged && count > 0) {
      setPendingGlChange({ id: c.id, name: draft.name, glCode: draft.glCode, count })
      return
    }
    saveCategory(c.id, { name: draft.name, glCode: draft.glCode || null })
  }

  async function handleAdd() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/inventory/ingredient-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, glCode: glCode || null }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? "Failed to add category")
        return
      }
      setName("")
      setGlCode("")
      onChanged()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    setError(null)
    const res = await fetch(`/api/inventory/ingredient-categories/${id}`, { method: "DELETE" })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? "Failed to delete category")
      return
    }
    onChanged()
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ingredient Categories</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="text-xs text-[var(--color-muted-foreground)]">Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Frozen Fruits" />
              </div>
              <div className="w-24">
                <label className="text-xs text-[var(--color-muted-foreground)]">GL Code</label>
                <Input value={glCode} onChange={(e) => setGlCode(e.target.value)} placeholder="5510" />
              </div>
              <Button size="sm" onClick={handleAdd} disabled={saving || !name.trim()}>Add</Button>
            </div>
            {error && <p className="text-xs text-[var(--color-destructive)]">{error}</p>}
            <div className="max-h-72 overflow-y-auto space-y-1.5">
              {categories.length === 0 && (
                <p className="text-sm text-[var(--color-muted-foreground)] text-center py-6">No categories yet.</p>
              )}
              {categories.map((c) => {
                const draft = edited(c)
                const dirty = draft.name !== c.name || (draft.glCode || null) !== (c.glCode ?? null)
                return (
                  <div key={c.id} className="flex items-center gap-2 px-3 py-2 rounded-md border border-[var(--color-border)]">
                    <Input
                      className="h-8 flex-1"
                      value={draft.name}
                      onChange={(e) => setEdits((prev) => ({ ...prev, [c.id]: { ...draft, name: e.target.value } }))}
                    />
                    <Input
                      className="h-8 w-20"
                      value={draft.glCode}
                      onChange={(e) => setEdits((prev) => ({ ...prev, [c.id]: { ...draft, glCode: e.target.value } }))}
                      placeholder="GL Code"
                    />
                    {dirty && (
                      <Button size="sm" variant="outline" onClick={() => handleSaveRow(c)}>Save</Button>
                    )}
                    <button onClick={() => handleDelete(c.id)} className="p-1 rounded hover:bg-[var(--color-accent)]">
                      <Trash2 className="h-3.5 w-3.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]" />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingGlChange} onOpenChange={(o) => !o && setPendingGlChange(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update GL code for {pendingGlChange?.count} item{pendingGlChange?.count !== 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This updates the effective GL code for all {pendingGlChange?.count} item{pendingGlChange?.count !== 1 ? "s" : ""} in
              this category (items with their own GL code override are unaffected).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingGlChange) return
                saveCategory(pendingGlChange.id, { name: pendingGlChange.name, glCode: pendingGlChange.glCode || null })
                setPendingGlChange(null)
              }}
            >
              Update GL Code
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
