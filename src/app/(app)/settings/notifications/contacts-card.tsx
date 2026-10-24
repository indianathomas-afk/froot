"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import type { ContactView } from "@/lib/notifications/contacts"

// ─── NOTIFY-12: the org address book ─────────────────────────────────────────
// Add, edit, archive and restore contacts — people who get Froot email but may
// never log in. Each email card's "Also send to" picks from this list. ADMIN
// only: the page is settings.access and every route re-checks (F7).
//
// ARCHIVE, NEVER DELETE (F5). Archiving takes a contact off every list and it
// stops receiving; its picks are kept, so restoring puts it back where it was.
//
// STORE-LOGIN WARNING (Gary, 2026-10-23: "warn when a contact matches a store
// login"). Such a contact is treated as that login when emails go out, so it
// gets no behind-pace alerts. Shown on the row and when it is added; never
// blocks the save.

function StoreLoginNote() {
  return (
    <span className="flex items-center gap-1 text-xs text-[var(--color-warning-text)] mt-0.5">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      This address is a store login. It won&apos;t get behind-pace alerts.
    </span>
  )
}

async function errorOf(res: Response | null): Promise<string> {
  const body = (await res?.json().catch(() => null)) as { error?: string } | null
  return body?.error ?? "Could not save. Try again."
}

function ContactRow({ contact, onChanged }: { contact: ContactView; onChanged: (c: ContactView) => void }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(contact.name)
  const [email, setEmail] = useState(contact.email)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function patch(body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/notify/contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null)
    if (!res?.ok) {
      setError(await errorOf(res))
      setBusy(false)
      return
    }
    const next = ((await res.json()) as { contact: ContactView }).contact
    setName(next.name)
    setEmail(next.email)
    setEditing(false)
    setBusy(false)
    onChanged(next)
  }

  if (editing) {
    return (
      <li className="px-3 py-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} aria-label="Name" placeholder="Name" />
          <Input value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} aria-label="Email" placeholder="name@example.com" type="email" />
        </div>
        <div className="flex items-center gap-2 mt-2">
          <Button size="sm" disabled={busy || !name.trim() || !email.trim()} onClick={() => patch({ name, email })}>
            {busy ? "Saving…" : "Save"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setEditing(false)
              setName(contact.name)
              setEmail(contact.email)
              setError(null)
            }}
          >
            Cancel
          </Button>
          {error && <span className="text-sm text-[var(--color-destructive)]">{error}</span>}
        </div>
      </li>
    )
  }

  return (
    <li className="flex items-start justify-between gap-3 px-3 py-2">
      <div className="min-w-0 text-sm">
        <div className={contact.archived ? "text-[var(--color-muted-foreground)]" : "text-[var(--color-foreground)]"}>
          {contact.name}
          {contact.archived && <span className="ml-2 text-xs uppercase tracking-wide">Archived</span>}
        </div>
        {contact.name !== contact.email && (
          <div className="text-[var(--color-muted-foreground)] break-all">{contact.email}</div>
        )}
        {contact.matchesStoreLogin && !contact.archived && <StoreLoginNote />}
        {error && <div className="text-sm text-[var(--color-destructive)] mt-1">{error}</div>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {contact.archived ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => patch({ archived: false })}>
            Restore
          </Button>
        ) : (
          <>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
              Edit
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={busy}>
                  Archive
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Archive {contact.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {contact.email} will stop getting every Froot email it was chosen for. You can restore it
                    later, and it goes back on the same lists.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => patch({ archived: true })}
                    className="bg-[var(--color-destructive)] text-white hover:bg-[var(--color-destructive)]/90"
                  >
                    Archive
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </div>
    </li>
  )
}

export function ContactsCard({ contacts: initial }: { contacts: ContactView[] }) {
  const router = useRouter()
  const [contacts, setContacts] = useState(initial)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<ContactView | null>(null)

  function replace(next: ContactView) {
    setContacts((prev) => {
      const rest = prev.filter((c) => c.id !== next.id)
      return [...rest, next].sort(
        (a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name) || a.email.localeCompare(b.email)
      )
    })
    // The pickers above read the active list from the server.
    router.refresh()
  }

  async function add() {
    setBusy(true)
    setError(null)
    setAdded(null)
    const res = await fetch("/api/notify/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() || email.trim(), email }),
    }).catch(() => null)
    if (!res?.ok) {
      setError(await errorOf(res))
      setBusy(false)
      return
    }
    const next = ((await res.json()) as { contact: ContactView }).contact
    replace(next)
    setAdded(next)
    setName("")
    setEmail("")
    setBusy(false)
  }

  const activeCount = contacts.filter((c) => !c.archived).length

  return (
    <div>
      <p className="text-sm text-[var(--color-muted-foreground)] mb-4">
        People who get Froot email but may not log in — a corporate inbox, an accountant, an owner. Add them
        once here, then choose them under <span className="font-medium">Also send to</span> on any email above.
      </p>

      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          aria-label="Contact name"
          placeholder="Name (optional)"
        />
        <Input
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setError(null)
          }}
          disabled={busy}
          aria-label="Contact email"
          placeholder="name@example.com"
          type="email"
          onKeyDown={(e) => {
            if (e.key === "Enter" && email.trim()) add()
          }}
        />
        <Button onClick={add} disabled={busy || !email.trim()} className="shrink-0">
          {busy ? "Adding…" : "Add contact"}
        </Button>
      </div>
      {error && <p className="text-sm text-[var(--color-destructive)] mt-2">{error}</p>}
      {added && !error && (
        <div className="text-sm text-[var(--color-success-text)] mt-2">
          Added {added.email}.{added.matchesStoreLogin && <StoreLoginNote />}
        </div>
      )}

      {contacts.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)] mt-4">
          No contacts yet. Add an address above to start sending Froot emails to people outside your team.
        </p>
      ) : (
        <>
          <ul className="mt-4 divide-y divide-[var(--color-border)] border border-[var(--color-border)] rounded-md">
            {contacts.map((c) => (
              <ContactRow key={`${c.id}-${c.archived}`} contact={c} onChanged={replace} />
            ))}
          </ul>
          <p className="text-xs text-[var(--color-muted-foreground)] mt-2">
            {activeCount} active {activeCount === 1 ? "contact" : "contacts"} (up to 100).
          </p>
        </>
      )}
    </div>
  )
}
