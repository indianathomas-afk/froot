"use client"

import { useState } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"

type Category = { id: string; name: string; glCode: string | null }

export function CategoryManagerDialog({
  open,
  categories,
  onClose,
  onChanged,
}: {
  open: boolean
  categories: Category[]
  onClose: () => void
  onChanged: () => void
}) {
  const [name, setName] = useState("")
  const [glCode, setGlCode] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
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
            {categories.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-3 py-2 rounded-md border border-[var(--color-border)]">
                <span className="text-sm text-[var(--color-foreground)]">{c.name}{c.glCode ? ` · GL ${c.glCode}` : ""}</span>
                <button onClick={() => handleDelete(c.id)} className="p-1 rounded hover:bg-[var(--color-accent)]">
                  <Trash2 className="h-3.5 w-3.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]" />
                </button>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
