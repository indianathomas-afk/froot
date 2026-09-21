"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Switch } from "@/components/ui/switch"

// Interactive island for the Settings → Integrations HR card: the on/off
// switch that flips "hr" in the org's activeModules (InstagramActions pattern).
//
// HrAckRecipientsField USED TO LIVE HERE. NOTIFY-2a moved it to
// settings/notifications/hr-ack-recipients.tsx, where the rest of the email
// settings now are (Gary's ruling, 2026-09-20 — one page for every email
// setting). This file is back to the module toggle alone.

export function HrModuleToggle({ enabled: initialEnabled }: { enabled: boolean }) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(initialEnabled)
  const [busy, setBusy] = useState(false)

  async function toggle(next: boolean) {
    setEnabled(next) // optimistic — reverted if the request fails
    setBusy(true)
    const res = await fetch("/api/hr/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    }).catch(() => null)
    if (!res?.ok) setEnabled(!next)
    setBusy(false)
    router.refresh() // sidebar item + /hr landing follow the flag
  }

  return (
    <label className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
      {enabled ? "On" : "Off"}
      <Switch checked={enabled} disabled={busy} onCheckedChange={toggle} aria-label="Enable the HR module" />
    </label>
  )
}
