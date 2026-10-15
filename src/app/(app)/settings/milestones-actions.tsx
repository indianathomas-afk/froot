"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Switch } from "@/components/ui/switch"

// Interactive island for the Settings → Integrations Milestones card: the
// on/off switch that flips Organization.milestonesEnabled. A copy of
// CalendarModuleToggle (calendar-actions.tsx). No seeding on enable — an org's
// tenure milestones are theirs to define on /staff/milestones.

export function MilestonesModuleToggle({ enabled: initialEnabled }: { enabled: boolean }) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(initialEnabled)
  const [busy, setBusy] = useState(false)

  async function toggle(next: boolean) {
    setEnabled(next) // optimistic — reverted if the request fails
    setBusy(true)
    const res = await fetch("/api/milestones/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    }).catch(() => null)
    if (!res?.ok) setEnabled(!next)
    setBusy(false)
    router.refresh() // the card's link and the /staff entry follow the flag
  }

  return (
    <label className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
      {enabled ? "On" : "Off"}
      <Switch checked={enabled} disabled={busy} onCheckedChange={toggle} aria-label="Enable Milestones" />
    </label>
  )
}
