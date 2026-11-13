"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Switch } from "@/components/ui/switch"

// TAB-16 C1 — the two switches on the "Help request emails" section of
// /settings/notifications. Each writes PUT /api/notify/help-request with ONLY
// its own field, the moment it is flipped — this page's save pattern (the
// pace and Tasks and Communication cards). There is no section-wide "Save
// changes": the design board drew one, and the page has none anywhere.
// R7 (Gary): "Only Admins can change Help request emails." The page is
// ADMIN_ONLY and the route re-checks requireAdmin().

type Field = "enabled" | "tabletAddContacts"

async function put(field: Field, value: boolean): Promise<string | null> {
  const res = await fetch("/api/notify/help-request", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [field]: value }),
  }).catch(() => null)
  if (res?.ok) return null
  const body = (await res?.json().catch(() => null)) as { error?: string } | null
  return body?.error ?? "Could not save. Try again."
}

export function HelpRequestSwitch({
  field,
  initial,
  title,
  description,
}: {
  field: Field
  initial: boolean
  title: string
  description: string
}) {
  const router = useRouter()
  const [on, setOn] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle(next: boolean) {
    setOn(next) // optimistic — reverted if the request fails
    setBusy(true)
    setError(null)
    const err = await put(field, next)
    if (err) {
      setOn(!next)
      setError(err)
    }
    setBusy(false)
    router.refresh()
  }

  const id = `help-${field}`
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3 min-h-[60px]">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium text-[var(--color-foreground)] cursor-pointer">
          {title}
        </label>
        <p className="text-sm text-[var(--color-muted-foreground)]">{description}</p>
        {error && <p className="text-sm text-[var(--color-destructive)] mt-1">{error}</p>}
      </div>
      <Switch id={id} checked={on} disabled={busy} onCheckedChange={toggle} className="mt-1 shrink-0" />
    </div>
  )
}
