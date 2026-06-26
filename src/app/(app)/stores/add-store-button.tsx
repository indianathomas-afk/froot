"use client"

import { useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useRouter } from "next/navigation"

export function AddStoreButton() {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  const [form, setForm] = useState({
    name: "", storeNumber: "", brand: "", address: "", city: "", state: "", zip: "",
    timezone: "America/Los_Angeles", contactEmail: "", phoneNumber: "",
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await fetch("/api/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      setOpen(false)
      setForm({ name: "", storeNumber: "", brand: "", address: "", city: "", state: "", zip: "", timezone: "America/Los_Angeles", contactEmail: "", phoneNumber: "" })
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Add Store Location
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Store Location</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Store Name *</Label>
                <Input required value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Keva Juice South Reno" />
              </div>
              <div className="space-y-1.5">
                <Label>Store Number</Label>
                <Input value={form.storeNumber} onChange={(e) => setForm((p) => ({ ...p, storeNumber: e.target.value }))} placeholder="e.g. 06" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <Input value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} placeholder="Street address" />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>City</Label>
                <Input value={form.city} onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>State</Label>
                <Input value={form.state} onChange={(e) => setForm((p) => ({ ...p, state: e.target.value }))} placeholder="NV" />
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
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Add Store"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
