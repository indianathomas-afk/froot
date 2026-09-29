"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Mail, UserCheck, UserX } from "lucide-react"
import { Button } from "@/components/ui/button"
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

// HR-7/HR-15 header actions on /staff/[id] (ADMIN / in-scope MANAGER only —
// the server page passes canManage and the APIs re-enforce it):
// - Invite to self-service (A): staff WITH an email and no login yet.
// - Terminate: rule 1 — flips status, revokes any Clerk login, keeps records.
//   DOC-6: lists unreturned issued items (a key) as a non-blocking warning.
// - Reactivate (terminated members): flips back to ACTIVE with history intact,
//   optionally chaining a fresh login invite in the same motion. The dialog
//   preflights Square and warns when the member is still INACTIVE there,
//   since the sync reconcile would terminate them again.
export function SelfServiceActions({
  staffId,
  displayName,
  email,
  hasLogin,
  invitePending,
  status,
  unreturnedItems = [],
}: {
  staffId: string
  displayName: string
  email: string | null
  hasLogin: boolean
  invitePending: boolean
  status: string
  // DOC-6: items issued by a tracks-return document and not yet returned.
  unreturnedItems?: { label: string; documentTitle: string }[]
}) {
  const router = useRouter()
  const [inviting, setInviting] = useState(false)
  const [terminating, setTerminating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reactivateOpen, setReactivateOpen] = useState(false)
  const [reactivating, setReactivating] = useState(false)
  const [sendInvite, setSendInvite] = useState(false)
  const [squareInactive, setSquareInactive] = useState(false)

  async function handleInvite() {
    setInviting(true)
    setError(null)
    try {
      const res = await fetch(`/api/staff/${staffId}/invite`, { method: "POST" })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error ?? "Failed to send invitation")
        return
      }
      router.refresh()
    } finally {
      setInviting(false)
    }
  }

  async function handleTerminate() {
    setTerminating(true)
    setError(null)
    try {
      const res = await fetch(`/api/staff/${staffId}/terminate`, { method: "POST" })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error ?? "Failed to terminate")
        return
      }
      router.refresh()
    } finally {
      setTerminating(false)
    }
  }

  async function openReactivate() {
    setError(null)
    setSendInvite(!!email)
    setSquareInactive(false)
    setReactivateOpen(true)
    // Advisory preflight — a fetch failure just means no warning is shown.
    try {
      const res = await fetch(`/api/staff/${staffId}/reactivate`)
      if (res.ok) {
        const data = await res.json()
        setSquareInactive(data.squareLinked && data.squareStatus === "INACTIVE")
      }
    } catch {}
  }

  async function handleReactivate() {
    setReactivating(true)
    setError(null)
    try {
      const res = await fetch(`/api/staff/${staffId}/reactivate`, { method: "POST" })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error ?? "Failed to reactivate")
        return
      }
      if (sendInvite && email) {
        const inviteRes = await fetch(`/api/staff/${staffId}/invite`, { method: "POST" })
        if (!inviteRes.ok) {
          const data = await inviteRes.json().catch(() => null)
          setError(
            `Reactivated, but the invite failed${data?.error ? `: ${data.error}` : ""} — use Invite to self-service.`
          )
        }
      }
      router.refresh()
    } finally {
      setReactivating(false)
    }
  }

  if (status === "TERMINATED") {
    return (
      <div className="flex flex-col items-end gap-2">
        <Button variant="outline" size="sm" onClick={openReactivate} disabled={reactivating}>
          <UserCheck className="h-4 w-4 mr-1.5" />
          {reactivating ? "Reactivating..." : "Reactivate"}
        </Button>
        {error && <p className="text-xs text-[var(--color-destructive)] max-w-xs text-right">{error}</p>}

        <AlertDialog open={reactivateOpen} onOpenChange={setReactivateOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reactivate {displayName}?</AlertDialogTitle>
              <AlertDialogDescription>
                This returns them to active status as a rehire. All of their history — signed documents,
                training, and records — stays intact and on file. As a rehire, they&apos;ll be asked to
                re-sign the required documents (their earlier signatures are kept for the record). Their
                old login stays revoked; send a fresh invite for self-service access.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {squareInactive && (
              <p className="text-sm rounded-md border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] text-[var(--color-foreground)] px-3 py-2">
                This person is inactive in Square. Mark them active there too, or the next Square sync
                will terminate them here again.
              </p>
            )}
            {email && (
              <label className="flex items-center gap-2 text-sm text-[var(--color-foreground)] cursor-pointer">
                <input type="checkbox" checked={sendInvite} onChange={(e) => setSendInvite(e.target.checked)} />
                Send a login invite to {email}
              </label>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleReactivate} disabled={reactivating}>
                {sendInvite && email ? "Reactivate & send invite" : "Reactivate"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        {email && !hasLogin && !invitePending && (
          <Button variant="outline" size="sm" onClick={handleInvite} disabled={inviting}>
            <Mail className="h-4 w-4 mr-1.5" />
            {inviting ? "Sending..." : "Invite to self-service"}
          </Button>
        )}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="text-[var(--color-destructive)] border-[var(--color-destructive)]/40 hover:bg-[var(--color-destructive)]/10"
            >
              <UserX className="h-4 w-4 mr-1.5" />
              Terminate
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Terminate {displayName}?</AlertDialogTitle>
              <AlertDialogDescription>
                This marks them terminated and immediately removes their portal access
                {hasLogin ? " and signs them out of their login" : ""}. All of their records — signed
                documents, training, and history — are kept. This does not delete anything.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {/* DOC-6 (F6): WARN, DON'T BLOCK. A manager may need to terminate
                someone who never returned a key, and the record must say so —
                they stay on the Key Register as "Terminated — not returned"
                (F7). Terminations by Square sync have no dialog and are caught
                by that same flag. */}
            {unreturnedItems.length > 0 && (
              <div className="text-sm rounded-md border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] text-[var(--color-foreground)] px-3 py-2">
                <p className="font-medium">Not returned yet:</p>
                <ul className="mt-1 list-disc pl-5">
                  {unreturnedItems.map((i) => (
                    <li key={i.documentTitle}>
                      {i.label} — {i.documentTitle}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                  You can still terminate. They&apos;ll stay on the Key Register until it&apos;s marked
                  returned.
                </p>
              </div>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleTerminate} disabled={terminating}>
                {terminating ? "Terminating..." : "Terminate"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {error && <p className="text-xs text-[var(--color-destructive)]">{error}</p>}
    </div>
  )
}
