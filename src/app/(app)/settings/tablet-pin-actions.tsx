"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Switch } from "@/components/ui/switch"

// TAB-4 (Gary, 2026-11-10, Q1) — "Require a PIN on shared tablets". The
// Calendar toggle's shape (calendar-actions.tsx). POST /api/settings/tablet-pin
// is the gate; this is the control. `configured` false (a secret missing in
// this environment, Q4) disables switching ON — switching off stays possible.

export function TabletPinToggle({ enabled: initialEnabled, configured }: { enabled: boolean; configured: boolean }) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(initialEnabled)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle(next: boolean) {
    setEnabled(next) // optimistic — reverted if the request fails
    setBusy(true)
    setError(null)
    const res = await fetch("/api/settings/tablet-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    }).catch(() => null)
    if (!res?.ok) {
      setEnabled(!next)
      const body = (await res?.json().catch(() => null)) as { error?: unknown } | null
      setError(typeof body?.error === "string" ? body.error : "That didn't save. Try again.")
    }
    setBusy(false)
    router.refresh()
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <label className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
        {enabled ? "On" : "Off"}
        <Switch
          checked={enabled}
          disabled={busy || (!configured && !enabled)}
          onCheckedChange={toggle}
          aria-label="Require a PIN on shared tablets"
        />
      </label>
      {error && <p className="max-w-56 text-right text-xs text-[var(--color-destructive)]">{error}</p>}
    </div>
  )
}
