"use client"

import { useState } from "react"
import { Plus, Pencil, Trash2, X, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useRouter } from "next/navigation"
import {
  can, ENFORCED_CAPABILITIES, ENFORCED_CAPABILITY_AREAS, type Capability,
} from "@/lib/permissions"

type Store = { id: string; name: string; storeNumber: string | null }

const ROLE_OPTIONS = [
  { value: "ADMIN", label: "Admin", description: "Full access to all locations and settings" },
  { value: "MANAGER", label: "Manager", description: "Access to assigned locations, can manage staff and tasks" },
  { value: "STORE", label: "Store", description: "Login for a specific store location" },
]

// STAFF is edit-only: STAFF logins are created from the Staff directory invite
// flow (which links the staff profile); a generic invite would create an
// unlinked STAFF user — a broken state.
const EDIT_ROLE_OPTIONS = [
  ...ROLE_OPTIONS,
  { value: "STAFF", label: "Staff", description: "Personal HR access only — requires a linked staff profile" },
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
  currentDefaultStoreId,
  currentDeniedCapabilities,
  stores,
  userName,
}: {
  dbUserId: string | null
  currentRole: string
  currentStoreIds: string[]
  currentDefaultStoreId: string | null
  // PERM-5. The capabilities currently subtracted from this user's role.
  currentDeniedCapabilities: string[]
  stores: Store[]
  userName: string
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [role, setRole] = useState(currentRole)
  const [selectedStores, setSelectedStores] = useState<Set<string>>(new Set(currentStoreIds))
  // BUILD-2. "" is the wire form of null — see handleSave.
  const [defaultStore, setDefaultStore] = useState(currentDefaultStoreId ?? "")
  const [denied, setDenied] = useState<Set<string>>(new Set(currentDeniedCapabilities))
  // UX-1: shown when a close is attempted with unsaved edits.
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const router = useRouter()

  // UX-1 (the half nobody sees until it bites): this state used to persist
  // across closes, so cancelling out of a half-made change and reopening the
  // modal showed the ABANDONED values as though they were saved — and saving
  // from there would write them. Reset from props on every open.
  function reset() {
    setRole(currentRole)
    setSelectedStores(new Set(currentStoreIds))
    setDefaultStore(currentDefaultStoreId ?? "")
    setDenied(new Set(currentDeniedCapabilities))
    setError("")
  }

  const sameSet = (a: Set<string>, b: string[]) => a.size === b.length && b.every((x) => a.has(x))
  const dirty =
    role !== currentRole ||
    !sameSet(selectedStores, currentStoreIds) ||
    (currentDefaultStoreId ?? "") !== defaultStore ||
    !sameSet(denied, currentDeniedCapabilities)

  // UX-1: every close path routes through here — the X, the overlay, Escape
  // and the Cancel button — so none of them can silently discard edits.
  function requestClose(next: boolean) {
    if (next) {
      reset()
      setOpen(true)
      return
    }
    if (dirty && !saving) {
      setConfirmDiscard(true)
      return
    }
    setOpen(false)
  }

  // BUILD-2. Options come from the locations selected in THIS modal, not the
  // saved set, so "add store B and make it the default" works in one save.
  // Admins pick from every store: they have no assignment rows to be limited by.
  const defaultOptions = role === "ADMIN" ? stores : stores.filter((s) => selectedStores.has(s.id))
  // Switching role can invalidate an already-chosen default (ADMIN → STORE with
  // the default unselected). Derive rather than mutate, and send the SAME value
  // the user can see — otherwise the modal would submit a default the server is
  // bound to reject with a 400 the admin cannot act on.
  const effectiveDefault = defaultOptions.some((s) => s.id === defaultStore) ? defaultStore : ""

  // PERM-5. Same reasoning as effectiveDefault above, applied to overrides:
  // send the values the admin can SEE. Switching role in this modal changes
  // which capabilities the ceiling grants, and a denial of something the new
  // role never had is a no-op the server drops anyway — so drop it here too
  // rather than submitting a set the server will quietly rewrite.
  const effectiveDenied = ENFORCED_CAPABILITIES.filter(
    (e) => denied.has(e.capability) && can({ role }, e.capability)
  ).map((e) => e.capability)

  function toggleDenied(capability: Capability) {
    setDenied((prev) => {
      const next = new Set(prev)
      next.has(capability) ? next.delete(capability) : next.add(capability)
      return next
    })
  }

  function toggleStore(id: string) {
    // Deselecting the default location clears it, mirroring the staff dialog's
    // primary-store behaviour (staff/[id]/staff-edit-actions.tsx:72). Without
    // this the modal would submit a default the server must reject.
    if (defaultStore === id && selectedStores.has(id)) setDefaultStore("")
    setSelectedStores((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleSave() {
    if (!dbUserId) return
    setSaving(true)
    setError("")
    try {
      const res = await fetch(`/api/users/${dbUserId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          storeIds: Array.from(selectedStores),
          defaultStoreId: effectiveDefault || null,
          deniedCapabilities: effectiveDenied,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? "Failed to save changes")
        return
      }
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
      <button onClick={() => requestClose(true)} className="p-1 rounded hover:bg-[var(--color-accent)]">
        <Pencil className="h-4 w-4 text-[var(--color-muted-foreground)]" />
      </button>
      <Dialog open={open} onOpenChange={requestClose}>
        {/* UX-1. The scroll used to live on DialogContent, which put the Save
            button below the fold of a form that only got longer — and PERM-5
            adds fifteen more rows to it. The overflow moves to the body div
            below so the footer stays pinned and visible at any height.
            DialogContent defaults to `grid`; flex-col is what lets the body
            take the remaining space. Scoped to this modal, not dialog.tsx. */}
        <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit User — {userName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 flex-1 overflow-y-auto -mx-1 px-1">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <div className="space-y-2">
                {EDIT_ROLE_OPTIONS.map((r) => (
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
            {defaultOptions.length > 0 && (
              <div className="space-y-1.5">
                <Label>Default Location</Label>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Where this user starts when they sign in. Leave unset to use the first location alphabetically.
                </p>
                <select
                  className="w-full border border-[var(--color-border)] rounded-md bg-transparent px-3 py-2 text-sm"
                  value={effectiveDefault}
                  onChange={(e) => setDefaultStore(e.target.value)}
                >
                  <option value="">No default location</option>
                  {defaultOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.storeNumber ? `#${s.storeNumber} — ` : ""}{s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {/* PERM-5 — the override grid. Restrict-only, and the UI is where
                that is made obvious: a capability the role grants renders as a
                switchable toggle, one it does NOT grant renders locked and
                disabled. There is no control on this screen that grants. */}
            <div className="space-y-1.5 border-t border-[var(--color-border)] pt-4">
              <Label>Capability overrides</Label>
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Turn things off for this person only. You can restrict below what their role
                allows, never above it — to give more access, change the role.
              </p>
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Overrides follow this user to <strong>every</strong> location they are assigned to;
                they cannot be set per location. For &ldquo;no labor at one store, yes at
                another&rdquo;, use a separate login per store.
              </p>
              <div className="border border-[var(--color-border)] rounded-lg p-2 space-y-3">
                {ENFORCED_CAPABILITY_AREAS.map((area) => (
                  <div key={area} className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)] px-1">
                      {area}
                    </p>
                    {ENFORCED_CAPABILITIES.filter((e) => e.area === area).map((e) => {
                      const grantedByRole = can({ role }, e.capability)
                      const on = grantedByRole && !denied.has(e.capability)
                      return (
                        <label
                          key={e.capability}
                          className={`flex items-start gap-2 p-2 rounded text-sm ${
                            grantedByRole ? "hover:bg-[var(--color-accent)] cursor-pointer" : "opacity-60"
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={on}
                            disabled={!grantedByRole}
                            onChange={() => toggleDenied(e.capability)}
                          />
                          <span className="flex-1">
                            <span className="flex items-center gap-1.5">
                              {e.label}
                              {!grantedByRole && <Lock className="h-3 w-3 text-[var(--color-muted-foreground)]" />}
                            </span>
                            <span className="block text-xs text-[var(--color-muted-foreground)]">
                              {grantedByRole ? e.removes : "Not granted by this role"}
                            </span>
                          </span>
                        </label>
                      )
                    })}
                  </div>
                ))}
              </div>
              {effectiveDenied.length > 0 && (
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  {effectiveDenied.length} capabilit{effectiveDenied.length === 1 ? "y" : "ies"} removed
                </p>
              )}
            </div>
            {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => requestClose(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* UX-1: the modal had no dirty-state guard at all, so the X, Escape and
          a mis-aimed overlay click all discarded edits without a word. */}
      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              The changes you made to {userName} have not been saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmDiscard(false)
                reset()
                setOpen(false)
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ── Remove User ───────────────────────────────────────────────────────────────
// DEBT-46, Gary's ruling 2026-08-03. This carried the SAME fire-and-forget
// defect as RevokeInviteButton below — no res.ok, no error state, an
// unconditional router.refresh() — twenty lines from where that one was fixed,
// on the more destructive of the two: this removes a user from the
// organization. A failure rendered as a success, and the row simply reappeared
// on refresh with no explanation. res.ok handling ONLY; the confirm() and the
// route it calls are deliberately untouched.
export function RemoveUserButton({ clerkUserId, userName }: { clerkUserId: string; userName: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleRemove() {
    if (!confirm(`Remove ${userName || "this user"} from the organization?`)) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/users/${clerkUserId}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error ?? "Failed to remove user")
        return
      }
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button onClick={handleRemove} disabled={loading} className="p-1 rounded hover:bg-[var(--color-accent)]">
        <Trash2 className="h-4 w-4 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]" />
      </button>
      {error && <p className="text-xs text-[var(--color-destructive)] max-w-[16rem] text-right">{error}</p>}
    </div>
  )
}

// ── Revoke Invitation ────────────────────────────────────────────────────────
// DEBT-46. The route half of this fix is worth nothing without this half: the
// fetch below used to discard its response entirely — no res.ok, no error
// state, an unconditional router.refresh() — so a failed revoke and a
// successful one were indistinguishable ON SCREEN whatever the server returned.
// Making the route honest and leaving this alone would have shipped a 404 that
// no admin could ever see. Mirrors the pattern in staff/[id]/self-service-actions.tsx.
export function RevokeInviteButton({ invitationId, email }: { invitationId: string; email: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleRevoke() {
    if (!confirm(`Revoke the pending invitation for ${email}?`)) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/users/invitations/${invitationId}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error ?? "Failed to revoke invitation")
        return
      }
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button onClick={handleRevoke} disabled={loading} className="p-1 rounded hover:bg-[var(--color-accent)]" title="Revoke invitation">
        <X className="h-4 w-4 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]" />
      </button>
      {error && <p className="text-xs text-[var(--color-destructive)] max-w-[16rem] text-right">{error}</p>}
    </div>
  )
}
