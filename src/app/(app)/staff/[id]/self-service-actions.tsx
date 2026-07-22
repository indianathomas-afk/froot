"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Mail, UserX } from "lucide-react"
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

// HR-7 header actions on /staff/[id] (ADMIN / in-scope MANAGER only — the
// server page passes canManage and the APIs re-enforce it):
// - Invite to self-service (A): staff WITH an email and no login yet.
// - Terminate: rule 1 — flips status, revokes any Clerk login, keeps records.
export function SelfServiceActions({
  staffId,
  displayName,
  email,
  hasLogin,
  invitePending,
  status,
}: {
  staffId: string
  displayName: string
  email: string | null
  hasLogin: boolean
  invitePending: boolean
  status: string
}) {
  const router = useRouter()
  const [inviting, setInviting] = useState(false)
  const [terminating, setTerminating] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  if (status === "TERMINATED") return null

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
