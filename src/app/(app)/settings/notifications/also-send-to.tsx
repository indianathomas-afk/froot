"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import type { ContactView } from "@/lib/notifications/contacts"

// ─── NOTIFY-12: "Also send to" for one email type ───────────────────────────
// Ticks contacts from the org address book and saves the whole list with
// PUT /api/notify/recipients/[kind]. CONTACTS ONLY for now: Froot users come
// after DEBT-106 (F10), and the route refuses them until then.
//
// Shows what was SAVED after a save (the route returns it), not what was
// ticked, so the list can't claim a pick the database doesn't hold.

const MAX = 10

export function AlsoSendTo({
  kind,
  contacts,
  pickedIds,
  archivedPicked,
  warnStoreLogin,
  help,
}: {
  kind: string
  /** Active contacts only. */
  contacts: ContactView[]
  /** Active contacts currently picked. */
  pickedIds: string[]
  /** Picks kept for archived contacts; they come back if the contact is restored. */
  archivedPicked: number
  warnStoreLogin: boolean
  help?: string
}) {
  const router = useRouter()
  const [saved, setSaved] = useState(pickedIds)
  const [selected, setSelected] = useState(new Set(pickedIds))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const dirty = selected.size !== saved.length || saved.some((id) => !selected.has(id))

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
    setDone(false)
    setError(null)
  }

  async function save() {
    setBusy(true)
    setError(null)
    setDone(false)
    // Keep the saved order for ids already picked; new ticks go after.
    const ids = [...saved.filter((id) => selected.has(id)), ...[...selected].filter((id) => !saved.includes(id))]
    const res = await fetch(`/api/notify/recipients/${encodeURIComponent(kind)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactIds: ids }),
    }).catch(() => null)
    if (!res?.ok) {
      const body = (await res?.json().catch(() => null)) as { error?: string } | null
      setError(body?.error ?? "Could not save. Try again.")
      setBusy(false)
      return
    }
    const body = (await res.json().catch(() => null)) as { contactIds?: string[] } | null
    const next = (body?.contactIds ?? []).filter((id) => contacts.some((c) => c.id === id))
    setSaved(next)
    setSelected(new Set(next))
    setDone(true)
    setBusy(false)
    router.refresh()
  }

  return (
    <div className="mt-3 p-4 border border-[var(--color-border)] rounded-lg">
      <h3 className="font-medium text-[var(--color-foreground)]">Also send to</h3>
      <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
        {help ? `${help} ` : ""}Choose from your contacts. Up to {MAX}.
      </p>

      {contacts.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)] mt-3">
          You have no contacts yet. Add people in the <span className="font-medium">Contacts</span> card below,
          then choose them here.
        </p>
      ) : (
        <ul className="mt-3 max-h-64 overflow-y-auto divide-y divide-[var(--color-border)] border border-[var(--color-border)] rounded-md">
          {contacts.map((c) => {
            const checked = selected.has(c.id)
            const inputId = `pick-${kind}-${c.id}`
            return (
              <li key={c.id} className="flex items-start gap-3 px-3 py-2">
                <Checkbox
                  id={inputId}
                  className="mt-0.5"
                  checked={checked}
                  disabled={busy || (!checked && selected.size >= MAX)}
                  onCheckedChange={(v) => toggle(c.id, v === true)}
                />
                <label htmlFor={inputId} className="min-w-0 text-sm cursor-pointer">
                  <span className="text-[var(--color-foreground)]">{c.name}</span>
                  {c.name !== c.email && (
                    <span className="text-[var(--color-muted-foreground)]"> · {c.email}</span>
                  )}
                  {warnStoreLogin && c.matchesStoreLogin && (
                    <span className="flex items-center gap-1 text-xs text-[var(--color-warning-text)] mt-0.5">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      This is a store login, so it won&apos;t get these emails.
                    </span>
                  )}
                </label>
              </li>
            )
          })}
        </ul>
      )}

      {archivedPicked > 0 && (
        <p className="text-xs text-[var(--color-muted-foreground)] mt-2">
          {archivedPicked === 1 ? "1 archived contact was" : `${archivedPicked} archived contacts were`} picked here.
          Restoring a contact puts it back on this list.
        </p>
      )}

      {contacts.length > 0 && (
        <div className="flex items-center gap-3 mt-3">
          <Button size="sm" onClick={save} disabled={busy || !dirty}>
            {busy ? "Saving…" : "Save"}
          </Button>
          {error && <span className="text-sm text-[var(--color-destructive)]">{error}</span>}
          {!error && done && <span className="text-sm text-[var(--color-success-text)]">Saved</span>}
        </div>
      )}
    </div>
  )
}
