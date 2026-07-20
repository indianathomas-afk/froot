"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Switch } from "@/components/ui/switch"

// Interactive island for the Settings → Integrations Labor card: the on/off
// switch that flips "labor" in the org's activeModules (HrModuleToggle pattern).
// On first enable the server seeds the default rate legend.

export function LaborModuleToggle({ enabled: initialEnabled }: { enabled: boolean }) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(initialEnabled)
  const [busy, setBusy] = useState(false)

  async function toggle(next: boolean) {
    setEnabled(next) // optimistic — reverted if the request fails
    setBusy(true)
    const res = await fetch("/api/labor/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    }).catch(() => null)
    if (!res?.ok) setEnabled(!next)
    setBusy(false)
    router.refresh() // sidebar item + dashboard cards follow the flag
  }

  return (
    <label className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
      {enabled ? "On" : "Off"}
      <Switch checked={enabled} disabled={busy} onCheckedChange={toggle} aria-label="Enable the Labor module" />
    </label>
  )
}
