"use client"

import { useState } from "react"
import { Delete } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { verifyPin } from "@/lib/tablet-pin-options"

// TAB-4 (Gary, 2026-11-10, Q3) — THE DIGITS-ONLY PIN PAD.
//
// The TAB-1 value pad's key grid (dashboard/tablet-home.tsx ValueSheet) minus
// its ± and . keys and its °F suffix, with the entry MASKED as dots and nothing
// ever echoed back. It submits itself on the fourth digit. Presentation only:
// the tablet puts it in a BottomSheet, desktop in a Dialog.
//
// `size` "touch" is the tablet's 56px floor; "compact" for desktop dialogs.

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"] as const

export function PinPad({
  staffId,
  storeId,
  name,
  compact = false,
  onVerified,
}: {
  staffId: string
  storeId: string
  name: string
  compact?: boolean
  onVerified: (token: string) => void
}) {
  const [digits, setDigits] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)

  async function submit(pin: string) {
    setBusy(true)
    const result = await verifyPin(staffId, storeId, pin)
    setBusy(false)
    setDigits("")
    if (result.ok) {
      onVerified(result.token)
      return
    }
    setError(result.error)
    setLocked(result.code === "pin_locked" || result.code === "pin_not_configured")
  }

  function press(k: (typeof KEYS)[number]) {
    if (busy || locked || k === "") return
    if (k === "del") {
      setDigits((d) => d.slice(0, -1))
      return
    }
    setError(null)
    const next = (digits + k).slice(0, 4)
    setDigits(next)
    if (next.length === 4) void submit(next)
  }

  const key = compact ? "h-12 text-xl" : "h-16 text-2xl"
  return (
    <div className={cn("mx-auto flex w-full flex-col gap-4", compact ? "max-w-xs" : "max-w-sm")}>
      <p className={cn("text-center text-[var(--color-muted-foreground)]", compact ? "text-sm" : "text-lg")}>
        {name}, enter your 4-digit PIN
      </p>
      <div className="flex justify-center gap-3" aria-label={`${digits.length} of 4 digits entered`} role="status">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              "rounded-full border-2 border-[var(--color-primary)]",
              compact ? "h-4 w-4" : "h-5 w-5",
              i < digits.length ? "bg-[var(--color-primary)]" : "bg-transparent"
            )}
          />
        ))}
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-4 py-3 text-center text-base font-medium text-[var(--color-warning-text)]"
        >
          {error}
        </p>
      )}
      <div className="grid grid-cols-3 gap-3">
        {KEYS.map((k, i) =>
          k === "" ? (
            <span key={`blank-${i}`} />
          ) : (
            <Button
              key={k}
              type="button"
              size={compact ? "default" : "touch"}
              variant="outline"
              className={key}
              disabled={busy || locked}
              aria-label={k === "del" ? "Delete" : k}
              onClick={() => press(k)}
            >
              {k === "del" ? <Delete /> : k}
            </Button>
          )
        )}
      </div>
      {busy && <p className="text-center text-sm text-[var(--color-muted-foreground)]">Checking…</p>}
    </div>
  )
}
