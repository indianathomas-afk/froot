"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Pencil, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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

type StoreOption = { id: string; name: string; storeNumber: string | null }

// HR-7 follow-up: edit any staff member (manual or Square-imported) — name,
// email, store assignments, primary store — plus a per-member Resync from
// Square that pulls Square's current values (name/email/locations) over the
// top, leaving documents, training, notes, status, and login untouched.
// ADMIN / in-scope MANAGER; the server re-enforces both.
export function StaffEditActions({
  staffId,
  isSquareLinked,
  stores,
  current,
}: {
  staffId: string
  isSquareLinked: boolean
  stores: StoreOption[]
  current: {
    displayName: string
    fullName: string | null
    email: string | null
    assignedStoreIds: string[]
    primaryStoreId: string | null
  }
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [resyncing, setResyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [displayName, setDisplayName] = useState(current.displayName)
  const [fullName, setFullName] = useState(current.fullName ?? "")
  const [email, setEmail] = useState(current.email ?? "")
  const [selectedStores, setSelectedStores] = useState<Set<string>>(new Set(current.assignedStoreIds))
  const [primaryStore, setPrimaryStore] = useState(current.primaryStoreId ?? "")

  function reset() {
    setDisplayName(current.displayName)
    setFullName(current.fullName ?? "")
    setEmail(current.email ?? "")
    setSelectedStores(new Set(current.assignedStoreIds))
    setPrimaryStore(current.primaryStoreId ?? "")
    setError(null)
  }

  function toggleStore(id: string) {
    setSelectedStores((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
        if (primaryStore === id) setPrimaryStore("")
      } else {
        next.add(id)
      }
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/staff/${staffId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: displayName.trim(),
          fullName: fullName.trim() || null,
          email: email.trim() || null,
          storeIds: [...selectedStores],
          primaryStoreId: primaryStore || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error ?? "Failed to save")
        return
      }
      setOpen(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleResync() {
    setResyncing(true)
    setError(null)
    try {
      const res = await fetch(`/api/staff/${staffId}/resync-square`, { method: "POST" })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error ?? "Resync failed")
        return
      }
      router.refresh()
    } finally {
      setResyncing(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            reset()
            setOpen(true)
          }}
        >
          <Pencil className="h-4 w-4 mr-1.5" />
          Edit
        </Button>
        {isSquareLinked && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={resyncing}>
                <RefreshCw className={`h-4 w-4 mr-1.5 ${resyncing ? "animate-spin" : ""}`} />
                {resyncing ? "Resyncing..." : "Resync from Square"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Resync from Square?</AlertDialogTitle>
                <AlertDialogDescription>
                  This replaces this member&apos;s name, email, and store assignments with the current values
                  from Square (their primary store is kept if it&apos;s still one of them). Documents, training,
                  notes, status, and their login are not affected. If Square shows them as inactive, they&apos;ll
                  be terminated here with all records kept.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleResync}>Resync</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
      {error && !open && <p className="text-xs text-[var(--color-destructive)]">{error}</p>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit staff member</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Display Name *</Label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Full Name</Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
              <p className="text-xs text-[var(--color-muted-foreground)]">Needed to invite them to a self-service login.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Assigned Stores</Label>
              <div className="border border-[var(--color-border)] rounded-lg max-h-48 overflow-y-auto p-2 space-y-1">
                {stores.map((s) => (
                  <label
                    key={s.id}
                    className="flex items-center gap-2 p-2 rounded hover:bg-[var(--color-accent)] cursor-pointer text-sm"
                  >
                    <input type="checkbox" checked={selectedStores.has(s.id)} onChange={() => toggleStore(s.id)} />
                    {s.storeNumber ? `#${s.storeNumber} - ` : ""}
                    {s.name}
                  </label>
                ))}
                {stores.length === 0 && (
                  <p className="text-xs text-[var(--color-muted-foreground)] p-2">No stores available.</p>
                )}
              </div>
            </div>
            {selectedStores.size > 0 && (
              <div className="space-y-1.5">
                <Label>Primary Store</Label>
                <select
                  className="w-full border border-[var(--color-border)] rounded-md bg-transparent px-3 py-2 text-sm"
                  value={primaryStore}
                  onChange={(e) => setPrimaryStore(e.target.value)}
                >
                  <option value="">No primary store</option>
                  {stores
                    .filter((s) => selectedStores.has(s.id))
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </div>
            )}
            {error && open && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || displayName.trim() === ""}>
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
