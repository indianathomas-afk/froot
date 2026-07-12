"use client"

import { useState } from "react"
import { Plus, Download, RefreshCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useRouter } from "next/navigation"

type Store = { id: string; name: string; storeNumber: string | null }
type SquareTeamMember = {
  id: string
  display_name?: string
  given_name?: string
  family_name?: string
  alreadyImported: boolean
  assignedStoreIds: string[]
  primaryStoreId: string | null
  allLocations: boolean
}

// Add Staff Member Modal
export function AddStaffButton({ stores }: { stores: Store[] }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedStores, setSelectedStores] = useState<Set<string>>(new Set())
  const [primaryStore, setPrimaryStore] = useState("")
  const [form, setForm] = useState({ displayName: "", fullName: "" })
  const router = useRouter()

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, storeIds: Array.from(selectedStores), primaryStoreId: primaryStore || null }),
      })
      setOpen(false)
      setForm({ displayName: "", fullName: "" })
      setSelectedStores(new Set())
      setPrimaryStore("")
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
            {selectedStores.size > 0 && (
              <div className="space-y-1.5">
                <Label>Primary Store</Label>
                <select
                  className="w-full border border-[var(--color-border)] rounded-md bg-transparent px-3 py-2 text-sm"
                  value={primaryStore}
                  onChange={(e) => setPrimaryStore(e.target.value)}
                >
                  <option value="">No primary store</option>
                  {stores.filter((s) => selectedStores.has(s.id)).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}
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
  const [primaryMap, setPrimaryMap] = useState<Record<string, string>>({})
  const router = useRouter()

  async function handleOpen() {
    setOpen(true)
    setLoading(true)
    try {
      const res = await fetch("/api/square/team-members")
      const data = await res.json()
      const fetched: SquareTeamMember[] = data.members ?? []
      setMembers(fetched)
      setSelected(new Set(fetched.filter((m) => !m.alreadyImported).map((m) => m.id)))
      // Pre-fill each member's stores and primary store from their Square assignments
      const storeInit: Record<string, Set<string>> = {}
      const primaryInit: Record<string, string> = {}
      for (const m of fetched) {
        storeInit[m.id] = new Set(m.assignedStoreIds ?? [])
        if (m.primaryStoreId) primaryInit[m.id] = m.primaryStoreId
      }
      setStoreMap(storeInit)
      setPrimaryMap(primaryInit)
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
      if (cur.has(storeId)) {
        cur.delete(storeId)
        setPrimaryMap((p) => (p[memberId] === storeId ? { ...p, [memberId]: "" } : p))
      } else {
        cur.add(storeId)
      }
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
              primaryStoreId: primaryMap[m.id] || null,
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
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-[var(--color-foreground)]">{memberName(m)}</p>
                          {m.allLocations && (
                            <span className="text-[10px] uppercase tracking-wide font-medium text-[var(--color-muted-foreground)] border border-[var(--color-border)] rounded-full px-1.5 py-0.5">
                              All locations in Square
                            </span>
                          )}
                        </div>
                        {selected.has(m.id) && stores.length > 0 && (
                          <>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {stores.map((s) => {
                                const checked = (storeMap[m.id] ?? new Set()).has(s.id)
                                const isPrimary = primaryMap[m.id] === s.id
                                return (
                                  <label key={s.id} className={`flex items-center gap-1.5 text-xs cursor-pointer px-2 py-1 rounded-full border transition-colors ${isPrimary ? "bg-[var(--color-primary)] border-[var(--color-primary)] text-white" : checked ? "bg-[var(--color-primary)]/10 border-[var(--color-primary)] text-[var(--color-primary)]" : "border-[var(--color-border)] text-[var(--color-muted-foreground)]"}`}>
                                    <input type="checkbox" className="hidden" checked={checked} onChange={() => toggleMemberStore(m.id, s.id)} />
                                    {isPrimary && <span aria-label="Primary store">★</span>}
                                    {s.name}
                                  </label>
                                )
                              })}
                            </div>
                            {(storeMap[m.id]?.size ?? 0) > 0 && (
                              <div className="mt-2 flex items-center gap-2">
                                <span className="text-xs text-[var(--color-muted-foreground)]">Primary store:</span>
                                <select
                                  className="text-xs border border-[var(--color-border)] rounded-md bg-transparent px-2 py-1"
                                  value={primaryMap[m.id] ?? ""}
                                  onChange={(e) => setPrimaryMap((p) => ({ ...p, [m.id]: e.target.value }))}
                                >
                                  <option value="">None</option>
                                  {stores.filter((s) => (storeMap[m.id] ?? new Set()).has(s.id)).map((s) => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </>
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

// Location chips for a staff row. Admins click a chip to set it as the
// member's primary (home) store — the store their row is grouped under.
export function StaffLocationChips({
  staffId,
  assignments,
  canEdit,
}: {
  staffId: string
  assignments: { storeId: string; storeName: string; isPrimary: boolean }[]
  canEdit: boolean
}) {
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  async function setPrimary(storeId: string) {
    setSaving(true)
    try {
      await fetch(`/api/staff/${staffId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryStoreId: storeId }),
      })
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  const shown = assignments.slice(0, 8)
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((a) => {
        const cls = `inline-flex items-center gap-1 rounded-full text-xs font-medium px-2 py-0.5 ${
          a.isPrimary ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
        }`
        if (!canEdit || a.isPrimary) {
          return (
            <span key={a.storeId} className={cls} title={a.isPrimary ? "Primary store" : undefined}>
              {a.isPrimary && <span aria-label="Primary store">★</span>}
              {a.storeName}
            </span>
          )
        }
        return (
          <button
            key={a.storeId}
            type="button"
            disabled={saving}
            onClick={() => setPrimary(a.storeId)}
            title={`Make ${a.storeName} the primary store`}
            className={`${cls} cursor-pointer hover:bg-[var(--color-primary)]/20 disabled:opacity-50`}
          >
            {a.storeName}
          </button>
        )
      })}
      {assignments.length > 8 && (
        <span className="text-xs text-[var(--color-muted-foreground)]">+{assignments.length - 8}</span>
      )}
    </div>
  )
}

// Sync Locations from Square Button — re-pulls assigned locations and primary
// store from Square for every already-imported staff member.
export function SyncStaffButton() {
  const [syncing, setSyncing] = useState(false)
  const router = useRouter()

  async function handleSync() {
    if (!confirm("Update all imported staff members' store assignments and primary store to match Square? Manual location changes will be overwritten.")) return
    setSyncing(true)
    try {
      const res = await fetch("/api/staff/sync-square", { method: "POST" })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        alert(data?.error ?? "Sync failed")
        return
      }
      router.refresh()
    } finally {
      setSyncing(false)
    }
  }

  return (
    <Button variant="outline" onClick={handleSync} disabled={syncing}>
      <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
      {syncing ? "Syncing..." : "Sync Locations from Square"}
    </Button>
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
