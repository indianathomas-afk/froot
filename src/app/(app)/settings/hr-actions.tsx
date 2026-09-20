"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

// Interactive island for the Settings → Integrations HR card: the on/off
// switch that flips "hr" in the org's activeModules (InstagramActions pattern).

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

// ─── HR-16: acknowledgment notification recipients ───────────────────────────
// The org-level addresses that hear about a completed acknowledgment
// (Organization.hrAckRecipients). ADMIN only by ruling (F1, Gary 2026-09-20),
// which /settings gives for free — settings.access is ADMIN_ONLY and is not
// grantable — and PUT /api/hr/settings enforces independently.
//
// FREE TEXT, PARSED SERVER-SIDE. The textarea posts exactly what was typed and
// renders back exactly what was stored, so the split/trim/lowercase/dedupe
// rules live in one place (the route) and the field cannot show a value the
// database does not hold.

export function HrAckRecipientsField({ recipients }: { recipients: string[] }) {
  const router = useRouter()
  const [value, setValue] = useState(recipients.join("\n"))
  const [saved, setSaved] = useState(recipients.join("\n"))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const dirty = value !== saved

  async function save() {
    setBusy(true)
    setError(null)
    setDone(false)
    const res = await fetch("/api/hr/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipients: value }),
    }).catch(() => null)

    if (!res?.ok) {
      const body = (await res?.json().catch(() => null)) as { error?: string } | null
      setError(body?.error ?? "Could not save. Try again.")
      setBusy(false)
      return
    }

    // Re-render from what was STORED, not from what was typed — the route
    // trims, lowercases and deduplicates, and the field should show the result
    // rather than leave the admin believing their spacing survived.
    const body = (await res.json().catch(() => null)) as { recipients?: string[] } | null
    const next = (body?.recipients ?? []).join("\n")
    setValue(next)
    setSaved(next)
    setDone(true)
    setBusy(false)
    router.refresh()
  }

  return (
    <div className="mt-4 p-4 border border-[var(--color-border)] rounded-lg">
      <h3 className="font-medium text-[var(--color-foreground)]">Acknowledgment notification emails</h3>
      <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
        When a team member completes every required acknowledgment on a document, Froot emails
        these addresses with who signed, what, and a link to the record. One address per line, or
        separated by commas. Up to 10.
      </p>
      <Textarea
        className="mt-3 font-mono text-xs"
        rows={4}
        value={value}
        disabled={busy}
        spellCheck={false}
        placeholder="hr@example.com"
        aria-label="Acknowledgment notification emails"
        onChange={(e) => {
          setValue(e.target.value)
          setDone(false)
          setError(null)
        }}
      />
      <div className="flex items-center gap-3 mt-3">
        <Button size="sm" onClick={save} disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save"}
        </Button>
        {error && <span className="text-sm text-[var(--color-destructive)]">{error}</span>}
        {!error && done && (
          <span className="text-sm text-[var(--color-success-text)]">Saved</span>
        )}
        {!error && !done && saved.trim() === "" && (
          <span className="text-sm text-[var(--color-muted-foreground)]">
            Nobody is notified while this is empty.
          </span>
        )}
      </div>
    </div>
  )
}
