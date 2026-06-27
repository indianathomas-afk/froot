"use client"

import { useState } from "react"
import { Plus, Download, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useRouter } from "next/navigation"

type Store = { id: string; name: string; storeNumber: string | null }
type SquareTeamMember = { id: string; display_name?: string; given_name?: string; family_name?: string; alreadyImported: boolean }

// Add Staff Member Modal
export function AddStaffButton({ stores }: { stores: Store[] }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedStores, setSelectedStores] = useState<Set<string>>(new Set())
  const [form, setForm] = useState({ displayName: "", fullName: "" })
  const router = useRouter()

  function toggleStore(id: string) {
    setSelectedStores((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, storeIds: Array.from(selectedStores) }),
      })
      setOpen(false)
      setForm({ displayName: "", fullName: "" })
      setSelectedStores(new Set())
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Add Staff Member
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Staff Member</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Display Name *</Label>
              <Input required value={form.displayName} onChange={(e) => setForm((p) => ({ ...p, displayName: e.target.value }))} placeholder="e.g. Sarah T." />
            </div>
            <div className="space-y-1.5">
              <Label>Full Name</Label>
              <Input value={form.fullName} onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))} placeholder="e.g. Sarah Thomas" />
            </div>
            <div className="space-y-1.5">
              <Label>Assign to Stores</Label>
              <div className="border border-[var(--color-border)] rounded-lg max-h-48 overflow-y-auto p-2 space-y-1">
                {stores.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 p-2 rounded hover:bg-[var(--color-accent)] cursor-pointer text-sm">
                    <input type="checkbox" checked={selectedStores.has(s.id)} onChange={() => toggleStore(s.id)} />
                    {s.storeNumber ? `#${s.storeNumber} - ` : ""}{s.name}
                  </label>
                ))}
                {stores.length === 0 && <p className="text-xs text-[var(--color-muted-foreground)] p-2">No stores yet. Add stores first.</p>}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Add Staff Member"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

// Import from Square Modal
export function ImportStaffButton({ stores }: { stores: Store[] }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [members, setMembers] = useState<SquareTeamMember[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [storeMap, setStoreMap] = useState<Record<string, Set<string>>>({})
  const router = useRouter()

  async function handleOpen() {
    setOpen(true)
    setLoading(true)
    try {
      const res = await fetch("/api/square/team-members")
      const data = await res.json()
      setMembers(data.members ?? [])
      const unimported = (data.members ?? []).filter((m: SquareTeamMember) => !m.alreadyImported).map((m: SquareTeamMember) => m.id)
      setSelected(new Set(unimported))
    } finally {
      setLoading(false)
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const available = members.filter((m) => !m.alreadyImported)
  const alreadyDone = members.filter((m) => m.alreadyImported)
  const allSelected = available.length > 0 && selected.size === available.length

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(available.map((m) => m.id)))
  }

  function toggleMemberStore(memberId: string, storeId: string) {
    setStoreMap((prev) => {
      const cur = new Set(prev[memberId] ?? [])
      cur.has(storeId) ? cur.delete(storeId) : cur.add(storeId)
      return { ...prev, [memberId]: cur }
    })
  }

  function memberName(m: SquareTeamMember) {
    return m.display_name || [m.given_name, m.family_name].filter(Boolean).join(" ") || "Unknown"
  }

  async function handleImport() {
    setImporting(true)
    try {
      const toImport = members.filter((m) => selected.has(m.id))
      await Promise.all(
        toImport.map((m) =>
          fetch("/api/staff", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              displayName: memberName(m),
              fullName: [m.given_name, m.family_name].filter(Boolean).join(" ") || null,
              squareTeamMemberId: m.id,
              storeIds: Array.from(storeMap[m.id] ?? []),
            }),
          })
        )
      )
      setOpen(false)
      router.refresh()
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <Button variant="outline" onClick={handleOpen}>
        <Download className="h-4 w-4" />
        Import from Square
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import Team Members from Square</DialogTitle>
          </DialogHeader>
          {loading ? (
            <p className="text-sm text-[var(--color-muted-foreground)] py-8 text-center">Loading team members...</p>
          ) : (
            <div className="space-y-3">
              {available.length === 0 && alreadyDone.length === 0 && (
                <p className="text-sm text-[var(--color-muted-foreground)]">No team members found in Square.</p>
              )}
              {available.length > 0 && (
                <div>
                  <label className="flex items-center gap-2 cursor-pointer mb-3 pb-3 border-b border-[var(--color-border)]">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                    <span className="text-sm font-medium text-[var(--color-foreground)]">
                      {allSelected ? "Deselect all" : "Select all"} ({selected.size} of {available.length})
                    </span>
                  </label>
                  {available.map((m) => (
                    <div key={m.id} className="flex items-start gap-3 p-3 rounded-lg border border-[var(--color-border)] mb-2">
                      <input type="checkbox" className="mt-0.5" checked={selected.has(m.id)} onChange={() => toggle(m.id)} />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-[var(--color-foreground)]">{memberName(m)}</p>
                        {selected.has(m.id) && stores.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {stores.map((s) => {
                              const checked = (storeMap[m.id] ?? new Set()).has(s.id)
                              return (
                                <label key={s.id} className={`flex items-center gap-1.5 text-xs cursor-pointer px-2 py-1 rounded-full border transition-colors ${checked ? "bg-[var(--color-primary)]/10 border-[var(--color-primary)] text-[var(--color-primary)]" : "border-[var(--color-border)] text-[var(--color-muted-foreground)]"}`}>
                                  <input type="checkbox" className="hidden" checked={checked} onChange={() => toggleMemberStore(m.id, s.id)} />
                                  {s.storeNumber ? `#${s.storeNumber}` : s.name}
                                </label>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {alreadyDone.length > 0 && (
                <div>
                  <p className="text-xs text-[var(--color-muted-foreground)] mb-2">Already imported ({alreadyDone.length})</p>
                  {alreadyDone.map((m) => (
                    <div key={m.id} className="flex items-center gap-3 p-3 rounded-lg border border-[var(--color-border)] mb-2 opacity-50">
                      <input type="checkbox" disabled checked />
                      <p className="text-sm text-[var(--color-foreground)]">{memberName(m)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleImport} disabled={importing || selected.size === 0}>
              {importing ? "Importing..." : `Import ${selected.size} Member${selected.size !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// Delete Staff Button
export function DeleteStaffButton({ staffId }: { staffId: string }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleDelete() {
    if (!confirm("Remove this staff member?")) return
    setLoading(true)
    try {
      await fetch(`/api/staff/${staffId}`, { method: "DELETE" })
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <button onClick={handleDelete} disabled={loading} className="p-1 rounded hover:bg-[var(--color-accent)]">
      <Trash2 className="h-4 w-4 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]" />
    </button>
  )
}
