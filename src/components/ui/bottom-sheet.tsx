"use client"

import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

// TAB-1 — a sheet that rises from the bottom of the screen, for the tablet
// shell (the overdue list, the value-entry number pad). Hand-rolled on the
// existing tokens rather than a new dependency. Escape and a tap on the scrim
// close it; the close button is a 56px touch target.
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  className?: string
}) {
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-[var(--color-foreground)]/40" />
      <div
        className={cn(
          "relative z-10 flex max-h-[85dvh] w-full max-w-2xl flex-col rounded-t-3xl bg-[var(--color-card)] shadow-2xl",
          className
        )}
      >
        <div className="flex items-center justify-between gap-4 border-b border-[var(--color-border)] px-6 py-3">
          <h2 className="text-xl font-bold text-[var(--color-foreground)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-14 w-14 items-center justify-center rounded-xl text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">{children}</div>
      </div>
    </div>
  )
}
