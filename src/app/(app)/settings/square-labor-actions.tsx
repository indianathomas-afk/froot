"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Switch } from "@/components/ui/switch"

// AL-1 — interactive island for the Advanced Labor row INSIDE the existing
// Settings → Integrations Square card, the way InstagramActions sits inside the
// Instagram card. L-2 seam (a): NOT a new module card, because a Square
// connection is a DATA SOURCE for the "Weekly Labor Model" an org already pays
// for, not a separate purchase.

export function SquareLaborToggle({ enabled: initialEnabled }: { enabled: boolean }) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(initialEnabled)
  const [busy, setBusy] = useState(false)

  async function toggle(next: boolean) {
    setEnabled(next) // optimistic — reverted if the request fails
    setBusy(true)
    const res = await fetch("/api/square/labor/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    }).catch(() => null)
    if (!res?.ok) setEnabled(!next)
    setBusy(false)
    router.refresh()
  }

  return (
    <label className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
      {enabled ? "On" : "Off"}
      <Switch
        checked={enabled}
        disabled={busy}
        onCheckedChange={toggle}
        aria-label="Enable Advanced Labor — sync worked hours from Square"
      />
    </label>
  )
}
