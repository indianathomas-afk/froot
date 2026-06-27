"use client"

import { useState } from "react"
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { useRouter } from "next/navigation"

type SquareLocation = {
  id: string
  name: string
  address?: { address_line_1?: string; locality?: string; administrative_district_level_1?: string }
  phone_number?: string
  timezone?: string
  alreadyImported: boolean
}

export function ImportSquareButton() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [locations, setLocations] = useState<SquareLocation[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const router = useRouter()

  async function handleOpen() {
    setOpen(true)
    setLoading(true)
    try {
      const res = await fetch("/api/square/locations")
      const data = await res.json()
      setLocations(data.locations ?? [])
      // Pre-select unimported ones
      const unimported = (data.locations ?? []).filter((l: SquareLocation) => !l.alreadyImported).map((l: SquareLocation) => l.id)
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

  async function handleImport() {
    setImporting(true)
    try {
      const toImport = locations.filter((l) => selected.has(l.id))
      await Promise.all(
        toImport.map((loc) =>
          fetch("/api/stores", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: loc.name,
              address: loc.address?.address_line_1 ?? "",
              city: loc.address?.locality ?? "",
              state: loc.address?.administrative_district_level_1 ?? "",
              timezone: loc.timezone ?? "America/Los_Angeles",
              phoneNumber: loc.phone_number ?? "",
              squareLocationId: loc.id,
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

  const available = locations.filter((l) => !l.alreadyImported)
  const alreadyDone = locations.filter((l) => l.alreadyImported)

  return (
    <>
      <Button variant="outline" onClick={handleOpen}>
        <Download className="h-4 w-4" />
        Import from Square
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import Locations from Square</DialogTitle>
          </DialogHeader>
          {loading ? (
            <p className="text-sm text-[var(--color-muted-foreground)] py-8 text-center">Loading locations...</p>
          ) : (
            <div className="space-y-3">
              {available.length === 0 && alreadyDone.length === 0 && (
                <p className="text-sm text-[var(--color-muted-foreground)]">No locations found. Make sure Square is connected in Settings.</p>
              )}
              {available.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium">Select locations to import ({selected.size} selected)</p>
                    <button
                      className="text-xs text-[var(--color-primary)]"
                      onClick={() => setSelected(new Set(available.map((l) => l.id)))}
                    >
                      Select all
                    </button>
                  </div>
                  {available.map((loc) => (
                    <label key={loc.id} className="flex items-start gap-3 p-3 rounded-lg border border-[var(--color-border)] mb-2 cursor-pointer hover:bg-[var(--color-accent)]">
                      <input
                        type="checkbox"
                        checked={selected.has(loc.id)}
                        onChange={() => toggle(loc.id)}
                        className="mt-0.5"
                      />
                      <div>
                        <p className="text-sm font-medium">{loc.name}</p>
                        {loc.address?.address_line_1 && (
                          <p className="text-xs text-[var(--color-muted-foreground)]">
                            {loc.address.address_line_1}, {loc.address.locality}, {loc.address.administrative_district_level_1}
                          </p>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              )}
              {alreadyDone.length > 0 && (
                <div>
                  <p className="text-xs text-[var(--color-muted-foreground)] mb-2">Already imported</p>
                  {alreadyDone.map((loc) => (
                    <div key={loc.id} className="flex items-center gap-3 p-3 rounded-lg border border-[var(--color-border)] mb-2 opacity-50">
                      <input type="checkbox" disabled checked />
                      <p className="text-sm">{loc.name}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleImport} disabled={importing || selected.size === 0}>
              {importing ? "Importing..." : `Import ${selected.size} Location${selected.size !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
