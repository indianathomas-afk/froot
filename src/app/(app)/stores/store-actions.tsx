"use client"

import { Pencil, Trash2 } from "lucide-react"
import { useState } from "react"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useRouter } from "next/navigation"

export type StoreForEdit = {
  id: string
  name: string
  storeNumber: string | null
  brand: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  timezone: string
  contactEmail: string | null
  phoneNumber: string | null
  squareLocationId: string | null
}

type SquareLocation = {
  id: string
  name: string
  address?: { address_line_1?: string; locality?: string }
  alreadyImported: boolean
}

const TIMEZONES = [
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Phoenix", label: "Arizona (MST)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/New_York", label: "Eastern (ET)" },
]

const NOT_LINKED = "__not_linked__"

export function StoreActions({ store }: { store: StoreForEdit }) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [locations, setLocations] = useState<SquareLocation[] | null>(null)
  const [locationsLoading, setLocationsLoading] = useState(false)

  const [form, setForm] = useState({
    name: store.name,
    storeNumber: store.storeNumber ?? "",
    address: store.address ?? "",
    city: store.city ?? "",
    state: store.state ?? "",
    zip: store.zip ?? "",
    timezone: store.timezone,
    contactEmail: store.contactEmail ?? "",
    phoneNumber: store.phoneNumber ?? "",
    squareLocationId: store.squareLocationId ?? NOT_LINKED,
  })

  async function handleEditOpen() {
    setForm({
      name: store.name,
      storeNumber: store.storeNumber ?? "",
      address: store.address ?? "",
      city: store.city ?? "",
      state: store.state ?? "",
      zip: store.zip ?? "",
      timezone: store.timezone,
      contactEmail: store.contactEmail ?? "",
      phoneNumber: store.phoneNumber ?? "",
      squareLocationId: store.squareLocationId ?? NOT_LINKED,
    })
    setError(null)
    setEditOpen(true)
    if (locations === null) {
      setLocationsLoading(true)
      try {
        const res = await fetch("/api/square/locations")
        if (res.ok) {
          const data = await res.json()
          setLocations(data.locations ?? [])
        } else {
          setLocations([]) // Square not connected — hide the picker gracefully
        }
      } catch {
        setLocations([])
      } finally {
        setLocationsLoading(false)
      }
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/stores/${store.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          storeNumber: form.storeNumber || null,
          address: form.address || null,
          city: form.city || null,
          state: form.state || null,
          zip: form.zip || null,
          timezone: form.timezone,
          contactEmail: form.contactEmail || null,
          phoneNumber: form.phoneNumber || null,
          squareLocationId: form.squareLocationId === NOT_LINKED ? null : form.squareLocationId,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error ?? "Failed to save changes.")
        return
      }
      setEditOpen(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await fetch(`/api/stores/${store.id}`, { method: "DELETE" })
      router.refresh()
    } finally {
      setDeleting(false)
    }
  }

  // A Square location is pickable if it's unlinked, or it's this store's own link.
  const pickableLocations = (locations ?? []).filter(
    (l) => !l.alreadyImported || l.id === store.squareLocationId
  )

  return (
    <div className="flex items-center gap-1">
      <button
        className="p-1.5 rounded hover:bg-[var(--color-accent)] transition-colors"
        onClick={handleEditOpen}
        aria-label="Edit store"
      >
        <Pencil className="h-4 w-4 text-[var(--color-muted-foreground)]" />
      </button>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Store Location</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Store Name *</Label>
                <Input required value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Store Number</Label>
                <Input value={form.storeNumber} onChange={(e) => setForm((p) => ({ ...p, storeNumber: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <Input value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>City</Label>
                <Input value={form.city} onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>State</Label>
                <Input value={form.state} onChange={(e) => setForm((p) => ({ ...p, state: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>ZIP</Label>
                <Input value={form.zip} onChange={(e) => setForm((p) => ({ ...p, zip: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Contact Email</Label>
                <Input type="email" value={form.contactEmail} onChange={(e) => setForm((p) => ({ ...p, contactEmail: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Phone Number</Label>
                <Input value={form.phoneNumber} onChange={(e) => setForm((p) => ({ ...p, phoneNumber: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Timezone</Label>
              <Select value={form.timezone} onValueChange={(v) => setForm((p) => ({ ...p, timezone: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {!TIMEZONES.some((tz) => tz.value === form.timezone) && (
                    <SelectItem value={form.timezone}>{form.timezone}</SelectItem>
                  )}
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {(locationsLoading || pickableLocations.length > 0 || store.squareLocationId) && (
              <div className="space-y-1.5">
                <Label>Square Location</Label>
                {locationsLoading ? (
                  <p className="text-xs text-[var(--color-muted-foreground)]">Loading Square locations...</p>
                ) : (
                  <>
                    <Select
                      value={form.squareLocationId}
                      onValueChange={(v) => setForm((p) => ({ ...p, squareLocationId: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Not linked" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NOT_LINKED}>Not linked</SelectItem>
                        {pickableLocations.map((loc) => (
                          <SelectItem key={loc.id} value={loc.id}>
                            {loc.name}
                            {loc.address?.address_line_1 ? ` — ${loc.address.address_line_1}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-[var(--color-muted-foreground)]">
                      Linking enables live sales on the Dashboard (requires the Inventory module).
                      Locations already linked to another store aren&apos;t shown.
                    </p>
                  </>
                )}
              </div>
            )}

            {error && (
              <p className="text-sm text-[var(--color-destructive)]">{error}</p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button className="p-1.5 rounded hover:bg-[var(--color-accent)] transition-colors" aria-label="Delete store">
            <Trash2 className="h-4 w-4 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]" />
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Store Location</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this store and all associated data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)] hover:opacity-90"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
