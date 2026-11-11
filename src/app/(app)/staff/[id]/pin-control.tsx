"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

// TAB-4 (Gary, 2026-11-10, Q5) — SET OR RESET A STAFF MEMBER'S PIN.
//
// Rendered only for a viewer PUT /api/staff/[id]/pin would allow (the page
// asks decidePinAccess), and the route re-checks. A reset is a new PIN entered
// twice (Q5 iv): there is no "show", nothing echoes the PIN back, and the
// server answers `{ hasPin: true }` and nothing else.

const FOUR_DIGITS = /^\d{4}$/

export function PinControl({ staffId, displayName, hasPin }: { staffId: string; displayName: string; hasPin: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pin, setPin] = useState("")
  const [again, setAgain] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function close() {
    setOpen(false)
    setPin("")
    setAgain("")
    setError(null)
  }

  async function save() {
    if (!FOUR_DIGITS.test(pin)) return setError("A PIN is exactly 4 digits.")
    if (pin !== again) return setError("The two PINs don't match.")
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/staff/${staffId}/pin`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    }).catch(() => null)
    setBusy(false)
    if (!res?.ok) {
      const body = (await res?.json().catch(() => null)) as { error?: unknown } | null
      setError(typeof body?.error === "string" ? body.error : "That didn't save. Try again.")
      return
    }
    close()
    setSaved(true)
    router.refresh()
  }

  const digitsOnly = (v: string) => v.replace(/\D/g, "").slice(0, 4)

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => { setSaved(false); setOpen(true) }}>
        {hasPin ? "Reset PIN" : "Set PIN"}
      </Button>
      {saved && <span className="ml-2 text-xs text-[var(--color-success-text)]">PIN saved.</span>}
      <Dialog open={open} onOpenChange={(o) => !o && !busy && close()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{hasPin ? `Reset ${displayName}'s PIN` : `Set ${displayName}'s PIN`}</DialogTitle>
            <DialogDescription>
              {displayName} enters this on a store&apos;s shared tablet before a tick is recorded in their name.
              {hasPin ? " The old PIN stops working straight away." : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="pin-new">New 4-digit PIN</Label>
              <Input
                id="pin-new"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={pin}
                onChange={(e) => setPin(digitsOnly(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pin-again">Enter it again</Label>
              <Input
                id="pin-again"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={again}
                onChange={(e) => setAgain(digitsOnly(e.target.value))}
              />
            </div>
            {error && <p role="alert" className="text-sm text-[var(--color-destructive)]">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void save()} disabled={busy}>
                {busy ? "Saving…" : "Save PIN"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
