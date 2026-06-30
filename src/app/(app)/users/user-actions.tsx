"use client"

import { useState } from "react"
import { Plus, Pencil, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useRouter } from "next/navigation"

type Store = { id: string; name: string; storeNumber: string | null }

const ROLE_OPTIONS = [
  { value: "ADMIN", label: "Admin", description: "Full access to all locations and settings" },
  { value: "MANAGER", label: "Manager", description: "Access to assigned locations, can manage staff and tasks" },
  { value: "STORE", label: "Store", description: "Login for a specific store location" },
]

// ── Invite User Button ────────────────────────────────────────────────────────
export function InviteUserButton({ stores }: { stores: Store[] }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [form, setForm] = useState({ email: "", role: "STORE" })
  const [selectedStores, setSelectedStores] = useState<Set<string>>(new Set())
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
    setError("")
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, storeIds: Array.from(selectedStores) }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Failed to send invitation")
        return
      }
      setOpen(false)
      setForm({ email: "", role: "STORE" })
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
        Invite User
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Invite User</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Email Address *</Label>
              <Input
                required
                type="email"
                value={form.email}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                placeholder="user@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <div className="space-y-2">
                {ROLE_OPTIONS.map((r) => (
                  <label key={r.value} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${form.role === r.value ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5" : "border-[var(--color-border)] hover:bg-[var(--color-accent)]"}`}>
                    <input type="radio" name="role" value={r.value} checked={form.role === r.value} onChange={() => setForm((p) => ({ ...p, role: r.value }))} className="mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">{r.label}</p>
                      <p className="text-xs text-[var(--color-muted-foreground)]">{r.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            {form.role !== "ADMIN" && (
              <div className="space-y-1.5">
                <Label>Location Access</Label>
                <p className="text-xs text-[var(--color-muted-foreground)]">Select which store location(s) this user can access.</p>
                <div className="border border-[var(--color-border)] rounded-lg max-h-48 overflow-y-auto p-2 space-y-1">
                  {stores.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 p-2 rounded hover:bg-[var(--color-accent)] cursor-pointer text-sm">
                      <input type="checkbox" checked={selectedStores.has(s.id)} onChange={() => toggleStore(s.id)} />
                      {s.storeNumber ? `#${s.storeNumber} — ` : ""}{s.name}
                    </label>
                  ))}
                  {stores.length === 0 && <p className="text-xs text-[var(--color-muted-foreground)] p-2">No stores yet.</p>}
                </div>
              </div>
            )}
            {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
            <p className="text-xs text-[var(--color-muted-foreground)]">An email invitation will be sent with the selected role and location access already applied.</p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? "Sending..." : "Send Invitation"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ── Edit User (role + store access) ──────────────────────────────────────────
export function EditUserButton({
  dbUserId,
  currentRole,
  currentStoreIds,
  stores,
  userName,
}: {
  dbUserId: string | null
  currentRole: string
  currentStoreIds: string[]
  stores: Store[]
  userName: string
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [role, setRole] = useState(currentRole)
  const [selectedStores, setSelectedStores] = useState<Set<string>>(new Set(currentStoreIds))
  const router = useRouter()

  function toggleStore(id: string) {
    setSelectedStores((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleSave() {
    if (!dbUserId) return
    setSaving(true)
    try {
      await fetch(`/api/users/${dbUserId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, storeIds: Array.from(selectedStores) }),
      })
      setOpen(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  if (!dbUserId) {
    return (
      <span className="text-xs text-[var(--color-muted-foreground)] italic">Pending</span>
    )
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="p-1 rounded hover:bg-[var(--color-accent)]">
        <Pencil className="h-4 w-4 text-[var(--color-muted-foreground)]" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit User — {userName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <div className="space-y-2">
                {ROLE_OPTIONS.map((r) => (
                  <label key={r.value} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${role === r.value ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5" : "border-[var(--color-border)] hover:bg-[var(--color-accent)]"}`}>
                    <input type="radio" name="edit-role" value={r.value} checked={role === r.value} onChange={() => setRole(r.value)} className="mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">{r.label}</p>
                      <p className="text-xs text-[var(--color-muted-foreground)]">{r.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            {role !== "ADMIN" && (
              <div className="space-y-1.5">
                <Label>Location Access</Label>
                <p className="text-xs text-[var(--color-muted-foreground)]">Select which store locations this user can access.</p>
                <div className="border border-[var(--color-border)] rounded-lg max-h-56 overflow-y-auto p-2 space-y-1">
                  {stores.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 p-2 rounded hover:bg-[var(--color-accent)] cursor-pointer text-sm">
                      <input type="checkbox" checked={selectedStores.has(s.id)} onChange={() => toggleStore(s.id)} />
                      {s.storeNumber ? `#${s.storeNumber} — ` : ""}{s.name}
                    </label>
                  ))}
                  {stores.length === 0 && <p className="text-xs text-[var(--color-muted-foreground)] p-2">No stores yet.</p>}
                </div>
                <p className="text-xs text-[var(--color-muted-foreground)]">{selectedStores.size} location{selectedStores.size !== 1 ? "s" : ""} selected</p>
              </div>
            )}
            {role === "ADMIN" && (
              <div className="p-3 rounded-lg bg-orange-50 border border-orange-200">
                <p className="text-xs text-orange-700">Admins have access to all locations automatically.</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ── Remove User ───────────────────────────────────────────────────────────────
export function RemoveUserButton({ clerkUserId, userName }: { clerkUserId: string; userName: string }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleRemove() {
    if (!confirm(`Remove ${userName || "this user"} from the organization?`)) return
    setLoading(true)
    try {
      await fetch(`/api/users/${clerkUserId}`, { method: "DELETE" })
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <button onClick={handleRemove} disabled={loading} className="p-1 rounded hover:bg-[var(--color-accent)]">
      <Trash2 className="h-4 w-4 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]" />
    </button>
  )
}

// ── Revoke Invitation ────────────────────────────────────────────────────────
export function RevokeInviteButton({ invitationId, email }: { invitationId: string; email: string }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleRevoke() {
    if (!confirm(`Revoke the pending invitation for ${email}?`)) return
    setLoading(true)
    try {
      await fetch(`/api/users/invitations/${invitationId}`, { method: "DELETE" })
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <button onClick={handleRevoke} disabled={loading} className="p-1 rounded hover:bg-[var(--color-accent)]" title="Revoke invitation">
      <X className="h-4 w-4 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]" />
    </button>
  )
}
