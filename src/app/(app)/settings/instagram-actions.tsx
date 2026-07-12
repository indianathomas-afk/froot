"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Switch } from "@/components/ui/switch"
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

// Interactive island for the Settings → Integrations Instagram card: the
// enable/disable switch and the (confirmed) disconnect. Connect/reconnect are
// plain links to /api/instagram/auth rendered by the server page.

export function InstagramActions({ enabled: initialEnabled }: { enabled: boolean }) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(initialEnabled)
  const [busy, setBusy] = useState(false)

  async function toggle(next: boolean) {
    setEnabled(next) // optimistic — reverted if the request fails
    setBusy(true)
    const res = await fetch("/api/instagram/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    }).catch(() => null)
    if (!res?.ok) setEnabled(!next)
    setBusy(false)
    router.refresh() // sidebar item + dashboard card follow the flag
  }

  async function disconnect() {
    setBusy(true)
    await fetch("/api/instagram/disconnect", { method: "POST" }).catch(() => null)
    setBusy(false)
    router.refresh()
  }

  return (
    <div className="flex items-center gap-3">
      <label className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
        {enabled ? "On" : "Off"}
        <Switch checked={enabled} disabled={busy} onCheckedChange={toggle} aria-label="Show Instagram in Froot" />
      </label>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button
            disabled={busy}
            className="border border-[var(--color-destructive)] text-[var(--color-destructive)] px-3 py-1.5 rounded-md text-sm font-medium hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            Disconnect
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Instagram?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the Instagram connection for your whole organization. The Instagram page and dashboard
              posts disappear for everyone until an admin reconnects.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={disconnect}
              className="bg-[var(--color-destructive)] text-white hover:bg-[var(--color-destructive)]/90"
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export function InstagramConnectButton({ reconnect = false }: { reconnect?: boolean }) {
  return (
    <Link
      href="/api/instagram/auth"
      className="bg-[var(--color-primary)] text-[var(--color-primary-foreground)] px-3 py-1.5 rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
    >
      {reconnect ? "Reconnect Instagram" : "Connect Instagram"}
    </Link>
  )
}
