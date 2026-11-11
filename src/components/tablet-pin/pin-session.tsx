"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { whoOptions, type PinSession, type PinStaff, type WhoOption } from "@/lib/tablet-pin-options"
import { PinPad } from "./pin-pad"

// TAB-4 (Gary, 2026-11-10) — the DESKTOP half of the PIN flow, for a STORE
// login on the execution page, the due banner and the calendar detail.
//
// usePinSession: the one person/token this page holds, in memory only.
// Design choice #3 (accepted by Gary): it is dropped after 5 minutes without a
// touch, like the tablet chip (Q10) — same shared device. A successful write
// hands back a fresh token (Q8 sliding), which `swap` puts in place.

export const PIN_IDLE_MS = 5 * 60 * 1000

export function usePinSession(enabled: boolean) {
  const [session, setSession] = useState<PinSession | null>(null)
  const last = useRef(0)

  useEffect(() => {
    if (!enabled) return
    last.current = Date.now()
    const touched = () => {
      last.current = Date.now()
    }
    const opts = { capture: true, passive: true } as const
    const events = ["pointerdown", "touchstart", "keydown", "wheel"] as const
    for (const ev of events) window.addEventListener(ev, touched, opts)
    const id = window.setInterval(() => {
      if (Date.now() - last.current >= PIN_IDLE_MS) setSession(null)
    }, 15_000)
    return () => {
      for (const ev of events) window.removeEventListener(ev, touched, opts)
      window.clearInterval(id)
    }
  }, [enabled])

  /** Q8: put the fresh token from a write in place, if it is still this person's. */
  const swap = useCallback((staffId: string, token: unknown) => {
    if (typeof token !== "string") return
    setSession((s) => (s && s.staffId === staffId ? { ...s, token } : s))
  }, [])

  const clear = useCallback(() => setSession(null), [])

  /** The token to send for this person at this store, or null. */
  const tokenFor = useCallback(
    (staffId: string | null | undefined, storeId: string) =>
      session && staffId && session.staffId === staffId && session.storeId === storeId ? session.token : null,
    [session]
  )

  return { session, setSession, swap, clear, tokenFor }
}

/** The PIN pad in a dialog. `target` null = closed. */
export function PinDialog({
  target,
  onClose,
  onVerified,
}: {
  target: { staffId: string; storeId: string; name: string } | null
  onClose: () => void
  onVerified: (session: PinSession) => void
}) {
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Enter PIN</DialogTitle>
        </DialogHeader>
        {target && (
          <PinPad
            key={`${target.staffId}:${target.storeId}`}
            compact
            staffId={target.staffId}
            storeId={target.storeId}
            name={target.name}
            onVerified={(token) =>
              onVerified({ staffId: target.staffId, storeId: target.storeId, label: target.name, token })
            }
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** TAB-4 — "Who's completing this?" for the desktop calendar screens: the
 *  same list as every picker (whoOptions, PINs on — no generics, no-PIN names
 *  greyed). `open` false = closed. */
export function WhoDialog({
  open,
  staff,
  onClose,
  onPick,
}: {
  open: boolean
  staff: PinStaff[]
  onClose: () => void
  onPick: (o: WhoOption) => void
}) {
  const options = whoOptions(staff, true)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Who&apos;s completing this?</DialogTitle>
        </DialogHeader>
        {options.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Nobody at this store can be picked yet. Ask a manager to set a PIN for each person on their staff page.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {options.map((o) => (
              <button
                key={o.key}
                type="button"
                disabled={o.disabled}
                onClick={() => !o.disabled && onPick(o)}
                className="min-h-[44px] rounded-md border border-[var(--color-border)] px-3 py-2 text-left text-sm hover:border-[var(--color-primary)] disabled:opacity-50 disabled:hover:border-[var(--color-border)]"
              >
                {o.label}
                {o.note && <span className="block text-xs text-[var(--color-muted-foreground)]">{o.note}</span>}
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
