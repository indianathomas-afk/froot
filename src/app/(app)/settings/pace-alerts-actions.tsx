"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Switch } from "@/components/ui/switch"

// Interactive island for the Settings → Integrations Behind-pace alerts card:
// the on/off switch that flips Organization.paceAlertsEnabled (F-5b), on the
// CalendarModuleToggle pattern.
//
// NOTHING IS SEEDED OR CLEARED ON EITHER EDGE. Enabling does not send a
// catch-up alert and disabling does not delete this month's PaceAlertLog rows —
// see the comment at the foot of POST /api/pace-alerts/toggle for why both
// directions are inert.

export function PaceAlertsToggle({ enabled: initialEnabled }: { enabled: boolean }) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(initialEnabled)
  const [busy, setBusy] = useState(false)

  async function toggle(next: boolean) {
    setEnabled(next) // optimistic — reverted if the request fails
    setBusy(true)
    const res = await fetch("/api/pace-alerts/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    }).catch(() => null)
    if (!res?.ok) setEnabled(!next)
    setBusy(false)
    router.refresh() // the card's own Enabled/Disabled badge follows the flag
  }

  return (
    <label className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
      {enabled ? "On" : "Off"}
      <Switch checked={enabled} disabled={busy} onCheckedChange={toggle} aria-label="Enable behind-pace alert emails" />
    </label>
  )
}
