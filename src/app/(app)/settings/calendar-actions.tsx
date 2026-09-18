"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Switch } from "@/components/ui/switch"

// Interactive island for the Settings → Integrations Calendar card: the on/off
// switch that flips Organization.calendarEnabled (LaborModuleToggle pattern).
//
// NO SEEDING ON ENABLE, unlike the Labor toggle. There is no default reminder
// anyone would want — an org's recurring work is theirs — so an enabled
// calendar starts empty with the create popover one click away.

export function CalendarModuleToggle({ enabled: initialEnabled }: { enabled: boolean }) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(initialEnabled)
  const [busy, setBusy] = useState(false)

  async function toggle(next: boolean) {
    setEnabled(next) // optimistic — reverted if the request fails
    setBusy(true)
    const res = await fetch("/api/calendar/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    }).catch(() => null)
    if (!res?.ok) setEnabled(!next)
    setBusy(false)
    router.refresh() // the sidebar entry and the dashboard banner follow the flag
  }

  return (
    <label className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
      {enabled ? "On" : "Off"}
      <Switch checked={enabled} disabled={busy} onCheckedChange={toggle} aria-label="Enable the Calendar" />
    </label>
  )
}
